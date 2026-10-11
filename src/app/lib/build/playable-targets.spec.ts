// ---------------------------------------------------------------------------
// 试玩广告目标注册表（TS 侧）：形状锚（与 Rust targets.rs 镜像对齐）+
// 形态展开 + 产物目录映射。Rust 侧同题单测 targets.rs::registry_shape。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  PLAYABLE_TARGETS,
  neededForms,
  playableTargetById,
  targetOutRel,
} from "./playable-targets";

describe("PLAYABLE_TARGETS 注册表", () => {
  it("形状锚：id 集 / 可用性 / 形态与 Rust 镜像一致", () => {
    expect(PLAYABLE_TARGETS.map((t) => t.id)).toEqual([
      "meta",
      "google",
      "mraid",
      "ironsource",
      "mintegral",
      "pangle",
    ]);
    // P0 三大通用族 + P2 核实过官方 spec 的 ironsource/mintegral 可用
    for (const t of PLAYABLE_TARGETS.slice(0, 5)) expect(t.available).toBe(true);
    // 占位目标不可用
    for (const t of PLAYABLE_TARGETS.slice(5)) expect(t.available).toBe(false);
    expect(playableTargetById("meta")?.form).toBe("single");
    // ironSource 并入 Unity Grow：官方 spec=单 HTML+MRAID 3.0（非历史 postMessage 多文件）
    expect(playableTargetById("ironsource")?.form).toBe("single");
    expect(playableTargetById("mintegral")?.form).toBe("multi");
    expect(playableTargetById("nope")).toBeNull();
  });
});

describe("neededForms 形态展开", () => {
  it("single 目标 → {single}；multi 目标 → {multi}（纯映射，不管 available）", () => {
    expect(neededForms(["meta", "google"])).toEqual(new Set(["single"]));
    expect(neededForms(["mintegral"])).toEqual(new Set(["multi"]));
  });

  it("both 展开两种形态；未知目标被忽略", () => {
    // 当前注册表无 both 目标：混勾 single+multi 得两形态（与 both 等效的产物面）
    expect(neededForms(["meta", "mintegral"])).toEqual(new Set(["single", "multi"]));
    expect(neededForms(["ironsource", "nope"]).has("single")).toBe(true);
    expect(neededForms([]).size).toBe(0);
  });
});

describe("targetOutRel 产物目录", () => {
  it("单一形态目标直接占目标目录", () => {
    expect(targetOutRel("meta", "single")).toBe("meta");
    expect(targetOutRel("mintegral", "multi")).toBe("mintegral");
  });

  it("未知目标回退目标目录（preflight 前的兜底形态）", () => {
    expect(targetOutRel("nope", "single")).toBe("nope");
  });
});
