import { afterEach, describe, expect, it } from "vitest";
import { assertHardwareAdapter } from "./webgpu";
import { RHIDeviceCreationError } from "../../types";

/** 桩 navigator.gpu（jsdom 无该字段；每例后清理） */
function stubGpu(value: unknown): void {
  Object.defineProperty(navigator, "gpu", { value, configurable: true });
}

describe("WebGPU 适配器门控（启动兜底）", () => {
  afterEach(() => {
    // 删除桩，恢复 jsdom 默认（无 navigator.gpu）
    delete (navigator as unknown as { gpu?: unknown }).gpu;
  });

  it("无 navigator.gpu：不可重试错误（registry 直接回退 WebGL）", async () => {
    stubGpu(undefined);
    await expect(assertHardwareAdapter()).rejects.toMatchObject({
      name: "RHIDeviceCreationError",
      retryable: false,
    });
  });

  it("requestAdapter 返回 null：不可重试错误", async () => {
    stubGpu({ requestAdapter: async () => null });
    await expect(assertHardwareAdapter()).rejects.toBeInstanceOf(RHIDeviceCreationError);
  });

  it("软件适配器（SwiftShader/llvmpipe 等）判定不可用，避免着色器编译拖死启动", async () => {
    stubGpu({
      requestAdapter: async () => ({
        isFallbackAdapter: true,
        info: { vendor: "google", architecture: "swiftshader", description: "Google SwiftShader" },
      }),
    });
    await expect(assertHardwareAdapter()).rejects.toThrow(/软件适配器/);
  });

  it("硬件适配器：通过（信息命中软件正则但 isFallbackAdapter=false 且无软件关键词）", async () => {
    stubGpu({
      requestAdapter: async () => ({
        isFallbackAdapter: false,
        info: { vendor: "nvidia", architecture: "ada", device: "RTX", description: "NVIDIA GeForce RTX" },
      }),
    });
    await expect(assertHardwareAdapter()).resolves.toBeUndefined();
  });
});
