// ---------------------------------------------------------------------------
// WebGPU 运行时能力（与平台无关，取决于系统 WebView/驱动）：
// - 启动时探测 navigator.gpu + requestAdapter；
// - 引擎挂载后以实际 activeBackend 为准（显式 webgl 项目或 WebGPU 创建失败都算不可用）；
// - 菜单/下拉框据此置灰高斯泼溅与 webgpu 渲染后端选项。
// ---------------------------------------------------------------------------

import { reactive } from "vue";

export type GpuBackend = "webgl" | "webgpu" | null;

/** 不可用时的统一原因（入口 title 与检查器提示共用） */
export const GPU_UNAVAILABLE_REASON = "需要 WebGPU（当前环境不支持，已回退 WebGL）";

export interface GpuGate {
  available: boolean;
  reason?: string;
}

interface GpuState {
  /** 是否已完成 navigator.gpu 探测 */
  probed: boolean;
  /** 探测结果（null = 未探测） */
  available: boolean | null;
  /** 引擎实际后端（null = 引擎尚未挂载） */
  backend: GpuBackend;
  /** 引擎回退原因（WebGPU 创建失败时写入） */
  fallbackReason: string;
}

const state = reactive<GpuState>({
  probed: false,
  available: null,
  backend: null,
  fallbackReason: "",
});

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

function gpuOf(): GpuLike | null {
  return (navigator as unknown as { gpu?: GpuLike }).gpu ?? null;
}

/** 探测 WebGPU 适配器（1.5s 超时；只探一次） */
export function probeGpuOnce(): Promise<boolean> {
  if (state.probed) return Promise.resolve(state.available === true);
  const gpu = gpuOf();
  if (!gpu) {
    state.probed = true;
    state.available = false;
    return Promise.resolve(false);
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  const probe = gpu
    .requestAdapter()
    .then((adapter) => adapter !== null && adapter !== undefined)
    .catch(() => false);
  return Promise.race([probe, timeout]).then((ok) => {
    state.probed = true;
    state.available = ok === true;
    return state.available;
  });
}

/** 引擎挂载后回填实际后端（webgpu 可用；webgl = 显式选择或回退） */
export function setActiveBackend(backend: Exclude<GpuBackend, null>, fallbackReason?: string): void {
  state.backend = backend;
  state.fallbackReason = backend === "webgl" ? (fallbackReason ?? "") : "";
}

export function getGpuState(): GpuState {
  return state;
}

/** 硬件/WebView 是否支持 WebGPU（与项目当前渲染设置无关；用于渲染后端下拉框） */
export function gpuSupport(): GpuGate {
  if (state.available === false) return { available: false, reason: GPU_UNAVAILABLE_REASON };
  return { available: true };
}

/**
 * 是否允许使用 WebGPU 独占功能：
 * - 引擎已挂载：只看实际后端（项目显式 webgl 或回退后都不可用）；
 * - 未挂载：探测结果可用，且项目渲染设置不是 webgl。
 */
export function gpuGate(rendererSetting?: string): GpuGate {
  return gpuGateOf(
    { available: state.available, backend: state.backend, fallbackReason: state.fallbackReason },
    rendererSetting,
  );
}

/** 纯逻辑（单测用）：给定探测结果/实际后端判断 WebGPU 可用性 */
export function gpuGateOf(
  s: { available: boolean | null; backend: GpuBackend; fallbackReason?: string },
  rendererSetting?: string,
): GpuGate {
  if (s.backend === "webgpu") return { available: true };
  if (s.backend === "webgl") {
    return {
      available: false,
      reason: s.fallbackReason ? `WebGPU 不可用（${s.fallbackReason}）` : GPU_UNAVAILABLE_REASON,
    };
  }
  if (rendererSetting === "webgl") {
    return { available: false, reason: "当前项目渲染后端为 WebGL，需切换到 WebGPU" };
  }
  if (s.available === false) return { available: false, reason: GPU_UNAVAILABLE_REASON };
  return { available: true };
}

/** 测试用：重置模块单例 */
export function __resetGpuCapabilityForTests(): void {
  state.probed = false;
  state.available = null;
  state.backend = null;
  state.fallbackReason = "";
}
