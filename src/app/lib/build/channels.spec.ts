// ---------------------------------------------------------------------------
// 渠道注册表 · playable adapter：extraIpc 只下发可用目标、ipc applies 收敛
// （singlePage/cdn 不适用按 defaults 进载荷，title/gzip 生效）。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { BUILD_CHANNELS, buildIpcArgs, getBuildChannel } from "./channels";
import type { BuildOptions } from "./options";

function opts(patch: Partial<BuildOptions>): BuildOptions {
  return {
    root: "r",
    channel: "playable",
    scenes: ["a.scene"],
    mainScene: "a.scene",
    title: "T",
    debug: false,
    templates: [],
    gzip: true,
    release: false,
    cdn: true,
    gzipBase: "",
    cdnBase: "",
    playableTargets: ["meta", "pangle", "nope"],
    ...patch,
  } as BuildOptions;
}

describe("playable 渠道 adapter", () => {
  it("渠道注册表含三渠道，playable 可用", () => {
    expect(BUILD_CHANNELS.map((c) => c.id)).toEqual(["web", "wechat", "playable"]);
    expect(getBuildChannel("playable").supported).toBe(true);
  });

  it("extraIpc 只下发注册表内的可用目标（占位/未知目标过滤）", () => {
    const args = buildIpcArgs(opts({}), {}, false);
    expect(args.playableTargets).toEqual(["meta"]);
  });

  it("ipc 收敛：singlePage/cdn 不适用按 defaults（false），title/gzip 生效", () => {
    const args = buildIpcArgs(opts({ title: "Playable" }), {}, true);
    expect(args.singlePage).toBe(false);
    expect(args.cdn).toBe(false);
    expect(args.title).toBe("Playable");
    expect(args.gzip).toBe(true);
    expect(args.channel).toBe("playable");
  });
});
