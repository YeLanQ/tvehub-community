// ---------------------------------------------------------------------------
// playable 渠道导出期工件注入：按勾选目标所需形态注入双入口模板
// （index.html / index-multi.html），目标空集报错、不可用目标忽略。
// 模板列表注入 + fetch 桩（免 tauri IPC；与 runtime-supply.spec 同手法）。
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, it } from "vitest";
import { applyPlayableExportArtifacts } from "./playable-artifacts";
import type { BuildOptions } from "./options";
import type { ExportTemplateInfo } from "./web-artifacts";

const originalFetch = globalThis.fetch;

/** 双形态模板池（内置同构） */
const TEMPLATES: ExportTemplateInfo[] = [
  { id: "web:single", dir: "single", name: "单页模板", description: "", mode: "single", user: false },
  { id: "web:multi", dir: "multi", name: "多文件模板", description: "", mode: "multi", user: false },
];

/** 模板骨架桩：按 URL 区分两形态内容（fetchExportTemplateHtml 拉取内置模板走 fetch） */
function stubTemplateFetch(): void {
  globalThis.fetch = ((url: string | URL | Request) => {
    const href = String(url instanceof URL ? url.href : url);
    const body = href.includes("/single/")
      ? "single-entry"
      : href.includes("/multi/")
        ? "multi-entry"
        : "unknown-entry";
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(`<html><title>t</title><body>${body}</body></html>`),
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function opts(patch: Partial<BuildOptions>): BuildOptions {
  return {
    root: "r",
    channel: "playable",
    scenes: ["a.scene"],
    mainScene: "a.scene",
    title: "T",
    debug: false,
    templates: [],
    gzip: false,
    release: false,
    cdn: false,
    gzipBase: "",
    cdnBase: "",
    ...patch,
  } as BuildOptions;
}

describe("applyPlayableExportArtifacts 双形态入口注入", () => {
  it("单页目标 → 只注入 index.html（单页模板）", async () => {
    stubTemplateFetch();
    const files: Record<string, string> = {};
    const { singlePage } = await applyPlayableExportArtifacts(
      opts({ playableTargets: ["meta"] }),
      files,
      TEMPLATES,
    );
    expect(singlePage).toBe(false);
    expect(files["index.html"]).toContain("single-entry");
    expect(files["index-multi.html"]).toBeUndefined();
  });

  it("混勾两形态 → 双入口并存（index.html + index-multi.html）", async () => {
    stubTemplateFetch();
    const files: Record<string, string> = {};
    await applyPlayableExportArtifacts(
      opts({
        playableTargets: ["meta", "ironsource"],
        playableTemplates: { single: "web:single", multi: "web:multi" },
      }),
      files,
      TEMPLATES,
    );
    expect(files["index.html"]).toContain("single-entry");
    expect(files["index-multi.html"]).toContain("multi-entry");
  });

  it("页面标题写入 <title>", async () => {
    stubTemplateFetch();
    const files: Record<string, string> = {};
    await applyPlayableExportArtifacts(opts({ playableTargets: ["meta"], title: "MyGame" }), files, TEMPLATES);
    expect(files["index.html"]).toContain("<title>MyGame</title>");
  });

  it("目标空集 / 全不可用 → 报错", async () => {
    stubTemplateFetch();
    const files: Record<string, string> = {};
    await expect(applyPlayableExportArtifacts(opts({ playableTargets: [] }), files, TEMPLATES)).rejects.toThrow(
      "至少勾选",
    );
    await expect(
      applyPlayableExportArtifacts(opts({ playableTargets: ["pangle"] }), files, TEMPLATES),
    ).rejects.toThrow("至少勾选");
  });
});
