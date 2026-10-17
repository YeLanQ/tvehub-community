// node.set 参数解析与变换合并（纯函数，独立模块便于单测）。
// 支持两种调用形式：
// ① { id, prop, value } 单属性——devtools/MCP 历史契约；
// ② { id, ...fields } 字段包——助手/LLM 自然形态，name/visible/active/tag/
//    transform/position/rotation/scale 等任意混写。
// transform 与位移/旋转/缩放分量均按部分字段逐轴合并（未给的分量保持原值），
// 不整包覆盖；name 走重命名；其余属性整值补丁进一次撤销历史。

import type { JsonRecord, JsonValue } from "../../framework/prototype/types";
import type { TransformSnapshot } from "../../framework/scene/SceneClient";
import type { GeometryKind } from "../../framework/mesh/geometry";
import { GEOMETRY_KINDS } from "../../framework/mesh/geometry";

/** 解析成功的分类补丁 */
export interface NodeSetPatch {
  /** 重命名目标（name 字段；未提供为 undefined） */
  name?: string;
  /** 变换部分补丁（position/rotation/scale 逐轴合并） */
  transform?: Record<string, unknown>;
  /** 其余属性补丁（整值覆盖，一次撤销） */
  props?: JsonRecord;
}

/** 节点 JSON 中不可经 node.set 修改的字段：身份/层级/原型绑定 */
const FORBIDDEN = new Set(["id", "childIds", "parentId", "children", "type"]);
/** 归入变换合并的属性名 */
const TRANSFORM_KEYS = new Set(["transform", "position", "rotation", "scale"]);
const VEC_KEYS = ["x", "y", "z"] as const;

/** 解析 node.set 参数为分类补丁；不合法返回 { error } 供模型自纠 */
export function parseNodeSetArgs(args: unknown): { error: string } | { patch: NodeSetPatch } {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { error: "缺少参数（需 id 与待设置属性）" };
  }
  const raw = args as Record<string, unknown>;
  // prop/value 单属性形式优先；否则取字段包形式（排除调用标识字段）
  const pairs: Array<[string, unknown]> =
    raw.prop !== undefined
      ? [[String(raw.prop), raw.value]]
      : Object.entries(raw).filter(
          ([k]) => !["id", "prop", "value", "autoOpen", "root"].includes(k),
        );
  if (!pairs.length) return { error: "不支持设置的属性: (空)" };
  const patch: NodeSetPatch = {};
  const props: JsonRecord = {};
  for (const [prop, value] of pairs) {
    if (!prop) return { error: "不支持设置的属性: (空)" };
    if (FORBIDDEN.has(prop)) {
      return { error: `不支持设置的属性: ${prop}（身份/层级/类型不可改；换子节点用 node.add + node.remove）` };
    }
    if (prop === "name") {
      const name = String(value ?? "").trim();
      if (!name) return { error: "name 不能为空" };
      patch.name = name;
    } else if (TRANSFORM_KEYS.has(prop)) {
      const t = (patch.transform ??= {});
      if (prop === "transform") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { error: "transform 应为 {position/rotation/scale} 对象" };
        }
        Object.assign(t, value as Record<string, unknown>);
      } else {
        // 顶层 position/rotation/scale 视为对应分量的部分补丁
        t[prop] = value;
      }
    } else {
      props[prop] = value as JsonValue;
    }
  }
  if (!Object.keys(patch.transform ?? {}).length) delete patch.transform;
  if (Object.keys(props).length) patch.props = props;
  return { patch };
}

// ---------------------------------------------------------------------------
// 属性值收敛（属性命令通道的值域单源 = 引擎节点/组件实例本身）：
// 远端/助手惯把数值写成 "0.5"、布尔写成 "true"，原样透传会落进节点 JSON——
// 编辑器侧 JS 隐式转换看不出异常，播放运行时按严格 typeof 判定回落默认，
// 预览/导出就此丢光照阴影（2026-10-12 事故）。凡经 node.set /
// node.component.set 的补丁值一律按实例现有字段的类型归一。
// ---------------------------------------------------------------------------

type CoerceResult = { error: string } | { value: JsonValue };

/** 单值按模板类型收敛：number 认数字字符串，boolean 认 "true"/"false"/1/0 */
function coerceScalar(template: unknown, value: unknown, path: string): CoerceResult {
  if (typeof template === "number") {
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : NaN;
    if (!Number.isFinite(n)) return { error: `${path} 需要数值，收到 ${JSON.stringify(value)}` };
    return { value: n };
  }
  if (typeof template === "boolean") {
    if (typeof value === "boolean") return { value };
    if (value === "true" || value === 1) return { value: true };
    if (value === "false" || value === 0) return { value: false };
    return { error: `${path} 需要布尔，收到 ${JSON.stringify(value)}` };
  }
  if (typeof template === "string") {
    if (typeof value === "object" && value !== null) return { error: `${path} 需要字符串` };
    return { value: String(value) };
  }
  // 模板无类型信息（null/undefined/数组等）：原样透传，交引擎解析层兜底
  return { value: value as JsonValue };
}

/** 递归按形状收敛：模板对象逐键下钻（模板没有的键原样保留，交解析层取舍） */
export function coerceByShape(template: unknown, value: unknown, path: string): CoerceResult {
  if (template && typeof template === "object" && !Array.isArray(template)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: `${path} 应为对象，收到 ${JSON.stringify(value)}` };
    }
    const t = template as Record<string, unknown>;
    const v = value as Record<string, unknown>;
    const out: JsonRecord = {};
    for (const [k, val] of Object.entries(v)) {
      const sub = k in t ? coerceByShape(t[k], val, `${path}.${k}`) : ({ value: val as JsonValue } as CoerceResult);
      if ("error" in sub) return sub;
      out[k] = sub.value;
    }
    return { value: out };
  }
  return coerceScalar(template, value, path);
}

