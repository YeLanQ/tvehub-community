// material.set/material.get 的参数解析与字段收敛（纯函数，独立便于单测）。
// 字段面以 DEFAULT_MATERIAL_PARAMS 为单一来源；未知字段直接报错并列出可写集合，
// 不再静默丢弃（外部 Agent 拼错 color→colour 时能立即自纠）。

import {
  DEFAULT_MATERIAL_PARAMS,
  type MaterialParamKey,
  type MaterialPropValue,
  clampMaterialParam,
  isInternalMaterialRel,
  isTextureParamKey,
  parseColorHex,
} from "../../framework/material";
import { asBool, asRecord } from "./args";

/** 材质字段值（PBR 参数含布尔开关；着色器 props 另由 materialPropsFrom 面收敛） */
export type MaterialPatchValue = number | string | number[] | boolean;

/** 材质颜色字段（值既接受数字也接受 #hex 字符串） */
const COLOR_KEYS = new Set([
  "color",
  "specularColor",
  "emissive",
  "sheenColor",
  "attenuationColor",
  "outlineColor",
]);

/** 布尔开关字段（含效果分组的启用开关） */
const BOOL_KEYS = new Set([
  "emissionEnabled",
  "clearcoatEnabled",
  "sheenEnabled",
  "transmissionEnabled",
  "outlineEnabled",
  "wireframe",
]);

/** 可写字段全集（.mat 参数面以默认参数对象为单一来源） */
const PARAM_KEYS = new Set(Object.keys(DEFAULT_MATERIAL_PARAMS));

/** 可写字段清单（报错提示用） */
export const MATERIAL_WRITABLE_KEYS = [...PARAM_KEYS].sort().join("/");

/** 是否颜色字段（material.get 输出转 #rrggbb 用） */
export function isMaterialColorKey(key: string): boolean {
  return COLOR_KEYS.has(key);
}

/** 入参保留字：不属于材质参数字段 */
const RESERVED = new Set(["path", "rel", "props", "params", "shader", "name", "autoOpen", "root"]);

/** 数值字符串宽容（外部 Agent 常把 0.4 写成 "0.4"） */
function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 单字段收敛（颜色/布尔/贴图/数值分别校验）；clamped 表示越界值被收敛 */
export function coerceMaterialField(
  key: string,
  value: unknown,
): { value: MaterialPatchValue; clamped?: boolean } | { error: string } {
  if (COLOR_KEYS.has(key)) {
    if (typeof value === "string") {
      const hex = value.trim().replace(/^#/, "");
      if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) {
        return { error: `${key} 需要 #rrggbb 颜色或数字，收到 ${JSON.stringify(value)}` };
      }
      return { value: parseColorHex(value) };
    }
    const n = asFiniteNumber(value);
    if (n === null) return { error: `${key} 需要 #rrggbb 颜色或数字，收到 ${JSON.stringify(value)}` };
    return { value: n & 0xffffff, clamped: n !== (n & 0xffffff) };
  }
  if (BOOL_KEYS.has(key)) {
    const b = asBool(value);
    if (b === undefined) {
      return { error: `${key} 需要布尔值（true/false），收到 ${JSON.stringify(value)}` };
    }
    return { value: b };
  }
  if (isTextureParamKey(key as MaterialParamKey)) {
    if (typeof value !== "string") {
      return { error: `${key} 是贴图通道，需要资产相对路径字符串（空串 = 无贴图）` };
    }
    return { value };
  }
  const n = asFiniteNumber(value);
  if (n === null) return { error: `${key} 需要数值，收到 ${JSON.stringify(value)}` };
  const clamped = clampMaterialParam(key as MaterialParamKey, n);
  return { value: clamped, clamped: clamped !== n };
}

/** 着色器 Properties 参数包（值只收数字/字符串/数字数组） */
export function coerceShaderProps(
  v: unknown,
): { props: Record<string, MaterialPropValue> } | { error: string } {
  const rec = asRecord(v);
  if (!rec) return { error: "props.props（着色器参数）应为对象" };
  const out: Record<string, MaterialPropValue> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n))) {
      out[key] = value;
    } else {
      return {
        error: `props.props.${key} 只接受数字/字符串/数字数组，收到 ${JSON.stringify(value)}`,
      };
    }
  }
  return { props: out };
}

/** 材质路径参数（path/rel 别名；必须 .mat 且不在只读内置目录） */
export function materialRelOf(args: Record<string, unknown>): { rel: string } | { error: string } {
  const raw = args.path ?? args.rel;
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "缺少 path（.mat 资产相对路径，如 assets/Materials/Red.mat）" };
  }
  const rel = raw.trim().replace(/\\/g, "/");
  if (!rel.toLowerCase().endsWith(".mat")) {
    return { error: `material.* 只处理 .mat 材质资产，收到: ${rel}` };
  }
  if (isInternalMaterialRel(rel)) {
    return {
      error:
        "internal/ 下是引擎内置材质（只读）；先 asset.create type=material 建项目材质再写属性",
    };
  }
  return { rel };
}

export interface MaterialPatch {
  /** 直接写入 MaterialParams 的字段（PBR/贴图/开关） */
  values: Record<string, MaterialPatchValue>;
  /** 合并进 params.props 的着色器参数 */
  shaderProps?: Record<string, MaterialPropValue>;
  /** 切换挂载的着色器（未提供 = 保持原引用） */
  shader?: string;
  /** 材质显示名（未提供 = 沿用文件名） */
  name?: string;
  /** 实际写入的字段名（返回值用） */
  updated: string[];
  /** 越界被收敛的字段（如 roughness=9.5 → 1）；调用方据此提示而非静默 */
  clamped: string[];
}

/** 解析 material.set 参数：props/params 别名 + 顶层平铺（顶层优先） */
export function parseMaterialPatch(
  args: Record<string, unknown>,
): { patch: MaterialPatch } | { error: string } {
  const bag: Record<string, unknown> = {
    ...(asRecord(args.props) ?? asRecord(args.params) ?? {}),
  };
  for (const [key, value] of Object.entries(args)) {
    if (!RESERVED.has(key)) bag[key] = value;
  }
  if (args.shader !== undefined && (typeof args.shader !== "string" || !args.shader.trim())) {
    return { error: "shader 需要 .shader 资产相对路径字符串" };
  }
  if (!Object.keys(bag).length && args.shader === undefined && args.name === undefined) {
    return {
      error: `缺少待修改字段（props 或顶层材质参数；可写字段: ${MATERIAL_WRITABLE_KEYS}）`,
    };
  }

  const patch: MaterialPatch = { values: {}, updated: [], clamped: [] };
  for (const [key, value] of Object.entries(bag)) {
    if (key === "props") {
      const nested = coerceShaderProps(value);
      if ("error" in nested) return { error: nested.error };
      patch.shaderProps = { ...(patch.shaderProps ?? {}), ...nested.props };
      patch.updated.push("props");
      continue;
    }
    if (!PARAM_KEYS.has(key)) {
      return {
        error: `未知材质属性: ${key}（可写字段: ${MATERIAL_WRITABLE_KEYS}；着色器参数放在 props.props）`,
      };
    }
    const res = coerceMaterialField(key, value);
    if ("error" in res) return { error: res.error };
    patch.values[key] = res.value;
    patch.updated.push(key);
    if (res.clamped) patch.clamped.push(key);
  }
  if (args.shader !== undefined) {
    patch.shader = String(args.shader).trim().replace(/\\/g, "/");
    patch.updated.push("shader");
  }
  if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim();
  return { patch };
}
