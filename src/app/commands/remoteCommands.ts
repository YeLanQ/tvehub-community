// 开发者服务（devtools/MCP）域命令：原 devtools/handlers.ts 的远程方法实现迁入命令层，
// 与编辑器 UI 动作共用同一注册表与执行器（node.* 等场景写命令见 nodeCommands.ts）。
// 只保留「读查询 / 会话编排 / 预览截图」等远程入口特有的动作；纯后端方法
// （scene.list/save/tree、asset.list、project.list）后续可下沉 Rust 直接应答。

import { getProjectStore, DEFAULT_SCENE_REL } from "../stores/project";
import { getEditorStore } from "../stores/editor";
import { getAssetsStore } from "../stores/assets";
import { getScriptsStore } from "../stores/scripts";
import { sceneApi } from "../../lib/scene-api";
import { api } from "../../lib/api";
import { handoffToWindow } from "../lib/window-handoff";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { JsonRecord } from "../../framework/prototype/types";
import { saveCurrentSceneToMain } from "../lib/save-scene";
import { markAssetSelfWrite, refreshProjectAssets } from "../services/fs-watch";
import { collectExportFiles } from "../lib/build";
import {
  defaultExportTemplateId,
  loadBuildPrefs,
  loadExportTemplates,
  runBuild,
} from "../lib/build-export";
import { registerCommand } from "./registry";
import { asBool, asRecord, asStringList } from "./args";
import { resolveAssetTarget } from "./assetCreateArgs";
import { SKYBOX_KINDS, normalizeSkyboxKind } from "../../framework/prototype/nodes/SkyboxNode";

/** 当前项目根；未打开项目时抛错（各域命令共用） */
function requireRoot(): string {
  const root = getProjectStore().currentPath;
  if (!root) throw new Error("尚未打开项目");
  return root;
}

/** 组装网页预览导出文件（与 WebPreviewPanel / 图窗口预览同一链路：collect 单实现，
 *  运行时 + 项目配置 + 场景图侧车 + 编译脚本） */
async function buildPreviewFiles(): Promise<Record<string, string>> {
  const root = requireRoot();
  const project = getProjectStore();
  return collectExportFiles({
    root,
    channel: "web",
    mode: "preview",
    graph: { kind: "sidecar", sceneRel: project.sceneRel || DEFAULT_SCENE_REL },
    saveDirtyScripts: true,
    logs: { tag: "preview", errorSuffix: "预览", warnOnSkip: false },
  });
}

// ===================== 编辑器 / 项目 =====================

registerCommand({
  id: "editor.state",
  label: "编辑器状态",
  group: "编辑器",
  expose: true,
  description: "获取编辑器当前状态（项目/场景/选中/视图；dirty 为后端权威值）",
  run: async () => {
    const project = getProjectStore();
    const editor = getEditorStore();
    // dirty 以后端会话为准：前端镜像靠 scene:changed 事件回填，紧跟 scene.save
    // 时会滞后数百毫秒（外部脚本据此判断保存完成会误判）
    let dirty = editor.state.dirty;
    if (project.currentPath) {
      try {
        dirty = await sceneApi.dirty();
      } catch {
        // 后端暂不可用：保留前端镜像值
      }
    }
    return {
      project: project.currentPath
        ? { path: project.currentPath, name: project.projectName }
        : null,
      scene: project.currentPath ? project.sceneRel : null,
      selection: editor.state.selectedId,
      selectionIds: editor.state.selectionIds,
      viewMode: editor.state.viewMode,
      dirty,
      mounted: editor.state.mounted,
      rendererBackend: editor.engine.renderer.activeBackend,
      canUndo: editor.state.canUndo,
      canRedo: editor.state.canRedo,
      historyPosition: editor.engine.history.position,
      historyEntries: editor.engine.history.entries,
    };
  },
});

registerCommand({
  id: "project.recentList",
  label: "查询项目",
  group: "编辑器",
  expose: true,
  description: "列出最近打开的项目",
  run: async () => ({ recent: await api.listRecentProjects() }),
});

