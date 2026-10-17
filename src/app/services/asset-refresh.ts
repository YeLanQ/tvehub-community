// ---------------------------------------------------------------------------
// 资产刷新（fs-changed 与 asset.refresh 共用的缓存失效/重读实现）。
// 按扩展名分派：贴图/TextureCube/音频/模型/材质/着色器/脚本 → 失效引擎缓存并按
// 需重读；.scene 不在本模块处理（由监听侧按脏态决定重载或提示）。
// 磁盘上已删除的缓存引用归入 pruned（清缓存，不算读取失败）。
// ---------------------------------------------------------------------------

import { AUDIO_EXTS } from "../../framework/audio/types";
import { MODEL_EXTS } from "../../framework/mesh/types";
import { getEditorStore } from "../stores/editor";

/** TextureLoader 可解码的图片资产（贴图通道颜色/数据两种用法共用同一缓存） */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);
const MODEL_EXT_SET = new Set<string>(MODEL_EXTS);
const AUDIO_EXT_SET = new Set<string>(AUDIO_EXTS);

function extOf(rel: string): string {
  const dot = rel.lastIndexOf(".");
  return dot < 0 ? "" : rel.slice(dot + 1).toLowerCase();
}

/** 资产类型（刷新分派用；unknown = 只重扫资产面板） */
export type AssetKind =
  | "texture"
  | "texcube"
  | "material"
  | "shader"
  | "model"
  | "audio"
  | "script"
  | "scene"
  | "unknown";

/** 按扩展名判定资产类型（asset.refresh 与 fs-changed 共用） */
export function assetKindOf(rel: string): AssetKind {
  switch (extOf(rel)) {
    case "texcube":
      return "texcube";
    case "mat":
      return "material";
    case "shader":
      return "shader";
    case "ts":
      return "script";
    case "scene":
      return "scene";
    default:
      if (IMAGE_EXTS.has(extOf(rel))) return "texture";
      if (MODEL_EXT_SET.has(extOf(rel))) return "model";
      if (AUDIO_EXT_SET.has(extOf(rel))) return "audio";
      return "unknown";
  }
}

export interface AssetRefreshResult {
  /** 已失效/重载的资产 */
  refreshed: string[];
  /** 已从磁盘删除、缓存引用被清理的资产（不再算错误） */
  pruned: string[];
  /** 每个路径判定的资产类型 */
  kinds: Record<string, AssetKind>;
  /** 未处理项与原因（.scene 需按脏态走场景重载流程） */
  skipped: { path: string; reason: string }[];
  /** 编辑器引擎是否就绪（false 时仅资产面板重扫） */
  engineReady: boolean;
}

/**
 * 显式刷新资产（asset.refresh 命令与外部文件监听共用）：
 * 按扩展名分派到引擎缓存失效/重读；.scene 不在本函数处理（由调用方按脏态
 * 决定重载或提示），目录/未知类型只触发资产面板重扫。
 */
export async function refreshProjectAssets(paths: string[]): Promise<AssetRefreshResult> {
  const kinds: Record<string, AssetKind> = {};
  const skipped: { path: string; reason: string }[] = [];
  const groups: Record<Exclude<AssetKind, "unknown" | "scene">, string[]> = {
    texture: [],
    texcube: [],
    material: [],
    shader: [],
    model: [],
    audio: [],
    script: [],
  };
  for (const rel of paths) {
    const kind = assetKindOf(rel);
    kinds[rel] = kind;
    if (kind === "unknown") continue;
    if (kind === "scene") {
      skipped.push({ path: rel, reason: ".scene 需按脏态重载（scene.open 或编辑器内提示）" });
      continue;
    }
    groups[kind].push(rel);
  }

  // 资产面板重扫：新文件/删除即时可见（load 内部有在途去重，幂等）
  const { getAssetsStore } = await import("../stores/assets");
  const assetsStore = getAssetsStore();
  await assetsStore.refresh();
  // 当前磁盘资产集：缓存里残留的已删除引用据此识别并剪除（不再报「读取失败」）
  const known = new Set(assetsStore.assets.map((a) => a.path));

  const editor = getEditorStore();
  const engine = editor.engine;
  // 引擎未就绪（编辑器隐藏/已销毁）：重开项目会整体重建，面板重扫已完成
  if (!editor.state.mounted || engine.isDisposed()) {
    return { refreshed: [], pruned: [], kinds, skipped, engineReady: false };
  }

  const refreshed: string[] = [];
  const pruned: string[] = [];
  const isGone = (rel: string): boolean =>
    !rel.startsWith("internal/") && !known.has(rel);
  for (const rel of groups.texture) {
    engine.invalidateTexture(rel);
    (isGone(rel) ? pruned : refreshed).push(rel);
  }
  for (const rel of groups.texcube) {
    engine.invalidateTexCube(rel);
    (isGone(rel) ? pruned : refreshed).push(rel);
  }
  for (const rel of groups.audio) {
    engine.audio.invalidate(rel);
    (isGone(rel) ? pruned : refreshed).push(rel);
  }
  for (const rel of groups.model) {
    // 丢弃旧解析后重读：完成时经 onChanged 自动刷新引用网格
    engine.models.invalidate(rel);
    if (isGone(rel)) {
      pruned.push(rel);
    } else {
      void engine.models.preload([rel]);
      refreshed.push(rel);
    }
  }

  // 材质/着色器并行重读（各自管理器按 rel 去重在途请求；结果按输入序归档）
  const materialResults = await Promise.all(
    groups.material.map(async (rel) => ({ rel, ok: await engine.materials.reload(rel) })),
  );
  for (const { rel, ok } of materialResults) {
    if (ok) {
      refreshed.push(rel);
    } else if (isGone(rel)) {
      // 磁盘上已删除：清掉缓存引用（下一次渲染回退默认），不算错误
      engine.materials.invalidate(rel);
      pruned.push(rel);
    } else {
      skipped.push({ path: rel, reason: "材质读取失败（格式错误）" });
    }
    // 天空盒材质（.mat cube 分支）：失效天空缓存并按新参数重算背景
    engine.invalidateSkyMaterial(rel);
  }
  const shaderResults = await Promise.all(
    groups.shader.map(async (rel) => ({ rel, ok: await engine.shaders.reload(rel) })),
  );
  for (const { rel, ok } of shaderResults) {
    if (ok) refreshed.push(rel);
    else if (isGone(rel)) pruned.push(rel);
    else skipped.push({ path: rel, reason: "着色器读取失败（解析错误）" });
  }

  // 工作台标签（ts 脚本 + .shader 着色器）：非脏标签页/元数据缓存重读
  if (groups.script.length || groups.shader.length) {
    const { getScriptsStore } = await import("../stores/scripts");
    await getScriptsStore().reloadExternal([...groups.script, ...groups.shader]);
  }

  return { refreshed, pruned, kinds, skipped, engineReady: true };
}
