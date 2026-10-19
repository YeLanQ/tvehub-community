import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetGpuCapabilityForTests,
  GPU_UNAVAILABLE_REASON,
  gpuGateOf,
} from "./gpu-capability";

describe("gpuGateOf WebGPU 可用性判定", () => {
  beforeEach(() => {
    __resetGpuCapabilityForTests();
  });

  it("引擎已用 WebGPU：可用", () => {
    expect(gpuGateOf({ available: true, backend: "webgpu" }).available).toBe(true);
  });

  it("引擎回退 WebGL：不可用并带统一原因", () => {
    const gate = gpuGateOf({ available: true, backend: "webgl" });
    expect(gate.available).toBe(false);
    expect(gate.reason).toBe(GPU_UNAVAILABLE_REASON);
  });

  it("引擎回退原因优先展示（WebGPU 创建失败细节）", () => {
    const gate = gpuGateOf({
      available: true,
      backend: "webgl",
      fallbackReason: "requestAdapter failed",
    });
    expect(gate.available).toBe(false);
    expect(gate.reason).toContain("requestAdapter failed");
  });

  it("项目显式 WebGL：即使探测支持也判定不可用", () => {
    const gate = gpuGateOf({ available: true, backend: null }, "webgl");
    expect(gate.available).toBe(false);
    expect(gate.reason).toContain("WebGL");
  });

  it("未挂载且探测不支持：不可用", () => {
    const gate = gpuGateOf({ available: false, backend: null });
    expect(gate.available).toBe(false);
    expect(gate.reason).toBe(GPU_UNAVAILABLE_REASON);
  });

  it("未挂载但探测支持且项目允许：可用", () => {
    expect(gpuGateOf({ available: true, backend: null }, "auto").available).toBe(true);
  });
});
