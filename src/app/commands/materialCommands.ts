// 材质资产命令（devtools/MCP）：.mat 的结构写入口。
//
// 背景：asset.write 对 .mat 有格式锁（防结构损坏），而 node.set 的 material
// 只接受资产路径——外部 Agent 建完材质后没有可写属性的入口。本命令走与资产
// 检查器完全相同的链路：后端 material_write 序列化落盘 + 引擎材质缓存
// cachePut + refreshMaterialNodes，保存即视口生效。
//
// 参数形态（props / params 为同一含义的别名，顶层材质字段也接受）：
//   { path: "assets/Materials/Red.mat",
//     props: { color: "#ff3300", roughness: 0.4, props: { uGlow: 1 } } }
//   { path: "assets/Materials/Red.mat", color: "#ff3300", shader: "assets/Shaders/X.shader" }

import { getEditorStore } from "../stores/editor";
import { getProjectStore } from "../stores/project";
import {
  type MaterialParams,
  materialFileStem,
  materialParamsFrom,
} from "../../framework/material";
import type { MaterialDoc } from "../../framework/material/MaterialManager";
import type { SceneHistoryState } from "../../framework/scene/SceneClient";
import { api } from "../../lib/api";
import { markAssetSelfWrite } from "../services/fs-watch";
import { saveMaterialParams } from "../lib/materials";
import { loadShaderKind } from "../lib/shaders";
import { registerCommand } from "./registry";
import {
  materialRelOf,
  parseMaterialPatch,
  type MaterialPatchValue,
} from "./materialSet";
import { materialParamsForOutput } from "./materialOutput";

function requireRoot(): string {
  const root = getProjectStore().currentPath;
  if (!root) throw new Error("尚未打开项目");
  return root;
}

/** 材质加载结果：缓存 → 磁盘；区分缺失（NOT_FOUND）与格式损坏（PARSE_ERROR） */
type MaterialLoad = { doc: MaterialDoc } | { missing: true } | { parseError: string };

async function loadMaterial(root: string, rel: string): Promise<MaterialLoad> {
  const engine = getEditorStore().engine;
  if (engine.materials.has(rel)) {
    return {
      doc: {
        name: materialFileStem(rel),
        type: engine.materials.typeFor(rel),
        shader: engine.materials.shaderFor(rel),
        params: engine.materials.paramsFor(rel),
      },
    };
  }
  try {
    const raw = await api.materialRead(root, rel);
    if (!raw) return { missing: true };
    return {
      doc: {
        name: raw.name,
        type: raw.materialType,
        shader: raw.shader,
        params: materialParamsFrom(raw.params),
      },
    };
  } catch (e) {
    return { parseError: e instanceof Error ? e.message : String(e) };
  }
}

/** 统一错误文案：缺失与损坏必须可判别（错误码由后端按前缀映射 NOT_FOUND/PARSE_ERROR） */
function materialLoadError(rel: string, loaded: MaterialLoad): string | null {
  if ("missing" in loaded) {
    return `材质不存在: ${rel}（新建材质用 asset.create type=material）`;
  }
  if ("parseError" in loaded) {
    // 后端已带「材质解析失败 '<rel>': 原因」前缀，这里不再重复套一层
    return loaded.parseError;
  }
  return null;
}

registerCommand({
  id: "material.get",
  label: "读取材质",
  group: "资源",
  expose: true,
  description:
    "读取材质资产（path: .mat 相对路径；返回 name/type/shader/params；颜色统一为 #rrggbb 字符串）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const relRes = materialRelOf(args);
    if ("error" in relRes) throw new Error(relRes.error);
    const rel = relRes.rel;
    const loaded = await loadMaterial(requireRoot(), rel);
    const err = materialLoadError(rel, loaded);
    if (err) throw new Error(err);
    if (!("doc" in loaded)) throw new Error(`材质不存在: ${rel}`);
    return {
      path: rel,
      name: loaded.doc.name,
      type: loaded.doc.type,
      shader: loaded.doc.shader,
      colorFormat: "hex",
      params: materialParamsForOutput(loaded.doc.params),
    };
  },
});

registerCommand({
  id: "material.set",
  label: "修改材质",
  group: "资源",
  expose: true,
  description:
    "修改材质资产属性（path: .mat 相对路径；props: 字段包，支持 color/#hex、metalness/roughness 等 PBR 参数与 props.props 着色器参数；shader 可切换挂载着色器；保存后视口即时刷新）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const root = requireRoot();
    const relRes = materialRelOf(args);
    if ("error" in relRes) throw new Error(relRes.error);
    const rel = relRes.rel;
    const parsed = parseMaterialPatch(args);
    if ("error" in parsed) throw new Error(parsed.error);
    const { values, shaderProps, shader, name: explicitName, updated, clamped } = parsed.patch;

    const loaded = await loadMaterial(root, rel);
    const err = materialLoadError(rel, loaded);
    if (err) throw new Error(err);
    if (!("doc" in loaded)) throw new Error(`材质不存在: ${rel}`);
    const doc = loaded.doc;

    const params: MaterialParams = { ...doc.params, props: { ...doc.params.props } };
    for (const [key, value] of Object.entries(values)) {
      (params as unknown as Record<string, MaterialPatchValue>)[key] = value;
    }
    if (shaderProps) params.props = { ...params.props, ...shaderProps };

    // 着色器切换：先解析渲染分支并预取文档，避免材质缓存写入后按旧钩子渲染
    let shaderRel = doc.shader;
    let kind = doc.type;
    if (shader !== undefined) {
      shaderRel = shader;
      kind = await loadShaderKind(root, shaderRel);
      const engine = getEditorStore().engine;
      if (!engine.shaders.has(shaderRel)) await engine.shaders.preload([shaderRel]);
    }

    const name = explicitName ?? materialFileStem(rel);
    // 撤销支持：记录写前/写后的 .mat 全文，后端历史 undo/redo 时写回
    const beforeText = await api.readText(root, rel).catch(() => "");
    markAssetSelfWrite(rel);
    await saveMaterialParams(root, rel, name, params, shaderRel);
    const afterText = await api.readText(root, rel).catch(() => "");
    let undoable = false;
    const engine = getEditorStore().engine;
    if (beforeText !== afterText) {
      try {
        const state = await api.scenePushMaterialEdit(rel, beforeText, afterText);
        if (state && typeof state === "object") {
          engine.history.update(state as SceneHistoryState);
        }
        undoable = true;
      } catch (e) {
        console.warn(`材质已写入，但记入撤销历史失败: ${e}`);
      }
    }

    engine.materials.cachePut(rel, params, kind, shaderRel);
    engine.refreshMaterialNodes(rel);
    // 天空盒材质（.mat cube 分支）另需失效天空缓存才能重算背景
    engine.invalidateSkyMaterial(rel);

    return { ok: true, path: rel, updated, clamped, undoable, type: kind, shader: shaderRel };
  },
});
