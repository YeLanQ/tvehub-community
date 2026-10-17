import { describe, expect, it } from "vitest";
import { DEFAULT_MATERIAL_PARAMS } from "../../framework/material";
import {
  MATERIAL_WRITABLE_KEYS,
  coerceShaderProps,
  materialRelOf,
  parseMaterialPatch,
} from "./materialSet";
import { materialParamsForOutput } from "./materialOutput";

describe("materialRelOf 材质路径", () => {
  it("接受 path 与 rel 两种别名并统一反斜杠", () => {
    expect(materialRelOf({ path: "assets\\Materials\\Red.mat" })).toEqual({
      rel: "assets/Materials/Red.mat",
    });
    expect(materialRelOf({ rel: " assets/Materials/Red.mat " })).toEqual({
      rel: "assets/Materials/Red.mat",
    });
  });

  it("拒绝非 .mat 与内置只读目录", () => {
    const notMat = materialRelOf({ path: "assets/Red.json" });
    expect("error" in notMat && notMat.error).toContain(".mat");
    const internal = materialRelOf({ path: "internal/materials/Default.mat" });
    expect("error" in internal && internal.error).toContain("只读");
    const missing = materialRelOf({});
    expect("error" in missing && missing.error).toContain("path");
  });
});

describe("parseMaterialPatch 字段收敛", () => {
  it("颜色接受 #hex 与数字，数值字符串按数字收敛", () => {
    const out = parseMaterialPatch({
      path: "assets/Red.mat",
      props: { color: "#ff3300", roughness: "0.4" },
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.patch.values.color).toBe(0xff3300);
    // 未提供 metalness 等字段：只写入显式字段
    expect(out.patch.values.roughness).toBe(0.4);
    expect(out.patch.values.metalness).toBe(undefined);
  });

  it("布尔开关接受 true/false 字符串", () => {
    const out = parseMaterialPatch({
      path: "assets/Red.mat",
      props: { emissionEnabled: "true", wireframe: "false" },
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.patch.values.emissionEnabled).toBe(true);
    expect(out.patch.values.wireframe).toBe(false);
  });

  it("未知字段直接报错并列出可写集合", () => {
    const out = parseMaterialPatch({ path: "assets/Red.mat", props: { colour: "#fff" } });
    expect("error" in out).toBe(true);
    if (!("error" in out)) return;
    expect(out.error).toContain("未知材质属性: colour");
    expect(out.error).toContain(MATERIAL_WRITABLE_KEYS);
  });

  it("着色器参数可嵌套 props.props，顶层字段优先于 props", () => {
    const out = parseMaterialPatch({
      path: "assets/Red.mat",
      props: { color: "#000000", props: { uGlow: 1, uLabel: "a", uVec: [1, 2] } },
      color: "#ffffff",
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.patch.values.color).toBe(0xffffff);
    expect(out.patch.shaderProps).toEqual({ uGlow: 1, uLabel: "a", uVec: [1, 2] });
  });

  it("shader/name 提取；空修改报错", () => {
    const out = parseMaterialPatch({
      path: "assets/Red.mat",
      shader: "assets/Shaders\\X.shader",
      name: " Red ",
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.patch.shader).toBe("assets/Shaders/X.shader");
    expect(out.patch.name).toBe("Red");
    const empty = parseMaterialPatch({ path: "assets/Red.mat" });
    expect("error" in empty).toBe(true);
  });

  it("着色器参数拒绝对象值", () => {
    const out = coerceShaderProps({ uBad: { nested: 1 } });
    expect("error" in out && out.error).toContain("uBad");
  });

  it("越界数值被收敛并回报 clamped（不再静默）", () => {
    const out = parseMaterialPatch({
      path: "assets/Red.mat",
      props: { roughness: 9.5, ior: 0.2 },
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.patch.values.roughness).toBe(1);
    expect(out.patch.values.ior).toBe(1);
    expect(out.patch.clamped).toEqual(["roughness", "ior"]);
  });

  it("material.get 输出颜色统一为 #rrggbb（与 set 入参同形）", () => {
    const out = materialParamsForOutput({
      ...DEFAULT_MATERIAL_PARAMS,
      color: 0xb03a2e,
      emissive: 0x00ff00,
      roughness: 0.4,
    });
    expect(out.color).toBe("#b03a2e");
    expect(out.emissive).toBe("#00ff00");
    expect(out.roughness).toBe(0.4);
  });
});
