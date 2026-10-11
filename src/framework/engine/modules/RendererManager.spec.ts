import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererManager } from "./RendererManager";

// 空闲降帧的活动信号判定（不 mount：纯时间戳 + 钩子聚合，无 WebGL 依赖）。
// 渲染循环据 viewportActive 在空闲时降频（IDLE_FPS）、交互/活动内容恢复全速。
describe("RendererManager 空闲降帧活动信号", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("空闲超窗后判定空闲，交互标记立即恢复活动", () => {
    const rm = new RendererManager();
    vi.advanceTimersByTime(5000);
    expect(rm.viewportActive()).toBe(false);
    rm.markActivity();
    expect(rm.viewportActive()).toBe(true);
  });

  it("活动钩子为真（动画播放/物理模拟等）时空闲窗口外仍保持全速", () => {
    const rm = new RendererManager();
    rm.addActivityHook(() => true);
    vi.advanceTimersByTime(5000);
    expect(rm.viewportActive()).toBe(true);
  });

  it("全部活动钩子为假且超窗后判定空闲（渲染循环据此降帧）", () => {
    const rm = new RendererManager();
    rm.addActivityHook(() => false);
    rm.addActivityHook(() => false);
    vi.advanceTimersByTime(5000);
    expect(rm.viewportActive()).toBe(false);
  });

  it("任一活动钩子翻真即从空闲翻回活动（播放动画恢复全速的边沿）", () => {
    const rm = new RendererManager();
    let playing = false;
    rm.addActivityHook(() => playing);
    vi.advanceTimersByTime(5000);
    expect(rm.viewportActive()).toBe(false);
    playing = true;
    expect(rm.viewportActive()).toBe(true);
  });
});

// FPS 滑动窗口统计（recordFrame 注入时间戳，不 mount）：fps = 最近 1s 实际
// 渲染帧数；>250ms 帧距（遮挡/后台挂起空档）清窗重建；idle 标志随帧透传。
describe("RendererManager FPS 滑动窗口统计", () => {
  it("正常：60fps 节奏持续渲染读数稳定在 60（±1 窗口边界浮点抖动）", () => {
    const rm = new RendererManager();
    const step = 1000 / 60;
    for (let i = 0; i < 70; i++) rm.recordFrame(1000 + i * step, false);
    const fps = rm.getStats().fps;
    expect(fps).toBeGreaterThanOrEqual(60);
    expect(fps).toBeLessThanOrEqual(61);
    expect(rm.getStats().idle).toBe(false);
  });

  it("空闲降档：83ms 帧距读数 ≈12 且 idle 标志为真", () => {
    const rm = new RendererManager();
    const step = 1000 / 12;
    for (let i = 0; i < 30; i++) rm.recordFrame(1000 + i * step, true);
    const fps = rm.getStats().fps;
    expect(fps).toBeGreaterThanOrEqual(12);
    expect(fps).toBeLessThanOrEqual(13);
    expect(rm.getStats().idle).toBe(true);
  });

  it("异常：秒级空档（窗口遮挡/rAF 挂起）清窗重建，读数不被砸穿成负向尖峰", () => {
    const rm = new RendererManager();
    for (let i = 0; i < 60; i++) rm.recordFrame(1000 + i * (1000 / 60), false);
    // 挂起 2s 后恢复：空档前样本全部剔除，从当前帧重新累计（单调爬升不振荡）
    rm.recordFrame(4000, false);
    expect(rm.getStats().fps).toBe(1);
    for (let i = 1; i <= 10; i++) rm.recordFrame(4000 + i * 16, false);
    expect(rm.getStats().fps).toBe(11);
  });

  it("边界：250ms 以内帧距不清窗（仍计入窗口），超过才剔除", () => {
    const rm = new RendererManager();
    rm.recordFrame(1000, false);
    rm.recordFrame(1250, false);
    expect(rm.getStats().fps).toBe(2);
    rm.recordFrame(1251 + 251, false);
    expect(rm.getStats().fps).toBe(1);
  });
});
