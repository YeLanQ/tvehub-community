// ---------------------------------------------------------------------------
// 渲染设备丢失的恢复编排（纯逻辑，无 DOM / three 依赖）：
// 设备丢失（WebGPU device lost、WebGL context lost）后按计划重建渲染设备——
// 退避档位、崩溃循环防护、状态广播都在这里；真正的重建动作由 RendererManager
// 以 hooks 注入（halt 停循环 / recover 建新设备 / notify 上报状态）。
//
// 为什么需要它：three 在设备丢失后只会把渲染降级为空操作（WebGPU）或等待浏览器
// 自愈（WebGL）。渲染压力大（显存不足/驱动 TDR/GPU 进程崩溃）时视口就停在最后
// 一帧或清屏帧上——用户看到「直接白屏/黑屏」且没有任何提示，只能重开项目。
// ---------------------------------------------------------------------------
import type { RHIActiveBackend } from "../../../engine/rhi/types";

/** 丢失状态机阶段（ok 只在内部表示，不广播） */
export type DeviceLossPhase = "lost" | "recovering" | "recovered" | "failed";

/** 状态广播载荷（引擎事件 → 编辑器控制台/气泡） */
export interface DeviceLossNotify {
  backend: RHIActiveBackend;
  phase: DeviceLossPhase;
  /** 丢失/失败原因（recovered 时为空串） */
  message: string;
  /** 恢复尝试序号（1 起；recovering / failed 有意义） */
  attempt?: number;
}

/** 恢复计划的一档：延后 delayMs 后按 backend 重建设备 */
export interface RecoveryStep {
  backend: RHIActiveBackend;
  delayMs: number;
}

export interface DeviceLossHooks {
  /** 停止渲染循环（设备已不可用）。WebGL 等浏览器自愈期间不调用 */
  halt(): void;
  /** 按步骤重建设备并接管渲染；成功 true / 失败 false（实现内部不得抛错） */
  recover(step: RecoveryStep): Promise<boolean>;
  /** 状态可见化（控制台日志 + 气泡提示） */
  notify(info: DeviceLossNotify): void;
}

/**
 * 恢复计划：
 * - WebGL：先等浏览器自愈（three 的 webglcontextrestored 会重装整套渲染状态），
 *   看门狗 6s 仍未恢复才重建渲染器；再失败 4s 后最后一档。
 * - WebGPU：device 丢失后不可复用，立即按 0.3s / 2s / 5s 退避重建。三档都留在
 *   WebGPU——降级到经典 WebGL 会把已按 TSL/NodeMaterial 装配的材质搬过去，
 *   而经典 WebGLRenderer 根本渲染不了这些材质（会变成整场黑屏）。
 */
export function deviceRecoveryPlan(backend: RHIActiveBackend): RecoveryStep[] {
  if (backend === "webgl") {
    return [
      { backend: "webgl", delayMs: 6000 },
      { backend: "webgl", delayMs: 4000 },
    ];
  }
  return [
    { backend: "webgpu", delayMs: 300 },
    { backend: "webgpu", delayMs: 2000 },
    { backend: "webgpu", delayMs: 5000 },
  ];
}

/** 恢复成功后判定「稳定」的窗口：窗口内再次丢失视为崩溃循环 */
export const DEVICE_LOSS_STABLE_MS = 10_000;

export class DeviceLossController {
  private state: "ok" | "lost" | "recovering" | "failed" = "ok";
  private backend: RHIActiveBackend = "webgl";
  private message = "";
  /** 下一次要执行的计划档位下标 */
  private attemptIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastRecoveredAt = Number.NEGATIVE_INFINITY;
  /** 重建过程中收到的新丢失（新设备又挂了）：重建成功后按丢失继续，不谎报恢复 */
  private pending: { backend: RHIActiveBackend; message: string } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly hooks: DeviceLossHooks,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now());
  }

  /** 当前状态（ok = 正常；failed = 已放弃，等待手动 retry） */
  get phase(): "ok" | DeviceLossPhase {
    return this.state;
  }

  /** 上报设备丢失（WebGPU device lost / WebGL context lost） */
  reportLost(backend: RHIActiveBackend, message: string): void {
    if (this.disposed) return;
    // 重建期间再来丢失：只记下来，等本次重建结果定夺（见 run）
    if (this.state === "recovering") {
      this.pending = { backend, message };
      return;
    }
    if (this.state === "lost") return;
    this.state = "lost";
    this.backend = backend;
    this.message = message;
    // 稳定期内连续丢失 = 崩溃循环：跳过最激进的首档，避免重建风暴
    this.attemptIdx =
      this.now() - this.lastRecoveredAt < DEVICE_LOSS_STABLE_MS
        ? Math.max(1, this.attemptIdx)
        : 0;
    this.hooks.notify({ backend, phase: "lost", message });
    // WebGL 交给浏览器自愈：渲染循环继续空转（three 的 render 在丢失期是空操作），
    // 只有等不到 contextrestored 才由计划档位重建。WebGPU 没得救必须立刻停。
    if (backend !== "webgl") this.hooks.halt();
    this.arm();
  }

  /** 上报上下文已自动恢复（WebGL contextrestored；three 已重装渲染状态） */
  reportRestored(): void {
    if (this.disposed || this.state === "ok") return;
    this.clearTimer();
    this.pending = null;
    this.state = "ok";
    this.attemptIdx = 0;
    this.lastRecoveredAt = this.now();
    this.hooks.notify({ backend: this.backend, phase: "recovered", message: "" });
  }

  /** 失败后的人工重试（气泡「重试」按钮）：从头再走一遍计划 */
  retry(): void {
    if (this.disposed || this.state !== "failed") return;
    this.state = "lost";
    this.attemptIdx = 0;
    this.hooks.notify({ backend: this.backend, phase: "lost", message: this.message });
    this.hooks.halt();
    this.arm();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private arm(): void {
    const plan = deviceRecoveryPlan(this.backend);
    if (this.attemptIdx >= plan.length) {
      this.state = "failed";
      this.hooks.notify({
        backend: this.backend,
        phase: "failed",
        message: this.message,
        attempt: this.attemptIdx,
      });
      return;
    }
    const step = plan[this.attemptIdx];
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(step, this.attemptIdx);
    }, step.delayMs);
  }

  private async run(step: RecoveryStep, idx: number): Promise<void> {
    this.state = "recovering";
    this.hooks.notify({
      backend: step.backend,
      phase: "recovering",
      message: this.message,
      attempt: idx + 1,
    });
    let ok = false;
    try {
      ok = await this.hooks.recover(step);
    } catch {
      ok = false;
    }
    if (this.disposed || this.state !== "recovering") return;
    const during = this.pending;
    this.pending = null;
    if (ok && during) {
      // 新设备建起来又立刻丢了：按一次新的丢失继续（不谎报 recovered）
      this.state = "ok";
      this.reportLost(during.backend, during.message);
      return;
    }
    if (ok) {
      this.state = "ok";
      this.attemptIdx = 0;
      this.lastRecoveredAt = this.now();
      this.hooks.notify({ backend: step.backend, phase: "recovered", message: "" });
      return;
    }
    this.attemptIdx = idx + 1;
    this.state = "lost";
    this.arm();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
