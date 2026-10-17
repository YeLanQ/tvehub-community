// ---------------------------------------------------------------------------
// 文件监听桥（fs-changed）：后端 notify 递归监听当前项目根，外部改动去抖后
// 推送变更相对路径列表。资产缓存刷新实现在 asset-refresh.ts（与 asset.refresh
// 命令共用）；本文件只做监听安装、根目录校验、场景脏态分级响应与自写抑制。
// ---------------------------------------------------------------------------

import { listen } from "@tauri-apps/api/event";
import { confirm } from "../../ui-kit/composables/confirm";
import { sceneReloadAction } from "../lib/scene-reload-action";
import { sceneApi } from "../../lib/scene-api";
import { getProjectStore } from "../stores/project";
import { logStore } from "../stores/log";
import { pushDevToolsEvent } from "../lib/devtools";
import { assetKindOf, refreshProjectAssets } from "./asset-refresh";

export { assetKindOf, refreshProjectAssets };
export type { AssetKind, AssetRefreshResult } from "./asset-refresh";

/** 后端 watcher 推送载荷（watcher.rs flush） */
interface FsChangedPayload {
  root: string;
  paths: string[];
}

let installed = false;

/**
 * 自己写盘抑制窗：前端保存场景（saveCurrentSceneToMain / 搬家前 flush）后，
 * watcher 会把我们自己的写盘当"外部修改"推回来——预览/构建流程先保存再切
 * 视图，自动重载会把用户从预览拽回场景视图（真实事故）。保存路径调用
 * markSceneSelfWrite() 打标，窗口内的事件不触发重载。
 */
const SELF_WRITE_SUPPRESS_MS = 2000;
let lastSelfSceneWriteAt = 0;

export function markSceneSelfWrite(): void {
  lastSelfSceneWriteAt = Date.now();
}

/**
 * 资产自写抑制窗：material.set / 历史 undo 由应用自己写 .mat，文件监听会把
 * 这次写盘当外部修改再 reload 一次——同一变更会推两条 material.changed。
 * 写路径先打标，窗口内的同名路径跳过（外部编辑器写入不受影响）。
 */
const SELF_ASSET_SUPPRESS_MS = 1500;
const selfWrittenAssets = new Map<string, number>();

export function markAssetSelfWrite(rel: string): void {
  selfWrittenAssets.set(rel.replace(/\\/g, "/"), Date.now());
}

function isSelfWrittenAsset(rel: string): boolean {
  const at = selfWrittenAssets.get(rel);
  if (at === undefined) return false;
  if (Date.now() - at > SELF_ASSET_SUPPRESS_MS) {
    selfWrittenAssets.delete(rel);
    return false;
  }
  return true;
}

