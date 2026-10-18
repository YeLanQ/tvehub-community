// ---------------------------------------------------------------------------
// 项目设置草稿 ↔ project.config.json 序列化（纯函数部分）：
// performance 批处理开关（instancing/batching，缺省开）的解析、序列化与双向往返。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { configFromDraft, defaultDraft, draftFromConfig } from "./project-settings";

describe("project-settings performance 批处理开关", () => {
  it("正常：默认草稿两项均开启，序列化写入 performance 块", () => {
    const draft = defaultDraft();
    expect(draft.instancingEnabled).toBe(true);
    expect(draft.batchingEnabled).toBe(true);
    const cfg = configFromDraft(draft);
    expect(cfg.performance).toEqual({ instancing: true, batching: true });
  });

  it("正常：显式关闭后序列化保留 false，往返解析不回弹", () => {
    const draft = { ...defaultDraft(), instancingEnabled: false, batchingEnabled: false };
    const parsed = draftFromConfig(configFromDraft(draft));
    expect(parsed.instancingEnabled).toBe(false);
    expect(parsed.batchingEnabled).toBe(false);
  });

  it("正常：混合开关（关实例化留合并）往返各自保持", () => {
    const draft = { ...defaultDraft(), instancingEnabled: false };
    const parsed = draftFromConfig(configFromDraft(draft));
    expect(parsed.instancingEnabled).toBe(false);
    expect(parsed.batchingEnabled).toBe(true);
  });

  it("边界：performance 块缺单键按缺省开（与 player !== false 口径一致）", () => {
    const parsed = draftFromConfig({ performance: { instancing: false } });
    expect(parsed.instancingEnabled).toBe(false);
    expect(parsed.batchingEnabled).toBe(true);
  });

  it("异常：performance 块为 null/标量/数组时不抛错，整块回默认开", () => {
    expect(draftFromConfig({ performance: null }).instancingEnabled).toBe(true);
    expect(draftFromConfig({ performance: 42 }).batchingEnabled).toBe(true);
    expect(draftFromConfig({ performance: [] }).instancingEnabled).toBe(true);
  });

  it("异常：performance 键值为非布尔类型按 !== false 收敛为开", () => {
    const parsed = draftFromConfig({ performance: { instancing: "no", batching: 0 } });
    expect(parsed.instancingEnabled).toBe(true);
    expect(parsed.batchingEnabled).toBe(true);
  });

  it("空值：无配置对象 → 全默认（两项开）", () => {
    const parsed = draftFromConfig(undefined);
    expect(parsed.instancingEnabled).toBe(true);
    expect(parsed.batchingEnabled).toBe(true);
  });

  it("往返：其余既有字段随新增块一并保留（不回归）", () => {
    const draft = {
      ...defaultDraft(),
      version: "1.2.3",
      hdrMode: "hdr" as const,
      physicsEnabled: true,
      instancingEnabled: false,
    };
    const cfg = configFromDraft(draft);
    expect(cfg.version).toBe("1.2.3");
    expect(cfg.hdrMode).toBe("hdr");
    expect((cfg.physics as { physicsEnabled: boolean }).physicsEnabled).toBe(true);
    const parsed = draftFromConfig(cfg);
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.hdrMode).toBe("hdr");
    expect(parsed.physicsEnabled).toBe(true);
    expect(parsed.instancingEnabled).toBe(false);
  });
});
