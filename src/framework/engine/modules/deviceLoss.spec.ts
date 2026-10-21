import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_LOSS_STABLE_MS,
  DeviceLossController,
  deviceRecoveryPlan,
  type DeviceLossNotify,
  type RecoveryStep,
} from "./deviceLoss";

// 设备丢失恢复编排：恢复计划 / 退避重试 / WebGL 自愈等待 / 崩溃循环防护 /
// 重建期间再丢失。全部时间驱动，用假时钟推进，不碰 DOM 与 three。
function makeHarness(recoverResult: boolean[] = []) {
  const events: DeviceLossNotify[] = [];
  const recovered: RecoveryStep[] = [];
  let halted = 0;
  let idx = 0;
  const ctl = new DeviceLossController({
    halt: () => {
      halted++;
    },
    recover: async (step) => {
      recovered.push(step);
      const ok = recoverResult[idx] ?? true;
      idx++;
      return ok;
    },
    notify: (info) => events.push(info),
  });
  return {
    ctl,
    events,
    recovered,
    halted: () => halted,
    phases: () => events.map((e) => e.phase),
  };
}

describe("deviceRecoveryPlan", () => {
  it("WebGPU：三档同后端退避重建（不降级 WebGL——TSL/NodeMaterial 在经典 WebGL 下不可渲染）", () => {
    const plan = deviceRecoveryPlan("webgpu");
    expect(plan.map((s) => s.backend)).toEqual(["webgpu", "webgpu", "webgpu"]);
    expect(plan.map((s) => s.delayMs)).toEqual([300, 2000, 5000]);
  });

  it("WebGL：先等浏览器自愈（6s 看门狗）再重建，两档", () => {
    const plan = deviceRecoveryPlan("webgl");
    expect(plan.map((s) => s.backend)).toEqual(["webgl", "webgl"]);
    expect(plan[0].delayMs).toBe(6000);
  });
});

describe("DeviceLossController WebGPU", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("丢失即停循环并广播 lost，退避后重建成功广播 recovered", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgpu", "out of memory");
    expect(h.halted()).toBe(1);
    expect(h.phases()).toEqual(["lost"]);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.recovered).toHaveLength(1);
    expect(h.recovered[0].backend).toBe("webgpu");
    expect(h.phases()).toEqual(["lost", "recovering", "recovered"]);
    expect(h.ctl.phase).toBe("ok");
  });

  it("重建失败按下一档重试，三档全失败后广播 failed 且不再排定时器", async () => {
    const h = makeHarness([false, false, false]);
    h.ctl.reportLost("webgpu", "device lost");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.recovered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.recovered).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.recovered).toHaveLength(3);
    const failed = h.events[h.events.length - 1];
    expect(failed?.phase).toBe("failed");
    expect(failed?.attempt).toBe(3);
    expect(h.ctl.phase).toBe("failed");
    // 之后不会再有自动尝试
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.recovered).toHaveLength(3);
  });

  it("failed 之后 retry 从头再走计划", async () => {
    const h = makeHarness([false, false, false, true]);
    h.ctl.reportLost("webgpu", "device lost");
    await vi.advanceTimersByTimeAsync(300 + 2000 + 5000);
    expect(h.ctl.phase).toBe("failed");
    h.ctl.retry();
    expect(h.phases()[h.phases().length - 1]).toBe("lost");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.recovered).toHaveLength(4);
    expect(h.ctl.phase).toBe("ok");
  });

  it("稳定期内再次丢失：跳过首档（避免重建风暴）", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgpu", "first");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.ctl.phase).toBe("ok");
    // 恢复后立刻又丢（< STABLE_MS）
    h.ctl.reportLost("webgpu", "again");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.recovered).toHaveLength(1); // 首档被跳过，0.3s 时还没重试
    await vi.advanceTimersByTimeAsync(1700);
    expect(h.recovered).toHaveLength(2);
    expect(h.recovered[1].delayMs).toBe(2000);
  });

  it("稳定期过后再丢失：从首档重新开始", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgpu", "first");
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(DEVICE_LOSS_STABLE_MS + 1000);
    h.ctl.reportLost("webgpu", "later");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.recovered).toHaveLength(2);
    expect(h.recovered[1].delayMs).toBe(300);
  });

  it("重建过程中新设备又丢失：不谎报 recovered，按新丢失继续", async () => {
    const events: DeviceLossNotify[] = [];
    let recoverCalls = 0;
    const ctl = new DeviceLossController({
      halt: () => {},
      recover: async () => {
        recoverCalls++;
        if (recoverCalls === 1) ctl.reportLost("webgpu", "lost during rebuild");
        return true;
      },
      notify: (info) => events.push(info),
    });
    ctl.reportLost("webgpu", "first");
    await vi.advanceTimersByTimeAsync(300);
    expect(events.filter((e) => e.phase === "recovered")).toHaveLength(0);
    expect(events.filter((e) => e.phase === "lost")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctl.phase).toBe("ok");
    expect(events[events.length - 1]?.phase).toBe("recovered");
  });

  it("dispose 取消未执行的尝试", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgpu", "lost");
    h.ctl.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.recovered).toHaveLength(0);
  });
});

describe("DeviceLossController WebGL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上下文丢失不停循环（three 渲染为空操作，等浏览器自愈）", () => {
    const h = makeHarness();
    h.ctl.reportLost("webgl", "context lost");
    expect(h.halted()).toBe(0);
    expect(h.phases()).toEqual(["lost"]);
  });

  it("看门狗期内 contextrestored：直接广播 recovered，不重建设备", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgl", "context lost");
    await vi.advanceTimersByTimeAsync(2000);
    h.ctl.reportRestored();
    expect(h.phases()).toEqual(["lost", "recovered"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.recovered).toHaveLength(0);
    expect(h.ctl.phase).toBe("ok");
  });

  it("看门狗超时未恢复：重建设备", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgl", "context lost");
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.recovered).toHaveLength(1);
    expect(h.recovered[0].backend).toBe("webgl");
    expect(h.ctl.phase).toBe("ok");
  });

  it("已恢复后的迟到 contextrestored 不重复广播", async () => {
    const h = makeHarness();
    h.ctl.reportLost("webgl", "context lost");
    h.ctl.reportRestored();
    h.ctl.reportRestored();
    expect(h.phases()).toEqual(["lost", "recovered"]);
  });
});
