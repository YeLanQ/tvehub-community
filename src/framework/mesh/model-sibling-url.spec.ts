import { describe, expect, it } from "vitest";
import { resolveSiblingRel } from "./model-sibling-url";

// 模型同目录资源地址归一化：幂等剥前缀、回溯、协议放行与非法输入。

describe("resolveSiblingRel", () => {
  it("加载器已拼 resourcePath 前缀时幂等剥掉（不产生双前缀）", () => {
    // GLTFLoader.parse 先把 resourcePath 拼进地址再过 URL 修饰器；
    // 修饰器输出恒为「目录/资源」，原始 uri 与已拼前缀地址解析结果一致（幂等）
    const prefixed = resolveSiblingRel("m/KY2DM", "m/KY2DM/Textures/a.png");
    expect(prefixed).toBe("m/KY2DM/Textures/a.png");
    expect(resolveSiblingRel("m/KY2DM", prefixed as string)).toBe(prefixed); // 幂等（上一行已断言非空）
    // 修饰器拿到原始 uri（worker 空路径 parse）时补目录前缀
    expect(resolveSiblingRel("m/KY2DM", "Textures/a.png")).toBe("m/KY2DM/Textures/a.png");
    expect(resolveSiblingRel("", "a.png")).toBe("a.png");
  });

  it("../ 回溯与 ./ 前缀", () => {
    expect(resolveSiblingRel("m/a", "../shared/tex.png")).toBe("m/shared/tex.png");
    expect(resolveSiblingRel("m/a", "./Textures/a.png")).toBe("m/a/Textures/a.png");
    // 连续 .. 弹空栈静默（与运行时 resolveSiblingUrl 同语义；越界读由后端沙箱拦截）
    expect(resolveSiblingRel("m/a", "../../../out.png")).toBe("out.png");
  });

  it("绝对地址与协议地址放行（返回 null）", () => {
    for (const url of [
      "https://cdn.example.com/a.png",
      "data:image/png;base64,AAA",
      "blob:https://app/x",
      "file:///C:/x.png",
      "asset://localhost/C%3A/x.png",
    ]) {
      expect(resolveSiblingRel("m", url)).toBeNull();
    }
  });

  it("非法输入返回 null", () => {
    expect(resolveSiblingRel("m", "")).toBeNull();
    expect(resolveSiblingRel("m", "C:\\x.png")).toBeNull();
    expect(resolveSiblingRel("m", "a.png?v=2")).toBe("m/a.png"); // query 剥离
    expect(resolveSiblingRel("m", "/root/a.png")).toBe("m/root/a.png"); // 剥根斜杠
    expect(resolveSiblingRel("m", "Texture%201.png")).toBe("m/Texture 1.png"); // 百分号解码
  });
});
