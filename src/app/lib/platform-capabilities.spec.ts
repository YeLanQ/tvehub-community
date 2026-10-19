import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPlatformCapabilitiesForTests,
  capability,
  DESKTOP_ONLY_REASON,
  ensurePlatformCapabilities,
  platformOs,
} from "./platform-capabilities";

describe("平台能力（浏览器环境）", () => {
  beforeEach(() => {
    __resetPlatformCapabilitiesForTests();
  });

  it("未加载时按可用处理（fail-open，避免误禁用）", () => {
    expect(capability("trash").available).toBe(true);
    expect(capability("selfUpdate").available).toBe(true);
    expect(platformOs()).toBe("unknown");
  });

  it("非 Tauri 环境全部不可用并给出统一原因", async () => {
    await ensurePlatformCapabilities();
    for (const id of ["trash", "selfUpdate", "selfUpdateApply", "lanMultiNic", "mcpBridge"] as const) {
      const cap = capability(id);
      expect(cap.available).toBe(false);
      expect(cap.reason).toBe(DESKTOP_ONLY_REASON);
    }
  });

  it("重复调用只初始化一次", async () => {
    await Promise.all([ensurePlatformCapabilities(), ensurePlatformCapabilities()]);
    expect(capability("trash").available).toBe(false);
  });
});
