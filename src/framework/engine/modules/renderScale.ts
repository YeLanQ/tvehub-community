/**
 * 自适应渲染精度（动态分辨率 DRS 决策器，纯逻辑无 DOM/WebGL 依赖）：
 * 视口画布像素量随窗口尺寸变化——最大化/高分屏 + 重场景会把 GPU 帧时间
 * 推过刷新率预算，帧率骤降（「窗口一最大化就掉 FPS」）。决策器按 rAF
 * tick 帧距是否持续超预算，在 [0.5, 1] 精度档位间单调步进：帧率稳定在
 * 目标值，超出部分以渲染分辨率（清晰度，CSS 仍 100% 拉伸）平稳换取。
 *
 * 信号口径：rAF tick 帧距（含被限流跳过的 tick）对比「刷新间隔 × 1.35」。
 * vsync 锁定时 tick 帧距恒等于刷新间隔；超预算帧会把 tick 拖长——该判定
 * 在 60/90/144Hz 任意刷新率与任意限流配额下通用。恢复判定用「连续健康」
 * 计数（×1.15 内），换档后设观察窗，防止在预算边界反复横跳。
 *
 * 消费方：RendererManager.loop（每个 rAF tick 喂一次，仅渲染帧应用换档）。
 */
export class RenderScaleController {
  /** 精度档位（渲染分辨率 = 基准像素比 × scale；1 = 原生） */
  static readonly STEPS = [1, 0.85, 0.7, 0.6, 0.5] as const;
  /** 连续超预算 tick 数达到即降档（≈130ms@60Hz 持续过载；启动着色器编译/
   *  场景装载与窗口拖拽的瞬时加载帧夹着健康帧，达不到连续即不动档） */
  static readonly DOWN_TICKS = 8;
  /** 连续健康 tick 数达到即升档（≈3s@60Hz；余量确认充分再还原清晰度） */
  static readonly UP_TICKS = 180;
  /** 两次换档的最小间隔 tick 数（换档稳定观察窗） */
  static readonly CHANGE_GAP_TICKS = 30;

  private idx = 0;
  private over = 0;
  private stable = 0;
  /** 距上次换档的 tick 数（初始 = 观察窗，首次换档不受限） */
  private sinceChange = RenderScaleController.CHANGE_GAP_TICKS;

  /** 当前渲染精度（1 = 原生分辨率） */
  get scale(): number {
    return RenderScaleController.STEPS[this.idx];
  }

  /** 每个 rAF tick 喂一次；overBudget = 本 tick 帧距超出刷新预算。返回当前精度 */
  tick(overBudget: boolean): number {
    const C = RenderScaleController;
    this.sinceChange++;
    if (overBudget) {
      this.over++;
      this.stable = 0;
    } else {
      this.stable++;
      this.over = 0;
    }
    if (
      this.over >= C.DOWN_TICKS &&
      this.sinceChange >= C.CHANGE_GAP_TICKS &&
      this.idx < C.STEPS.length - 1
    ) {
      this.idx++;
      this.over = 0;
      this.stable = 0;
      this.sinceChange = 0;
    } else if (
      this.stable >= C.UP_TICKS &&
      this.sinceChange >= C.CHANGE_GAP_TICKS &&
      this.idx > 0
    ) {
      this.idx--;
      this.over = 0;
      this.stable = 0;
      this.sinceChange = 0;
    }
    return this.scale;
  }
}
