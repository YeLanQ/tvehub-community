import { describe, expect, it } from "vitest";
import { type TransformSnapshot } from "../../framework/scene/SceneClient";
import type { JsonRecord } from "../../framework/prototype/types";
import {
  coerceByShape,
  coercePropsToNode,
  currentTransform,
  mergeTransformSnapshot,
  parseNodeSetArgs,
  type NodeSetPatch,
} from "./nodeSet";
import { PointLightNode } from "../../framework/prototype/nodes/PointLightNode";
import { MeshNode } from "../../framework/prototype/nodes/MeshNode";
import { Node } from "../../framework/prototype/Node";

/** 断言解析成功并返回补丁（失败即测试失败） */
function parsed(args: unknown): NodeSetPatch {
  const out = parseNodeSetArgs(args);
  if ("error" in out) throw new Error(`应解析成功: ${out.error}`);
  return out.patch;
}

/** 断言解析失败并返回错误文案 */
function parseError(args: unknown): string {
  const out = parseNodeSetArgs(args);
  if (!("error" in out)) throw new Error("应解析失败");
  return out.error;
}

/** 断言合并成功并返回快照 */
function merged(current: TransformSnapshot, patch: Record<string, unknown>): TransformSnapshot {
  const out = mergeTransformSnapshot(current, patch);
  if ("error" in out) throw new Error(`应合并成功: ${out.error}`);
  return out.snapshot;
}

/** 断言合并失败并返回错误文案 */
function mergeError(current: TransformSnapshot, patch: Record<string, unknown>): string {
  const out = mergeTransformSnapshot(current, patch);
  if (!("error" in out)) throw new Error("应合并失败");
  return out.error;
}

describe("parseNodeSetArgs", () => {
  it("正常：prop/value 单属性形式（历史契约）", () => {
    expect(parsed({ id: "a", prop: "visible", value: false }).props).toEqual({ visible: false });
    expect(parsed({ id: "a", prop: "visible", value: false }).name).toBeUndefined();
  });

  it("协议级参数 autoOpen/root 不当作节点属性", () => {
    const patch = parsed({ id: "a", autoOpen: false, root: "D:/P", visible: true });
    expect(patch.props).toEqual({ visible: true });
  });

  it("正常：字段包形式 name+transform+visible 混写分类正确", () => {
    const patch = parsed({
      id: "a",
      name: "Ground",
      visible: true,
      transform: { position: { x: 1, y: 2, z: 3 } },
    });
    expect(patch.name).toBe("Ground");
    expect(patch.transform).toEqual({ position: { x: 1, y: 2, z: 3 } });
    expect(patch.props).toEqual({ visible: true });
  });

  it("正常：顶层 position/scale 归入变换补丁，其余进属性补丁", () => {
    const patch = parsed({
      id: "a",
      position: { x: 5 },
      scale: { x: 2, y: 2, z: 2 },
      tag: "floor",
    });
    expect(patch.transform).toEqual({ position: { x: 5 }, scale: { x: 2, y: 2, z: 2 } });
    expect(patch.props).toEqual({ tag: "floor" });
  });

  it("正常：prop=transform 的 value 对象同样进入变换通道", () => {
    expect(
      parsed({ id: "a", prop: "transform", value: { rotation: { x: 90, y: 0, z: 0 } } }).transform,
    ).toEqual({ rotation: { x: 90, y: 0, z: 0 } });
  });

  it("边界：transform 空对象不产生变换补丁；仅 name 时无属性补丁", () => {
    const patch = parsed({ id: "a", name: "X", transform: {} });
    expect(patch.transform).toBeUndefined();
    expect(patch.props).toBeUndefined();
    expect(patch.name).toBe("X");
  });

  it("异常：禁改字段 id/childIds/parentId/children/type 逐一拒绝", () => {
    for (const prop of ["id", "childIds", "parentId", "children", "type"]) {
      expect(parseError({ id: "a", [prop]: "x" })).toContain("不支持设置的属性");
    }
  });

  it("异常：空 name / 非对象 transform 报错可读", () => {
    expect(parseError({ id: "a", name: "  " })).toBeTruthy();
    expect(parseError({ id: "a", transform: 3 })).toContain("对象");
  });

  it("空值：无属性 / 非对象参数 / 数组参数报错", () => {
    expect(parseError({ id: "a" })).toContain("(空)");
    expect(parseError({ id: "a", prop: "", value: 1 })).toContain("(空)");
    expect(parseError(null)).toBeTruthy();
    expect(parseError(["x"])).toBeTruthy();
  });
});