registerCommand({
  id: "project.open",
  label: "打开项目",
  group: "编辑器",
  expose: true,
  description: "打开指定路径的项目",
  run: async (_ctx, args: Record<string, unknown>) => {
    const path = String(args?.path ?? "");
    if (!path) throw new Error("缺少 path（项目根目录）");
    const project = getProjectStore();
    const ok = await project.openProject(path);
    if (!ok) throw new Error(`打开项目失败: ${path}`);
    await handoffToWindow(
      getCurrentWindow().label,
      project.currentPath ?? "",
      project.projectName ?? "",
      project.sceneRel || DEFAULT_SCENE_REL,
    );
    return { ok: true, project: project.currentPath };
  },
});

registerCommand({
  id: "project.close",
  label: "关闭项目",
  group: "编辑器",
  expose: true,
  description: "关闭当前项目（返回首页）",
  run: async () => {
    await api.showHomeWindow();
    return { ok: true };
  },
});

// ===================== 场景 =====================

registerCommand({
  id: "scene.list",
  label: "场景列表",
  group: "场景",
  expose: true,
  description: "列出项目内的 .scene 场景文件",
  run: async () => {
    const root = requireRoot();
    const assets = await api.scanAssets(root);
    return assets
      .filter((a) => a.kind === "scene" && !a.path.endsWith("/"))
      .map((a) => ({ name: a.name, path: a.path }));
  },
});

registerCommand({
  id: "scene.open",
  label: "打开场景",
  group: "场景",
  expose: true,
  description:
    "打开指定场景（返回 opened/dirty/reason；discard=true 放弃未保存修改并强制磁盘重装）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const rel = String(args?.rel ?? "");
    if (!rel) throw new Error("缺少 rel（场景相对路径，如 assets/Main.scene）");
    const discard = asBool(args?.discard) ?? false;
    const result = await getProjectStore().openScene(rel, discard);
    if (!result) throw new Error(`打开场景失败: ${rel}`);
    return {
      ok: true,
      opened: result.opened !== false,
      dirty: result.dirty ?? false,
      reason: result.reason ?? null,
    };
  },
});

registerCommand({
  id: "scene.save",
  label: "保存场景",
  group: "场景",
  expose: true,
  description: "保存当前场景",
  run: async () => {
    // 走共享帮手：保存前等在途后端写提交落账（防快照抢跑漏尾部变更）
    await saveCurrentSceneToMain();
    return { ok: true };
  },
});

registerCommand({
  id: "scene.doc",
  label: "场景文档",
  group: "场景",
  expose: true,
  description: "获取当前场景的完整 JSON 文档",
  run: async () => {
    requireRoot();
    // 前端图写入是乐观应用 + 后端提交链：立刻读 Rust 会话可能落后于刚入链的
    // add/remove/set（外部 Agent 常见「add 完立刻 tree」），先等写入链静默
    await getEditorStore().engine.graph.quiesceWrites();
    return sceneApi.doc();
  },
});

registerCommand({
  id: "scene.settings.get",
  label: "读取场景设置",
  group: "场景",
  expose: true,
  description: "读取场景 settings（文档信封字段；未设置返回空对象）",
  run: () => sceneApi.settings(),
});

registerCommand({
  id: "scene.settings.patch",
  label: "修改场景设置",
  group: "场景",
  expose: true,
  description:
    "深合并 patch 进场景 settings（只改给定字段，避免整份 scene.write；标脏随保存落盘，不入撤销历史）",
  run: async (_ctx, args: Record<string, unknown>) => {
    requireRoot();
    const patch = asRecord(args?.patch ?? args?.settings);
    if (!patch || !Object.keys(patch).length) {
      throw new Error(
        "缺少 patch（要深合并进 settings 的对象，如 {patch:{rendering:{backgroundColor:\"#112233\"}}}）",
      );
    }
    const result = await sceneApi.settingsPatch(patch);
    // 后端已把这次 patch 压入撤销栈：同步前端历史镜像（canUndo/entries）
    const engine = getEditorStore().engine;
    engine.history.update(await sceneApi.historyState());
    return { ok: true, settings: result.settings, clamped: result.clamped };
  },
});

/** 当前历史状态快照（撤销/重做命令返回与 editor.state 同形） */
function historyStateOf(): Record<string, unknown> {
  const h = getEditorStore().engine.history;
  return {
    canUndo: h.canUndo,
    canRedo: h.canRedo,
    depth: h.depth,
    position: h.position,
    entries: h.entries,
    undoLabel: h.peekUndoLabel(),
    redoLabel: h.peekRedoLabel(),
    labels: h.listLabels(),
  };
}