/** 不可经属性补丁触碰的字段：类型身份只读（components 另有专属分支指引组件命令） */
const NON_PATCHABLE = new Set(["typeKey", "kType"]);

/** 原型 getter（无 setter）判只读；字段在原型链上逐层找描述符 */
function isReadonlyField(target: object, key: string): boolean {
  let o: object | null = target;
  while (o) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d) return d.get !== undefined && d.set === undefined;
    o = Object.getPrototypeOf(o);
  }
  return false;
}

/** 可写属性名清单（未知属性报错时回给调用方，避免只能靠猜）：自身可写字段 + 原型可写访问器 */
function writablePropNames(node: object): string[] {
  const names = new Set<string>();
  const rec = node as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (key.startsWith("_") || NON_PATCHABLE.has(key) || key === "components") continue;
    if (isReadonlyField(node, key) || typeof rec[key] === "function") continue;
    names.add(key);
  }
  for (let o = Object.getPrototypeOf(node); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key.startsWith("_") || NON_PATCHABLE.has(key) || names.has(key)) continue;
      const d = Object.getOwnPropertyDescriptor(o, key);
      if (d?.get && d.set) names.add(key);
    }
  }
  return [...names].sort();
}

/**
 * 属性命令通道补丁收敛：未知/只读属性报错（回喂模型自纠，杜绝静默无效写），
 * 其余按节点实例字段类型归一。node = 类型化节点实例，实例形状即值域单源。
 */
export function coercePropsToNode(
  node: object,
  props: JsonRecord,
): { error: string } | { props: JsonRecord } {
  const rec = node as Record<string, unknown>;
  const out: JsonRecord = {};
  for (const [key, raw] of Object.entries(props)) {
    if (key === "components") {
      return {
        error: "组件列表不可整包改写：增删组件用 node.component.add，改组件属性用 node.component.set",
      };
    }
    if (NON_PATCHABLE.has(key)) {
      return { error: `属性 ${key} 只读，不可设置` };
    }
    if (!(key in rec)) {
      return {
        error: `节点无属性: ${key}（可设: ${writablePropNames(node).join("/")}；自定义数据放 properties 对象）`,
      };
    }
    if (key === "size") {
      const s = raw;
      if (!s || typeof s !== "object" || Array.isArray(s)) {
        return { error: "size 应为 {x,y,z} 对象" };
      }
      const size: Record<string, number> = {};
      for (const ax of VEC_KEYS) {
        const n = Number((s as Record<string, unknown>)[ax]);
        if (!Number.isFinite(n) || n <= 0) {
          return {
            error: `size.${ax} 需为正数，收到 ${JSON.stringify((s as Record<string, unknown>)[ax])}（尺寸 0/负数会让网格不可见）`,
          };
        }
        size[ax] = n;
      }
      out[key] = size;
      continue;
    }
    if (key === "geometry") {
      const geom = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!GEOMETRY_KINDS.includes(geom as GeometryKind)) {
        return {
          error: `geometry 非法: ${JSON.stringify(raw)}（可选: ${GEOMETRY_KINDS.join("/")}）`,
        };
      }
      out[key] = geom;
      continue;
    }
    if (key === "material") {
      if (typeof raw !== "string" || !raw.trim().toLowerCase().endsWith(".mat")) {
        return {
          error: "material 需要 .mat 资产相对路径字符串；材质属性用 material.set {path, props}",
        };
      }
      out[key] = raw.trim();
      continue;
    }
    if (isReadonlyField(node, key)) {
      return { error: `属性 ${key} 只读，不可设置` };
    }
    const cur = rec[key];
    if (typeof cur === "function") {
      return { error: `属性 ${key} 是方法，不可设置` };
    }
    const res = coerceByShape(cur, raw, key);
    if ("error" in res) return res;
    out[key] = res.value;
  }
  return { props: out };
}

/** 当前变换快照（度制欧拉，与文件格式同构） */
export function currentTransform(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): TransformSnapshot {
  return {
    position: { ...position },
    rotation: { ...rotation },
    scale: { ...scale },
  };
}

/** 变换部分补丁逐轴合并：未给的分量保持 current 原值；非法值返回 { error } */
export function mergeTransformSnapshot(
  current: TransformSnapshot,
  patch: Record<string, unknown>,
): { error: string } | { snapshot: TransformSnapshot } {
  const unknownKeys = Object.keys(patch).filter(
    (k) => !(["position", "rotation", "scale"] as const).includes(k as "position"),
  );
  if (unknownKeys.length) {
    return { error: `transform 含未知分量: ${unknownKeys.join("/")}（应为 position/rotation/scale）` };
  }
  const snapshot = currentTransform(current.position, current.rotation, current.scale);
  for (const key of ["position", "rotation", "scale"] as const) {
    const v = patch[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "object" || Array.isArray(v)) {
      return { error: `transform.${key} 应为 {x,y,z} 对象` };
    }
    const p = v as Record<string, unknown>;
    for (const ax of VEC_KEYS) {
      if (p[ax] === undefined || p[ax] === null) continue;
      const n = Number(p[ax]);
      if (!Number.isFinite(n)) {
        return { error: `transform.${key}.${ax} 不是数值` };
      }
      snapshot[key][ax] = n;
    }
    const unknown = Object.keys(p).filter((k) => !VEC_KEYS.includes(k as "x" | "y" | "z"));
    if (unknown.length) {
      return { error: `transform.${key} 含未知分量: ${unknown.join("/")}（应为 x/y/z）` };
    }
  }
  return { snapshot };
}
