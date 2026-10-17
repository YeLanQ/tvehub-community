import { describe, expect, it } from "vitest";
import { resolveAssetTarget } from "./assetCreateArgs";

describe("resolveAssetTarget 资产目标解析", () => {
  it("path 形态拆出目录与文件名（不再落到项目根）", () => {
    expect(
      resolveAssetTarget({ type: "material", path: "assets/Materials/Red.mat" }),
    ).toEqual({ target: { dir: "assets/Materials", stem: "Red.mat" } });
    expect(resolveAssetTarget({ type: "material", path: "Root.mat" })).toEqual({
      target: { dir: "", stem: "Root.mat" },
    });
  });

  it("dir/name 形态保持历史语义", () => {
    expect(resolveAssetTarget({ type: "material", dir: "assets/Mats/", name: "Red" })).toEqual({
      target: { dir: "assets/Mats", stem: "Red" },
    });
  });

  it("path 与 dir/name 互斥；非法路径报错", () => {
    const both = resolveAssetTarget({
      type: "material",
      path: "assets/Red.mat",
      dir: "assets",
    });
    expect("error" in both && both.error).toContain("不能同时使用");
    const escape = resolveAssetTarget({ type: "material", path: "assets/../Red.mat" });
    expect("error" in escape && escape.error).toContain("非法");
    const abs = resolveAssetTarget({ type: "material", path: "/Red.mat" });
    expect("error" in abs && abs.error).toContain("非法");
  });

  it("扩展名与类型不符报错", () => {
    const out = resolveAssetTarget({ type: "material", path: "assets/Red.scene" });
    expect("error" in out && out.error).toContain(".mat");
  });

  it("脚本只能落 src/", () => {
    const out = resolveAssetTarget({ type: "script", path: "assets/Player.ts" });
    expect("error" in out && out.error).toContain("src/");
    expect(resolveAssetTarget({ type: "script", path: "src/Player.ts" })).toEqual({
      target: { dir: "src", stem: "Player.ts" },
    });
  });
});
