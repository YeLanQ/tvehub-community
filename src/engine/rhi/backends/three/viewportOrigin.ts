// ---------------------------------------------------------------------------
// 视口/裁剪矩形原点换算（RHI 约定 → three/webgpu）。
//
// RHI 的 RHIRect 沿用 WebGL 约定：y 是距画布**下边**的距离（画中画回贴等
// 调用方按此计算右下角矩形）。three/webgpu 的 Renderer.setViewport/setScissor
// 以画布**左上角**为原点（WebGL fallback 后端内部会再翻转一次，WebGPU 后端
// 直接下发），不换算会把子视口画到垂直镜像的位置。
// ---------------------------------------------------------------------------

import type { RHIRect } from "../../types";

/** 左下角原点矩形 → 左上角原点矩形（canvasHeight 为画布逻辑像素高度） */
export function toTopLeftRect(rect: RHIRect, canvasHeight: number): RHIRect {
  return {
    x: rect.x,
    y: canvasHeight - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
}