describe("mergeTransformSnapshot", () => {
  const base = currentTransform({ x: 1, y: 2, z: 3 }, { x: 0, y: 90, z: 0 }, { x: 1, y: 1, z: 1 });

  it("正常：部分分量合并，未给分量保持原值", () => {
    const snapshot = merged(base, { position: { x: 9 } });
    expect(snapshot.position).toEqual({ x: 9, y: 2, z: 3 });
    expect(snapshot.rotation).toEqual({ x: 0, y: 90, z: 0 });
    expect(snapshot.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("正常：全分量整体覆盖（节点 add 后落位形态）", () => {
    const snapshot = merged(base, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 45, y: 45, z: 45 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(snapshot.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(snapshot.rotation).toEqual({ x: 45, y: 45, z: 45 });
    expect(snapshot.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("边界：空补丁原样返回；数值字符串分量可解析", () => {
    expect(merged(base, {})).toEqual(base);
    expect(merged(base, { position: { y: "4" } }).position).toEqual({ x: 1, y: 4, z: 3 });
  });

  it("异常：分量非对象 / 非数值 / 未知键报错指明字段", () => {
    expect(mergeError(base, { position: 5 })).toContain("position");
    expect(mergeError(base, { scale: { x: "big" } })).toContain("scale.x");
    expect(mergeError(base, { foo: { x: 1 } })).toContain("foo");
    expect(mergeError(base, { position: { w: 1 } })).toContain("position");
  });
});

describe("coercePropsToNode（属性命令通道值域收敛）", () => {
  // 2026-10-12 事故回放：助手把 intensity 写成 "0.5" 字符串落进节点 JSON，
  // 编辑器 JS 隐式转换看不出异常，播放运行时严格 typeof 识别不到回落默认，
  // 预览/导出光照阴影异常。所有经 node.set 的补丁值必须按实例字段类型归一。
  const light = new PointLightNode({ name: "L", castShadow: true });

  /** 断言收敛失败并返回错误文案 */
  function coerceError(out: { error: string } | { value: unknown } | { props: JsonRecord }): string {
    if (!("error" in out)) throw new Error("应收敛失败");
    return out.error;
  }

  it("正常：数字字符串按字段类型转数值（intensity/distance/shadow.radius）", () => {
    const out = coercePropsToNode(light, { intensity: "0.5", distance: "8" });
    if ("error" in out) throw new Error(`应收敛成功: ${out.error}`);
    expect(out.props).toEqual({ intensity: 0.5, distance: 8 });
    // 嵌套配置对象逐键下钻同样收敛
    const sh = coerceByShape(light.shadow, { radius: "1", strength: "0.8" }, "shadow");
    if ("error" in sh) throw new Error(`应收敛成功: ${sh.error}`);
    expect(sh.value).toEqual({ radius: 1, strength: 0.8 });
  });

  it("正常：布尔字段认 \"true\"/\"false\"/1/0（castShadow 字符串不再漏进 JSON）", () => {
    const out = coercePropsToNode(light, { castShadow: "true" });
    if ("error" in out) throw new Error(`应收敛成功: ${out.error}`);
    expect(out.props).toEqual({ castShadow: true });
    const off = coercePropsToNode(light, { castShadow: "false" });
    if ("error" in off) throw new Error(`应收敛成功: ${off.error}`);
    expect(off.props).toEqual({ castShadow: false });
    expect(coerceByShape(true, 1, "x")).toEqual({ value: true });
    expect(coerceByShape(false, 0, "x")).toEqual({ value: false });
  });

  it("边界：properties 自由属性表放行；形状外的新键原样透传交解析层取舍", () => {
    const n = new Node({ name: "N" });
    const out = coercePropsToNode(n, { properties: { hp: "100", note: "x" } });
    if ("error" in out) throw new Error(`应收敛成功: ${out.error}`);
    expect(out.props).toEqual({ properties: { hp: "100", note: "x" } });
    const sh = coerceByShape(light.shadow, { custom: "v" }, "shadow");
    if ("error" in sh) throw new Error(`应收敛成功: ${sh.error}`);
    expect(sh.value).toEqual({ custom: "v" });
  });

  it("异常：未知属性 / 组件列表 / 只读字段报错自纠，不静默落盘", () => {
    expect(coerceError(coercePropsToNode(light, { shadows: true }))).toContain("节点无属性");
    expect(coerceError(coercePropsToNode(light, { components: [] }))).toContain("node.component");
    expect(coerceError(coercePropsToNode(light, { typeKey: "x" }))).toContain("只读");
    expect(coerceError(coercePropsToNode(light, { isRoot: true }))).toContain("只读");
  });

  it("异常：类型不兼容报错指明字段（数值字段收非数 / 布尔字段收任意串）", () => {
    expect(coerceError(coercePropsToNode(light, { intensity: "bright" }))).toContain("intensity");
    expect(coerceError(coercePropsToNode(light, { castShadow: "yes" }))).toContain("castShadow");
    expect(coerceError(coerceByShape(light.shadow, 3, "shadow"))).toContain("对象");
  });

  it("异常：size 零/负数拒绝写入；合法 size 收敛为数值", () => {
    const mesh = new MeshNode({ name: "M" });
    const zero = coerceError(coercePropsToNode(mesh, { size: { x: 0, y: 1, z: 1 } }));
    expect(zero).toContain("size.x");
    const negative = coerceError(coercePropsToNode(mesh, { size: { x: -5, y: 1, z: 1 } }));
    expect(negative).toContain("正数");
    const ok = coercePropsToNode(mesh, { size: { x: "2", y: 1, z: 0.5 } });
    if ("error" in ok) throw new Error(`应收敛成功: ${ok.error}`);
    expect(ok.props).toEqual({ size: { x: 2, y: 1, z: 0.5 } });
  });

  it("异常：geometry 非法值拒绝写入（不再静默落进场景文件）", () => {
    const mesh = new MeshNode({ name: "M" });
    const bad = coerceError(coercePropsToNode(mesh, { geometry: "nope" }));
    expect(bad).toContain("geometry 非法");
    expect(bad).toContain("box");
    const ok = coercePropsToNode(mesh, { geometry: "Sphere" });
    if ("error" in ok) throw new Error(`应收敛成功: ${ok.error}`);
    expect(ok.props).toEqual({ geometry: "sphere" });
  });

  it("异常：material 只接受 .mat 路径；未知属性回传可写属性清单", () => {
    const mesh = new MeshNode({ name: "M" });
    expect(coerceError(coercePropsToNode(mesh, { material: "Wall.json" }))).toContain(".mat");
    const ok = coercePropsToNode(mesh, { material: "assets/Materials/Red.mat" });
    if ("error" in ok) throw new Error(`应收敛成功: ${ok.error}`);
    expect(ok.props).toEqual({ material: "assets/Materials/Red.mat" });
    const unknown = coerceError(coercePropsToNode(mesh, { bogusKey: 1 }));
    expect(unknown).toContain("节点无属性: bogusKey");
    expect(unknown).toContain("可设:");
    expect(unknown).toContain("material");
  });
});