/** 安装 fs-changed 监听（编辑器窗口启动时一次；幂等） */
export function installFsWatch(): void {
  if (installed) return;
  installed = true;
  void listen<FsChangedPayload>("fs-changed", (e) => {
    void handleFsChanged(e.payload);
  });
  // devtools/MCP 的 scene.save 由 Rust 直接写盘：收到自写通知后打开抑制窗，
  // 否则文件监听的 .scene 推送会触发「外部修改」整树重载。
  void listen<{ root?: string }>("scene:self-save", (e) => {
    const norm = (p?: string | null): string =>
      (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const current = getProjectStore().currentPath;
    if (!current || !e.payload.root || norm(e.payload.root) === norm(current)) {
      markSceneSelfWrite();
    }
  });
}

async function handleFsChanged(payload: FsChangedPayload): Promise<void> {
  const projectStore = getProjectStore();
  // 非当前工程的事件（残留监听/旧工程）忽略。根目录不一致是异常态（正常打开
  // 流两侧同源），留对比日志便于锁定开启方式差异导致的事件丢失（2026-09-28
  // devtools 兜底开窗漏设项目根曾致热同步全哑）。
  if (!projectStore.currentPath || payload.root !== projectStore.currentPath) {
    logStore.log(
      "warn",
      `fs-changed 事件根目录不匹配，已忽略：payload.root=${payload.root} currentPath=${projectStore.currentPath ?? "(无项目)"}`,
    );
    return;
  }

  // 自己的写盘（material.set / 历史 undo）不重复刷新、不重复广播事件。
  // 场景保存同样按自写处理：watcher 会把刚写下的 .scene 当外部修改推回来。
  const normRel = (rel: string): string => rel.replace(/\\/g, "/");
  const savedSceneRel = normRel(projectStore.sceneRel || "");
  const isSelfScene = (rel: string): boolean =>
    Boolean(savedSceneRel) &&
    normRel(rel) === savedSceneRel &&
    Date.now() - lastSelfSceneWriteAt < SELF_WRITE_SUPPRESS_MS;
  const paths = payload.paths.filter((rel) => !isSelfWrittenAsset(rel) && !isSelfScene(rel));
  if (!paths.length) return;

  const result = await refreshProjectAssets(paths);
  // 结构化资产变更事件（外部 Agent 据此增量同步，不必轮询 asset.list）。
  // .scene 不列入：场景有专属语义（replace/scene.changed + 脏态重载流程），
  // 放进 asset.changed 只会多一条必然 skipped 的噪音（每次保存都会出现）。
  const assetPaths = paths.filter((rel) => assetKindOf(rel) !== "scene");
  if (assetPaths.length) {
    void pushDevToolsEvent("asset.changed", {
      root: payload.root,
      paths: assetPaths,
      kinds: Object.fromEntries(
        Object.entries(result.kinds).filter(([rel]) => assetKindOf(rel) !== "scene"),
      ),
      refreshed: result.refreshed,
      pruned: result.pruned,
      skipped: result.skipped.filter((s) => assetKindOf(s.path) !== "scene"),
    });
  }

  // .scene：按脏态分级响应（不自动重载，避免冲掉未保存改动）
  if (paths.some((rel) => assetKindOf(rel) === "scene")) {
    void offerSceneReloadOnExternalChange(paths);
  }
}

/** 外部场景重载处理进行中标记：弹窗期间的后续事件不再叠加弹窗 */
let sceneReloadOfferInFlight = false;

/**
 * 外部 .scene 修改的分级响应（判定在 scene-reload-action.ts）：
 * 非当前场景仅提示；当前场景脏走确认（重新载入将丢弃未保存改动）；非脏自动重载。
 */
async function offerSceneReloadOnExternalChange(paths: string[]): Promise<void> {
  const projectStore = getProjectStore();
  const root = projectStore.currentPath;
  const rel = projectStore.sceneRel;
  if (!root) return;
  const isCurrentScene = Boolean(rel) && paths.includes(rel);
  // 自己刚写过的盘（保存后 2s 内）不是外部修改，跳过分级响应
  if (isCurrentScene && Date.now() - lastSelfSceneWriteAt < SELF_WRITE_SUPPRESS_MS) return;

  let dirty = false;
  if (isCurrentScene) {
    // 后端是脏标记权威；查询失败按脏处理（保守走确认，绝不静默丢改动）
    try {
      dirty = await sceneApi.dirty();
    } catch {
      dirty = true;
    }
  }

  const action = sceneReloadAction(isCurrentScene, dirty);
  if (action === "notice") {
    logStore.log("info", `场景文件已被外部修改（${paths.filter((p) => p.endsWith(".scene")).join("、")}；当前打开的是 ${rel ?? "无"}）`, "scene");
    return;
  }
  if (action === "confirm") {
    if (sceneReloadOfferInFlight) return;
    sceneReloadOfferInFlight = true;
    let reload = false;
    try {
      reload = await confirm({
        title: "检测到场景文件被外部修改",
        message: "当前场景有未保存的改动，重新载入将丢弃这些改动（以磁盘版本为准）。",
        confirmText: "重新载入",
        cancelText: "保留我的改动",
        danger: true,
      });
    } finally {
      sceneReloadOfferInFlight = false;
    }
    if (!reload) {
      logStore.log("info", "已保留未保存改动，未载入磁盘版本", "scene");
      return;
    }
  }
  const { reloadEditorScene } = await import("./editorService");
  // 用户已确认「重新载入」：显式丢弃未保存修改（后端脏保护不拦截）
  await reloadEditorScene(root, rel!, true);
  logStore.log("info", "场景已从磁盘重新载入（外部修改）", "scene");
}