registerCommand({
  id: "history.undo",
  label: "撤销",
  group: "编辑器",
  expose: true,
  description: "撤销上一步场景操作（含材质/settings；返回 {ok,undone,...历史状态,refreshedAssets}）",
  run: async () => {
    const engine = getEditorStore().engine;
    const beforePosition = engine.history.position;
    engine.undo();
    await engine.graph.quiesceWrites();
    // HistoryView.update 挂在 transport promise 的后续微任务上，让出一拍再读
    await new Promise((r) => setTimeout(r, 0));
    const undone = engine.history.position < beforePosition;
    // 材质撤销由后端写回 .mat：立即失效缓存重读，并抑制文件监听的重复刷新
    const assets = engine.history.takeAssets();
    if (assets.length) {
      for (const rel of assets) markAssetSelfWrite(rel);
      await refreshProjectAssets(assets);
    }
    return { ok: true, undone, ...historyStateOf(), refreshedAssets: assets };
  },
});

registerCommand({
  id: "history.redo",
  label: "重做",
  group: "编辑器",
  expose: true,
  description: "重做被撤销的场景操作（含材质/settings；返回 {ok,redone,...历史状态,refreshedAssets}）",
  run: async () => {
    const engine = getEditorStore().engine;
    const beforePosition = engine.history.position;
    engine.redo();
    await engine.graph.quiesceWrites();
    await new Promise((r) => setTimeout(r, 0));
    const redone = engine.history.position > beforePosition;
    const assets = engine.history.takeAssets();
    if (assets.length) {
      for (const rel of assets) markAssetSelfWrite(rel);
      await refreshProjectAssets(assets);
    }
    return { ok: true, redone, ...historyStateOf(), refreshedAssets: assets };
  },
});

// ===================== 状态快照 =====================

registerCommand({
  id: "state.restore",
  label: "恢复状态",
  group: "状态",
  expose: true,
  description: "恢复场景快照（传入 scene.doc 返回的 doc）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const project = getProjectStore();
    const doc = args?.doc;
    if (!doc || typeof doc !== "object") throw new Error("缺少 doc（state.snapshot 返回的场景文档）");
    const result = await sceneApi.loadDoc(doc, project.currentPath ?? undefined, project.sceneRel || undefined);
    const engine = getEditorStore().engine;
    const rootJson = (result.doc as { root?: unknown } | undefined)?.root ?? null;
    if (rootJson) engine.applySceneDocRoot(rootJson as JsonRecord);
    engine.graph.history.update(result.history);
    return { ok: true };
  },
});

// ===================== 预览 / 截图 =====================

/** 保存场景并导出产物 → 启动（或复用）预览服务器，返回 URL */
async function previewStartUrl(): Promise<string> {
  const project = getProjectStore();
  const root = requireRoot();
  try {
    await saveCurrentSceneToMain();
  } catch {
    /* 按磁盘内容导出 */
  }
  const files = await buildPreviewFiles();
  await api.exportWebPreviewFromScene(root, project.sceneRel || DEFAULT_SCENE_REL, files);
  const url = await api.startWebPreviewServer(root);
  await waitPreviewReady();
  return url;
}

/** 等待预览服务器真实可连（子进程 URL 先回、监听后起；200ms×30 ≈ 6s 上限） */
async function waitPreviewReady(): Promise<void> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    let status: Awaited<ReturnType<typeof api.previewStatus>> | null = null;
    try {
      status = await api.previewStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 非 Tauri 环境/旧后端没有该命令：跳过探测，按已返回的 url 处理
      if (/preview_status|not found|unknown/i.test(msg)) return;
    }
    if (status) {
      if (!status.running) throw new Error("预览服务器已退出（子进程启动失败或端口被占用）");
      if (status.ready) return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("预览服务器未在预期时间内就绪（端口被占用或预览子进程启动失败）");
}

registerCommand({
  id: "preview.open",
  label: "打开预览",
  group: "预览",
  expose: true,
  description: "打开网页预览（导出并启动预览面板；返回的 url 已确认可连）",
  run: async () => {
    const url = await previewStartUrl();
    getEditorStore().setViewMode("preview");
    return { ok: true, url };
  },
});

registerCommand({
  id: "preview.close",
  label: "关闭预览",
  group: "预览",
  expose: true,
  description: "关闭预览面板，返回场景编辑",
  run: () => {
    getEditorStore().setViewMode("scene");
    return { ok: true };
  },
});

