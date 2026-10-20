// ---------------------------------------------------------------------------
// RHI 后端注册表：设备工厂的注册与解析（与 physics/backend/factory.ts 同一
// 模式——引擎无关词汇表 + 后端工厂注册）。
//
// registry 本身不 import 任何后端：three 等具体实现由消费方（编辑器
// RendererManager / 运行时 stage）显式 register，保证按需加载与可替换。
// auto 策略：优先 WebGPU，创建失败自动回退 WebGL（与既有的编辑器/运行时
// 双端行为一致）。
// ---------------------------------------------------------------------------

import type {
  RHIActiveBackend,
  RHIBackendKind,
  RHIDevice,
  RHIDeviceFactory,
  RHIDeviceOptions,
} from "./types";
import { RHIDeviceCreationError } from "./types";

const factories = new Map<RHIActiveBackend, RHIDeviceFactory>();

/** 注册某后端的设备工厂（同名重复注册以最后一次为准；测试可注入桩工厂） */
export function registerRHIDevice(kind: RHIActiveBackend, factory: RHIDeviceFactory): void {
  factories.set(kind, factory);
}

/** 已注册的后端清单（诊断/测试用） */
export function registeredRHIDeviceKinds(): RHIActiveBackend[] {
  return [...factories.keys()];
}

/** 清空注册表（仅测试用：隔离用例间的工厂注入） */
export function resetRHIDeviceRegistry(): void {
  factories.clear();
}

/** 最近一次后端回退记录（诊断面：应用层把原因显示到日志面板/检查器） */
export interface RHIBackendFallback {
  requested: RHIBackendKind;
  actual: RHIActiveBackend;
  /** 各次尝试的失败原因（按尝试顺序） */
  errors: string[];
}

let lastFallback: RHIBackendFallback | null = null;

/** 读取最近一次后端回退记录（未回退 = null；消费方刷新后应 clearBackendFallback） */
export function backendFallback(): RHIBackendFallback | null {
  return lastFallback;
}

/** 清除回退记录（应用层展示后调用，避免同一原因重复上报） */
export function clearBackendFallback(): void {
  lastFallback = null;
}

/**
 * 创建渲染设备：
 * - "webgl" → WebGL 工厂（失败即抛错——它本身是兜底层）；
 * - "webgpu" / "auto" → WebGPU 工厂（构造/init 失败回退 WebGL，warn 提示）。
 *   失败按 300/700ms 退避重试两次再回退：旧设备/适配器释放滞后（同页卸载重建、
 *   窗口快速切换）与 GPU 进程瞬时争用（编辑器窗口冷启动时 GPU 进程仍在预热）
 *   造成的失败挡在回退之前——静默回退到 WebGL 会让 WebGPU 特性
 *   「看起来是 webgpu 模式却不生效」。
 */
export async function createRHIDevice(
  kind: RHIBackendKind,
  options: RHIDeviceOptions = {},
): Promise<RHIDevice> {
  const prefer: RHIActiveBackend = kind === "auto" ? "webgpu" : kind;
  if (prefer === "webgpu") {
    const factory = factories.get("webgpu");
    if (factory) {
      const errors: string[] = [];
      const backoff = [0, 300, 700];
      for (let attempt = 0; attempt < backoff.length; attempt++) {
        if (backoff[attempt] > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
        }
        try {
          const device = await factory(options);
          lastFallback = null;
          return device;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          console.warn(
            `[rhi] WebGPU 设备创建失败（第 ${attempt + 1}/${backoff.length} 次：${errors[errors.length - 1]}）`,
          );
          // 确定性不可用（无适配器/仅软件适配器/init 超时）：重试只会拖长启动
          if (e instanceof RHIDeviceCreationError && e.retryable === false) break;
        }
      }
      console.warn(`[rhi] WebGPU 设备创建失败（${errors.join(" | ")}），已回退 WebGL`);
      lastFallback = { requested: kind, actual: "webgl", errors };
    }
  }
  const webgl = factories.get("webgl");
  if (!webgl) {
    throw new Error(`[rhi] 后端未注册：${kind}（webgl 兜底缺失）`);
  }
  return webgl(options);
}
