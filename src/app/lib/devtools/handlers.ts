// devtools 方法分派 —— 适配层：远程 method 路由到命令注册表（node.* / scene.* / asset.*
// 等与编辑器 UI 共用同一命令执行路径）。命令实现见 src/app/commands/。
// mcp.listTools（协议自省）保留本地处理；参数/返回值形状与历史 devtools API 保持兼容。

import { runCommand, hasCommand } from "../../commands";
import { asRecord } from "../../commands/args";
import { getEditorStore } from "../../stores/editor";
import { enabledMcpTools, METHOD_TO_COMMAND } from "./state";

/** 远程参数 → 命令参数规整（字段名差异集中在节点删除/命名） */
function normalizeParams(method: string, params: unknown): unknown {
  const p = asRecord(params) ?? {};
  switch (method) {
    case "node.remove":
      return { ids: p.id ? [String(p.id)] : [] };
    case "node.rename":
      return {
        id: p.id ? String(p.id) : undefined,
        name: p.name,
      };
    default:
      // node.add 等命令读取端兼容原 devtools 字段（type/geometry/lightKind/skyKind/parentId/name）
      return params;
  }
}

/** 返回值按历史远程契约补齐（原方法大多带 ok 字段，客户端按此判断成败） */
function decorate(method: string, value: unknown): unknown {
  if (
    (method === "node.add" ||
      method === "node.remove" ||
      method === "node.rename" ||
      method === "node.select") &&
    value !== null &&
    typeof value === "object"
  ) {
    return { ok: true, ...(value as object) };
  }
  return value;
}

/** MCP 工具名规整（工具权限清单里 name 为带点方法名；此处仅供自省方法 mcp.listTools 用） */
function sanitizeMcpName(method: string): string {
  return method.replace(/\./g, "_").toLowerCase();
}

/** devtools 协议级参数（Rust 自动开窗/工作区选择），不属于命令参数 */
const PROTOCOL_ARGS = ["autoOpen", "root"];

/**
 * 场景写方法：响应前等待前端写链静默（乐观应用 → 串行提交后端）。
 * 必须等：`scene.tree` / `state.snapshot` 是 Rust 本地直答（不经前端链），
 * 不等待时紧跟的读取会看到中间态——真实事故：`node.add` 返回成功，紧接着
 * `scene.tree` 读到节点已建但材质补丁尚未落账，显示默认材质。
 */
const SETTLE_METHODS = new Set([
  "node.add",
  "node.remove",
  "node.rename",
  "node.set",
  "node.component.add",
  "node.component.set",
  "scene.settings.patch",
  "scene.save",
  "history.undo",
  "history.redo",
  "state.restore",
  "scene.write",
]);

/**
 * 固定参数方法的参数白名单（未知参数拒绝，避免拼错字段被静默忽略）。
 * 字段包类方法（node.add/node.set/node.component.set/material.set）由命令自身校验。
 */
const STRICT_PARAMS: Record<string, string[]> = {
  "editor.state": [],
  "project.close": [],
  "project.build": [
    "scenes", "mainScene", "title", "debug", "singlePage", "gzip", "release",
    "cdn", "gzipBase", "cdnBase", "outDir", "template",
  ],
  "scene.open": ["rel", "discard"],
  "scene.save": ["rel", "path"],
  "scene.tree": [],
  "state.snapshot": [],
  "state.restore": ["doc"],
  "history.undo": [],
  "history.redo": [],
  "scene.settings.get": [],
  "scene.settings.patch": ["patch", "settings"],
  "preview.open": [],
  "preview.start": [],
  "preview.close": [],
  "preview.stop": [],
  "preview.status": [],
  "preview.screenshot": ["source"],
  "asset.create": ["type", "dir", "name", "path", "shaderKind", "skyKind"],
  "asset.select": ["path"],
  "asset.delete": ["path"],
  "asset.rename": ["path", "newName"],
  "asset.refresh": ["path", "paths", "rel"],
  "material.get": ["path"],
  "node.select": ["id"],
  "node.remove": ["id", "ids"],
  "node.rename": ["id", "name"],
  "node.component.add": ["id", "type", "script", "rel", "path", "lightKind"],
};

/**
 * 等待编辑器场景就绪（冷启动/自动开窗时命令可能早于场景装载到达）。
 * 必须等 `sceneReady` 而不只是 `mounted`：mounted 在首页交接项目的补装载
 * **之前**就置位（视口先起渲染），此时资产访问器/场景会话还没接好——首个
 * 材质写会预取失败（MATERIAL_NOT_READY）或打在即将替换的会话上。
 * `sceneReady` 覆盖挂载管线全程与每次场景切换。
 */
async function waitEditorReady(): Promise<void> {
  const store = getEditorStore();
  const deadline = Date.now() + 15000;
  while (!(store.state.mounted && store.state.sceneReady)) {
    if (Date.now() > deadline) {
      throw new Error(
        "场景尚未就绪（SCENE_NOT_READY）：编辑器仍在装载/切换项目或场景，请稍后重试",
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (store.engine.isDisposed()) {
    throw new Error("场景尚未就绪（SCENE_NOT_READY）：编辑器引擎已销毁");
  }
}

/** 方法分派：method -> 命令执行。保留 mcp.listTools 与未知方法错误语义。 */
export async function handleMethod(method: string, params: unknown): Promise<unknown> {
  if (method === "mcp.listTools") {
    // 与历史一致：只暴露「工具权限」中已启用工具（name 用 MCP 合法名，method 保留真实方法名）
    return enabledMcpTools().map((t) => ({
      name: sanitizeMcpName(t.name),
      method: t.name,
      description: t.description,
      inputSchema: { type: "object", properties: {} },
    }));
  }
  await waitEditorReady();
  const strict = STRICT_PARAMS[method];
  if (strict) {
    const rec = asRecord(params) ?? {};
    const allowed = new Set([...strict, ...PROTOCOL_ARGS]);
    const unknown = Object.keys(rec).filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new Error(
        `${method} 不支持参数: ${unknown.join("/")}（支持: ${[...allowed].join("/")}）`,
      );
    }
  }
  const cmdId = METHOD_TO_COMMAND[method];
  if (!cmdId || !hasCommand(cmdId)) {
    // 契约表集中 devtools/state.ts：方法未登记或对应命令未注册（入口漏 import commands）均视为未知
    throw new Error(`未知方法: ${method}`);
  }
  const value = await runCommand(cmdId, normalizeParams(method, params), { logError: false });
  if (SETTLE_METHODS.has(method)) {
    // 后端写通道落账后才回复：调用方「写 → 读」不必自己等（scene.tree 本地直答）
    await getEditorStore().engine.graph.quiesceWrites();
  }
  return decorate(method, value);
}