registerCommand({
  id: "preview.start",
  label: "启动预览",
  group: "预览",
  expose: true,
  description: "启动预览服务器（按现有导出产物；返回的 url 已确认可连）",
  run: async () => ({ ok: true, url: await previewStartUrl() }),
});

registerCommand({
  id: "preview.status",
  label: "预览状态",
  group: "预览",
  expose: true,
  description: "查询预览服务器状态（running/ready/url/port/dir；ready 为真实 TCP 探测）",
  run: () => api.previewStatus(),
});

registerCommand({
  id: "preview.stop",
  label: "停止预览",
  group: "预览",
  expose: true,
  description: "停止预览服务器",
  run: async () => {
    await api.stopWebPreview();
    return { ok: true };
  },
});

registerCommand({
  id: "preview.screenshot",
  label: "截图",
  group: "屏幕快照",
  expose: true,
  description:
    "截取编辑器视口画面（source 仅支持 editor；返回 {source,blank,dataUrl,saved}，blank=true 表示画面为纯色；并存入项目 .tmp/devtools/）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const requested = args?.source !== undefined ? String(args.source) : "editor";
    if (requested !== "editor") {
      throw new Error(
        `不支持的截图来源: ${requested}（预览帧跨域不可读，当前仅支持 source="editor"）`,
      );
    }
    const engine = getEditorStore().engine;
    const source = engine.renderer.domElement as HTMLCanvasElement;
    if (!source || !source.width) throw new Error("编辑器视口尚未就绪");
    // ready=true 不代表首帧已绘制：先等两帧；仍为纯色时再重试一次（首图偶发空白）
    // 后台窗口 rAF 可能被节流：500ms 超时兜底，绝不卡住截图命令
    await Promise.race([
      new Promise<void>((resolve) => {
        const raf = globalThis.requestAnimationFrame?.bind(globalThis);
        if (!raf) return resolve();
        raf(() => raf(() => resolve()));
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    /** 抓一帧并判定是否纯色（blank 供调用方决定是否继续重试） */
    const grab = (): { dataUrl: string; blank: boolean } => {
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("创建离屏画布失败");
      ctx.drawImage(source, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length < 100) throw new Error("截帧失败（画布为空，视口可能未在渲染）");
      // 空白帧判定：缩到 32×32 抽样，三通道全同 → blank（纯色场景也会 blank，
      // 但与「渲染失败」不同：调用方可据此判断是否需要继续尝试而非当成有效画面）
      let blank = false;
      try {
        const probe = document.createElement("canvas");
        probe.width = 32;
        probe.height = 32;
        const pctx = probe.getContext("2d");
        if (pctx) {
          pctx.drawImage(canvas, 0, 0, 32, 32);
          const px = pctx.getImageData(0, 0, 32, 32).data;
          let min = 255;
          let max = 0;
          for (let i = 0; i < px.length; i += 4) {
            min = Math.min(min, px[i], px[i + 1], px[i + 2]);
            max = Math.max(max, px[i], px[i + 1], px[i + 2]);
          }
          blank = max - min <= 1;
        }
      } catch {
        // 读像素失败（跨域污染等）：不阻断截图，blank 保持 false
      }
      return { dataUrl, blank };
    };
    let shot = grab();
    if (shot.blank) {
      await new Promise((r) => setTimeout(r, 150));
      shot = grab();
    }
    const { dataUrl, blank } = shot;
    let saved: string | null = null;
    const root = getProjectStore().currentPath;
    if (root) {
      // 产物留档到项目 .tmp/devtools/（dataURL 去掉前缀即 base64）
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      saved = `.tmp/devtools/screenshot-${Date.now()}.png`;
      try {
        await api.writeAssetBinary(root, saved, b64);
      } catch {
        saved = null;
      }
    }
    return { source: "editor", blank, dataUrl, saved };
  },
});

// ===================== 资源 =====================

registerCommand({
  id: "asset.list",
  label: "资源列表",
  group: "资源",
  expose: true,
  description: "列出项目资源（脚本/场景/材质/贴图/目录等，含相对路径与类型）",
  run: async () => {
    const root = requireRoot();
    const assets = await api.scanAssets(root);
    return assets.map((a) => ({ name: a.name, path: a.path, kind: a.kind, size: a.size }));
  },
});

registerCommand({
  id: "asset.refresh",
  label: "刷新资产",
  group: "资源",
  expose: true,
  description:
    "让编辑器重新读取磁盘上的资产并失效引擎缓存（path：相对路径或路径数组；缺省 = 全部已加载材质/着色器/模型/贴图）。.scene 不走本命令",
  run: async (_ctx, args: Record<string, unknown>) => {
    requireRoot();
    const raw = args?.path ?? args?.paths ?? args?.rel;
    let paths: string[] = [];
    if (typeof raw === "string" && raw.trim()) {
      paths = [raw.trim().replace(/\\/g, "/")];
    } else if (Array.isArray(raw)) {
      paths = raw.map((p) => String(p).trim().replace(/\\/g, "/")).filter(Boolean);
    }
    const engine = getEditorStore().engine;
    if (!paths.length) {
      // 缺省：全部已加载引用（贴图缓存键为 "c|rel"/"n|rel"，取后半段）
      const textures = [...engine.textureCache.keys()]
        .map((k) => k.slice(k.indexOf("|") + 1))
        .filter(Boolean);
      paths = [
        ...new Set([
          ...engine.materials.loadedRels(),
          ...engine.shaders.loadedRels(),
          ...engine.models.loadedRels(),
          ...textures,
        ]),
      ];
    }
    const result = await refreshProjectAssets(paths);
    if (!result.engineReady) throw new Error("编辑器引擎未就绪，无法刷新资产缓存");
    // 全量刷新时兜底重刷所有网格材质（贴图引用方按新缓存重取）
    if (!raw) engine.refreshMaterialNodes(null);
    // path 只回仍在磁盘上的项；已删除的缓存引用单列在 pruned（不再算 skipped 错误）
    return { ...result, path: paths.filter((p) => !result.pruned.includes(p)) };
  },
});

/** 为目录内基名找不冲突的名字（"name"、"name 2"、"name 3"…） */
function uniqueName(taken: Set<string>, dir: string, stem: string, ext: string): string {
  const prefix = dir ? `${dir}/` : "";
  let name = stem;
  let n = 2;
  while (taken.has(`${prefix}${name}${ext}`.toLowerCase())) name = `${stem} ${n++}`;
  return `${name}${ext}`;
}

/** 去尾部扩展名（scene/script 等创建走 store，store 会补后缀；调用方带后缀会导致双后缀） */
function stripAssetExt(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : name;
}

registerCommand({
  id: "asset.create",
  label: "新建资源",
  group: "资源",
  expose: true,
  description: "新建资源文件或目录（type: scene/script/material/shader/texcube/skybox/prefab/anim/terrain/folder；dir 目标目录；name 名称；shader 可带 shaderKind: physical/unlit/toon/skyprocedural/skycube；skybox 可带 skyKind: procedural/cube（cubemap 别名））",
  run: async (_ctx, args: Record<string, unknown>) => {
    const root = requireRoot();
    const type = String(args?.type ?? "").toLowerCase();
    const resolved = resolveAssetTarget({
      type,
      dir: args?.dir,
      name: args?.name,
      path: args?.path,
    });
    if ("error" in resolved) throw new Error(resolved.error);
    const { dir, stem } = resolved.target;
    const store = getAssetsStore();
    await store.load(root);
    const taken = new Set(store.assets.map((a) => a.path.toLowerCase()));
    switch (type) {
      case "scene": {
        const name = uniqueName(taken, dir, stem ?? "NewScene", ".scene");
        // store.createSceneAsset 只接收基名（内部再补 .scene/去重）
        const rel = await store.createSceneAsset(root, dir, stripAssetExt(name, ".scene"));
        if (!rel) throw new Error(`创建场景失败: ${dir}/${name}`);
        return { created: rel, type };
      }
      case "script": {
        const dest = dir && (dir === "src" || dir.startsWith("src/")) ? dir : "src";
        const name = uniqueName(taken, dest, stem ?? "MyScript", ".ts");
        const rel = await store.createScriptAsset(root, dest, stripAssetExt(name, ".ts"));
        if (!rel) throw new Error(`创建脚本失败: ${dest}/${name}`);
        return { created: rel, type };
      }
      case "material": {
        // 材质与着色器分离：材质不再带类型（默认挂内置 PBR 着色器）
        const name = stem ?? "";
        const rel = await store.createMaterialAsset(
          root,
          dir,
          stripAssetExt(name, ".mat") || null,
        );
        if (!rel) throw new Error(`创建材质失败: ${dir || "项目根"}`);
        return { created: rel, type };
      }
      case "shader": {
        const kind = String(args?.shaderKind ?? "physical").toLowerCase();
        const name = stem ?? "";
        const rel = await store.createShaderAsset(
          root,
          dir,
          kind,
          stripAssetExt(name, ".shader") || null,
        );
        if (!rel) throw new Error(`创建着色器失败: ${dir || "项目根"}`);
        return { created: rel, type, shaderKind: kind };
      }
      case "texcube": {
        const name = stem ?? "";
        const rel = await store.createTextureCubeAsset(
          root,
          dir,
          stripAssetExt(name, ".texcube") || null,
        );
        if (!rel) throw new Error(`创建 TextureCube 失败: ${dir || "项目根"}`);
        return { created: rel, type };
      }
      case "skybox": {
        const raw = args?.skyKind ?? "procedural";
        const kind = normalizeSkyboxKind(raw);
        if (!kind) {
          throw new Error(
            `skyKind 非法: ${JSON.stringify(raw)}（可选: ${SKYBOX_KINDS.join("/")}；cubemap 是 cube 的别名）`,
          );
        }
        const name = stem ?? "";
        const rel = await store.createSkyboxAsset(
          root,
          dir,
          kind,
          stripAssetExt(name, ".mat") || null,
        );
        if (!rel) throw new Error(`创建天空盒失败: ${dir || "项目根"}`);
        return { created: rel, type, skyKind: kind };
      }
      case "prefab": {
        const name = uniqueName(taken, dir, stem ?? "NewPrefab", ".prefab");
        const rel = await store.createPrefabAsset(root, dir, stripAssetExt(name, ".prefab"));
        if (!rel) throw new Error("创建预制体失败: " + (dir || "项目根"));
        return { created: rel, type };
      }
      case "anim": {
        const name = uniqueName(taken, dir, stem ?? "NewAnimation", ".anim");
        const rel = await store.createAnimAsset(root, dir, stripAssetExt(name, ".anim"));
        if (!rel) throw new Error(`创建动画失败: ${dir || "项目根"}`);
        return { created: rel, type };
      }
      case "terrain": {
        const name = stem ?? "";
        const rel = await store.createTerrainAsset(
          root,
          dir,
          stripAssetExt(name, ".terrain") || null,
        );
        if (!rel) throw new Error(`创建地形失败: ${dir || "项目根"}`);
        return { created: rel, type };
      }
      case "folder": {
        const base = dir ? `${dir}/` : "";
        const name = stem ?? "NewFolder";
        const rel = await store.createFolder(root, `${base}${name}`);
        if (!rel) throw new Error(`创建目录失败: ${base}${name}`);
        return { created: rel, type };
      }
      default:
        throw new Error(`未知资源类型: ${type}（应为 scene/script/material/shader/texcube/skybox/prefab/anim/terrain/folder）`);
    }
  },
});

registerCommand({
  id: "asset.select",
  label: "选中资源",
  group: "资源",
  expose: true,
  description: "选中资产（path：项目相对路径；属性面板切换到资产预览/属性）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const rel = String(args?.path ?? "");
    if (!rel) throw new Error("缺少 path（资产相对路径）");
    const store = getAssetsStore();
    await store.load(requireRoot());
    if (!store.assets.some((a) => a.path === rel)) {
      throw new Error(`资产不存在: ${rel}`);
    }
    store.select(rel);
    return { ok: true, selected: rel };
  },
});

registerCommand({
  id: "asset.delete",
  label: "删除资源",
  group: "资源",
  expose: true,
  description:
    "删除资源文件或目录（path：项目相对路径；返回 referencedBy = 仍引用该资产的场景节点数）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const root = requireRoot();
    const rel = String(args?.path ?? "").replace(/\\/g, "/");
    if (!rel) throw new Error("缺少 path（项目相对路径）");
    // 存在性前置判定：缺失返回 NOT_FOUND 语义，而不是笼统的「删除失败」
    const assets = await api.scanAssets(root);
    const exists = assets.some((a) => a.path === rel || a.path.startsWith(`${rel}/`));
    if (!exists) throw new Error(`资源不存在: ${rel}`);
    // 引用统计：删材质/脚本/模型/贴图前告知仍有多少节点引用（不阻断，引用会回退默认）
    const nodeRefs: string[] = [];
    const editor = getEditorStore();
    const engine = editor.engine;
    if (editor.state.mounted && !engine.isDisposed()) {
      const asDir = assets.some((a) => a.kind === "dir" && a.path === rel);
      for (const node of engine.graph.all()) {
        const text = JSON.stringify(node.toJSON());
        const hit = text.includes(`"${rel}"`) || (asDir && text.includes(`"${rel}/`));
        if (hit) nodeRefs.push(node.id);
      }
    }
    const materialRefs = editor.state.mounted && !engine.isDisposed()
      ? engine.materials
          .loadedRels()
          .filter((m) => JSON.stringify(engine.materials.paramsFor(m)).includes(rel))
      : [];
    const isScript = (rel === "src" || rel.startsWith("src/")) && rel.endsWith(".ts");
    const ok = isScript
      ? await getScriptsStore().deleteScript(rel)
      : await getAssetsStore().remove(root, rel);
    if (!ok) throw new Error(`删除失败: ${rel}`);
    return {
      deleted: rel,
      referencedBy: nodeRefs.length,
      referencedNodes: nodeRefs.slice(0, 20),
      referencedByMaterials: materialRefs,
    };
  },
});

registerCommand({
  id: "asset.rename",
  label: "重命名资源",
  group: "资源",
  expose: true,
  description: "重命名资源文件或目录（path + newName）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const root = requireRoot();
    const rel = args?.path;
    const newName = args?.newName;
    if (!rel) throw new Error("缺少 path（项目相对路径）");
    if (!newName) throw new Error("缺少 newName（新名称）");
    let finalName = String(newName).trim();
    const slash = String(rel).lastIndexOf("/");
    const dot = String(rel).lastIndexOf(".");
    if (dot > slash && dot > 0 && !finalName.includes(".")) {
      finalName = finalName + String(rel).slice(dot);
    }
    const relStr = String(rel);
    const isScript = (relStr === "src" || relStr.startsWith("src/")) && relStr.endsWith(".ts");
    const renamed = isScript
      ? await getScriptsStore().renameScript(relStr, finalName)
      : await getAssetsStore().rename(root, relStr, finalName);
    if (!renamed) throw new Error(`重命名失败: ${relStr}`);
    return { renamed: relStr, newName: renamed };
  },
});

