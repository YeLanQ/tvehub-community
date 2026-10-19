import { describe, expect, it } from "vitest";
import { resolveSiblingAssetUrl } from "./model-url-resolve";

const BASE = "http://asset.localhost/p/assets/models";

describe("resolveSiblingAssetUrl", () => {
  it("同目录外部资源：拼到模型目录 URL 下", () => {
    expect(resolveSiblingAssetUrl(BASE, "Textures/colormap.png")).toBe(
      "http://asset.localhost/p/assets/models/Textures/colormap.png",
    );
  });

  it("../ 回溯到模型目录之外（模型换目录后的相对引用）", () => {
    expect(resolveSiblingAssetUrl(BASE, "../kenney/Models/Textures/colormap.png")).toBe(
      "http://asset.localhost/p/assets/kenney/Models/Textures/colormap.png",
    );
  });

  it("../ 深层回溯并保留资产作用域", () => {
    expect(resolveSiblingAssetUrl(BASE, "../../../p/evil.png")).toBe(
      "http://asset.localhost/p/p/evil.png",
    );
    expect(resolveSiblingAssetUrl(BASE, "../../../../../../evil.png")).toBe(
      "http://asset.localhost/p/evil.png",
    );
  });

  it("百分号编码的路径先解码再按段重新编码", () => {
    expect(resolveSiblingAssetUrl(BASE, "GLB%20format/Textures/c%20map.png")).toBe(
      "http://asset.localhost/p/assets/models/GLB%20format/Textures/c%20map.png",
    );
  });

  it("忽略 . 与空段、容忍反斜杠", () => {
    expect(resolveSiblingAssetUrl(`${BASE}/`, "./a//b.png")).toBe(
      "http://asset.localhost/p/assets/models/a/b.png",
    );
    expect(resolveSiblingAssetUrl(BASE, "a\\b.png")).toBe(
      "http://asset.localhost/p/assets/models/a/b.png",
    );
  });

  it("绝对地址原样返回", () => {
    for (const url of [
      "https://x/y.png",
      "data:image/png;base64,AAA",
      "blob:abc",
      "asset://localhost/p/x.png",
    ]) {
      expect(resolveSiblingAssetUrl(BASE, url)).toBe(url);
    }
  });

  it("空地址与纯回溯（无文件名）原样返回", () => {
    expect(resolveSiblingAssetUrl(BASE, "")).toBe("");
    expect(resolveSiblingAssetUrl(BASE, "..")).toBe("..");
  });
});
