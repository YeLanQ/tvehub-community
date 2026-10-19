import { describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useDelayedFlag } from "./use-delayed-flag";

/** 在独立 effectScope 中运行（组合函数依赖生命周期清理） */
function run<T>(fn: () => T): { result: T; stop: () => void } {
  const scope = effectScope();
  const result = scope.run(fn) as T;
  return { result, stop: () => scope.stop() };
}

describe("useDelayedFlag", () => {
  it("短任务（亮起后立刻熄灭）从不显示", () => {
    vi.useFakeTimers();
    const source = ref(false);
    const { result, stop } = run(() => useDelayedFlag(source, { showDelayMs: 250 }));
    source.value = true;
    vi.advanceTimersByTime(100);
    source.value = false;
    vi.advanceTimersByTime(1000);
    expect(result.visible.value).toBe(false);
    stop();
    vi.useRealTimers();
  });

  it("长任务超过延迟后显示，熄灭后按最短时长收起", () => {
    vi.useFakeTimers();
    const source = ref(false);
    const { result, stop } = run(() =>
      useDelayedFlag(source, { showDelayMs: 250, minVisibleMs: 350 }),
    );
    source.value = true;
    vi.advanceTimersByTime(250);
    expect(result.visible.value).toBe(true);
    source.value = false;
    // 刚显示就熄灭：仍保持最短可见时长，不闪
    vi.advanceTimersByTime(100);
    expect(result.visible.value).toBe(true);
    vi.advanceTimersByTime(300);
    expect(result.visible.value).toBe(false);
    stop();
    vi.useRealTimers();
  });

  it("显示期间任务再次开始：不收起", () => {
    vi.useFakeTimers();
    const source = ref(false);
    const { result, stop } = run(() => useDelayedFlag(source, { showDelayMs: 100 }));
    source.value = true;
    vi.advanceTimersByTime(100);
    expect(result.visible.value).toBe(true);
    source.value = false;
    vi.advanceTimersByTime(50);
    source.value = true;
    vi.advanceTimersByTime(1000);
    expect(result.visible.value).toBe(true);
    stop();
    vi.useRealTimers();
  });

  it("组件卸载清理定时器（不残留回调）", () => {
    vi.useFakeTimers();
    const source = ref(false);
    const { result, stop } = run(() => useDelayedFlag(source, { showDelayMs: 100 }));
    source.value = true;
    stop();
    vi.advanceTimersByTime(1000);
    expect(result.visible.value).toBe(false);
    vi.useRealTimers();
  });
});