registerCommand({
  id: "projectBuild",
  label: "构建导出",
  group: "构建",
  expose: true,
  description:
    "构建导出当前项目（与构建面板同一链路；singlePage/gzip/release/cdn/outDir/title 可选，缺省取 build.config.json 与默认模板）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const root = requireRoot();
    const project = getProjectStore();
    const prefs = await loadBuildPrefs(root);
    // 布尔参数宽松收窄：助手 schema 按 string 下发，弱模型惯传 "true" 字符串
    const singlePage = asBool(args?.singlePage) ?? false;
    // 模板形态与构建形态一致：single → 单页模板，multi → 多页模板
    const templates = await loadExportTemplates();
    const templateId =
      typeof args?.template === "string" && args.template
        ? args.template
        : (templates.find((t) => t.mode === (singlePage ? "single" : "multi"))?.id ??
          defaultExportTemplateId());
    const sceneList = asStringList(args?.scenes);
    const result = await runBuild({
      root,
      channel: "web",
      scenes: sceneList.length
        ? sceneList
        : prefs?.scenes.length
          ? prefs.scenes
          : [project.sceneRel || DEFAULT_SCENE_REL],
      mainScene:
        typeof args?.mainScene === "string" && args.mainScene
          ? args.mainScene
          : prefs?.mainScene || project.sceneRel || DEFAULT_SCENE_REL,
      title:
        typeof args?.title === "string" && args.title
          ? args.title
          : prefs?.title || project.projectName || "TvE Build",
      debug: asBool(args?.debug) ?? (prefs?.debug ?? true),
      templates: [templateId],
      gzip: asBool(args?.gzip) ?? false,
      release: asBool(args?.release) ?? false,
      cdn: asBool(args?.cdn) ?? false,
      gzipBase: typeof args?.gzipBase === "string" ? args.gzipBase : "",
      cdnBase: typeof args?.cdnBase === "string" ? args.cdnBase : "",
      outDir: typeof args?.outDir === "string" && args.outDir ? args.outDir : undefined,
    });
    return {
      ok: true,
      output_dir: result.output_dir,
      missing: result.missing,
      single_page: singlePage,
    };
  },
});
