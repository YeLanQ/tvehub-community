import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 预览页错误可见性契约：入口模板的 #error 容器 + 启动看门狗，与 player 的首帧标志
// 必须成对存在——任何一侧被删/改名，黑屏会重新变成"只有控制台可见"。
const TEMPLATES = [
  "public/web-preview/index.html",
  "public/exports/web/multi/index.html",
  "public/exports/web/single/index.html",
];

const read = (rel: string): string => readFileSync(`${process.cwd()}/${rel}`, "utf8");

describe("预览页错误可见性", () => {
  it("三个入口模板都有 #error 容器与启动看门狗", () => {
    for (const rel of TEMPLATES) {
      const html = read(rel);
      expect(html).toContain('id="error"');
      expect(html).toContain("__tvePreviewBooted");
      expect(html).toContain("启动超时");
      expect(html).toContain("el.classList.add(\"visible\")");
    }
  });

  it("player 首帧置 booted；未处理拒绝与启动失败都进错误层", () => {
    const src = read("public/web-preview/player.mjs");
    expect(src).toContain("window.__tvePreviewBooted = true");
    expect(src).toContain('"unhandledrejection"');
    expect(src).toContain("main().catch(fail)");
    expect(src).toContain('addEventListener("error"');
  });
});
