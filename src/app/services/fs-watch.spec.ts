import { describe, expect, it } from "vitest";
import { assetKindOf } from "./fs-watch";

describe("assetKindOf 资产类型判定（fs-changed 与 asset.refresh 共用）", () => {
  it("材质/着色器/脚本/场景按扩展名分派", () => {
    expect(assetKindOf("assets/Materials/Red.mat")).toBe("material");
    expect(assetKindOf("assets/Shaders/X.shader")).toBe("shader");
    expect(assetKindOf("src/Player.ts")).toBe("script");
    expect(assetKindOf("scenes/Main.scene")).toBe("scene");
  });

  it("贴图/模型/音频/TextureCube 走各自缓存", () => {
    expect(assetKindOf("assets/Textures/a.PNG")).toBe("texture");
    expect(assetKindOf("assets/Models/a.glb")).toBe("model");
    expect(assetKindOf("assets/Audio/a.wav")).toBe("audio");
    expect(assetKindOf("assets/Sky/day.texcube")).toBe("texcube");
  });

  it("未知类型只触发资产面板重扫", () => {
    expect(assetKindOf("assets/notes.txt")).toBe("unknown");
    expect(assetKindOf("assets/.meta")).toBe("unknown");
    expect(assetKindOf("noext")).toBe("unknown");
  });
});
