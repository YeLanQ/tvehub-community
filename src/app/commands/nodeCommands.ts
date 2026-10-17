// 场景节点编辑命令：层级面板/视口/属性面板的写操作与 devtools 共用同一执行路径。
// 写仍由 engine 执行（乐观应用 → 后端提交 → 撤销历史）；命令层只负责
// 类型解析（geometry/light/skybox/脚本节点）、命名与 guard（根节点/成环/子孙去重）。

import { getEditorStore } from "../stores/editor";
import { getProjectStore } from "../stores/project";
import { getScriptsStore } from "../stores/scripts";
import { prompt } from "../lib/prompt";
import { api } from "../../lib/api";
import { sceneApi } from "../../lib/scene-api";
import { registerCommand } from "./registry";
import { asRecord, asStrings } from "./args";
import { isEditingText } from "./context";
import { coercePropsToNode, currentTransform, mergeTransformSnapshot, parseNodeSetArgs } from "./nodeSet";
import type { MoveTarget, TransformSnapshot } from "../../framework/scene/SceneClient";
import type { JsonRecord, Vec3 } from "../../framework/prototype/types";

import { GEOMETRY_KINDS } from "../../framework/mesh/geometry";
import type { LightKind } from "../../framework/prototype/nodes/LightNode";
import type { SkyboxKind } from "../../framework/prototype/nodes/SkyboxNode";
import { FOG_KINDS } from "../../framework/fog/types";
import { isTerrainAssetRel, parseTerrainSettings } from "../../framework/terrain";
import {
  canAddComponent,
  canonicalComponentType,
  componentMetaOf,
  createComponentRef,
  createScriptComponentRef,
} from "../lib/component-registry";
import type { NodeComponentRef } from "../../framework/prototype/components";

const LIGHT_KINDS: LightKind[] = ["point", "directional", "ambient", "spot"];
const SKYBOX_KINDS: SkyboxKind[] = ["cube", "procedural"];

function editor() {
  return getEditorStore();
}

function engine() {
  return getEditorStore().engine;
}

function graph() {
  return getEditorStore().engine.graph;
}

/** 显式传入的枚举分支值必须合法：拼错不再静默退化成默认值 */
function strictSubtype<T extends string>(
  list: readonly T[],
  v: unknown,
  option: string,
): T | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "string" && list.includes(v as T)) return v as T;
  throw new Error(`${option} 非法: ${JSON.stringify(v)}（可选: ${list.join("/")}）`);
}

/** node.add 支持的顶层字段（未识别字段直接报错，不再静默丢弃） */
const ADD_KEYS = new Set([
  "kind", "type", "subtype", "geometry", "lightKind", "skyKind", "fogKind",
  "parent", "parentId", "name", "position", "rotation", "scale", "size",
  "material", "rel", "path", "scriptRel", "props", "autoOpen", "root",
]);

/** node.add 创建后应用变换/尺寸/材质等字段（走与 node.set 相同的收敛与撤销通道） */
function applyAddExtras(
  node: { id: string; transform: TransformSnapshot; toJSON: () => unknown },
  args: Record<string, unknown>,
): string[] {
  const applied: string[] = [];
  const patch: Record<string, unknown> = {};
  for (const key of ["position", "rotation", "scale"] as const) {
    if (args[key] !== undefined) patch[key] = args[key];
  }
  if (Object.keys(patch).length) {
    const merged = mergeTransformSnapshot(currentTransform(
      node.transform.position,
      node.transform.rotation,
      node.transform.scale,
    ), patch);
    if ("error" in merged) throw new Error(merged.error);
    engine().setTransform(node.id, merged.snapshot);
    applied.push(...Object.keys(patch));
  }
  const props: JsonRecord = {};
  for (const key of ["size", "material"] as const) {
    if (args[key] !== undefined) props[key] = args[key] as JsonRecord[string];
  }
  if (args.props !== undefined) {
    const extra = asRecord(args.props);
    if (!extra) throw new Error("props 应为对象（节点属性字段包）");
    Object.assign(props, extra);
  }
  if (Object.keys(props).length) {
    const coerced = coercePropsToNode(node, props);
    if ("error" in coerced) throw new Error(coerced.error);
    const before = node.toJSON() as JsonRecord;
    const after = { ...before, ...coerced.props } as JsonRecord;
    engine().patchNode(node.id, before, after, "开发者服务·添加节点属性");
    applied.push(...Object.keys(coerced.props));
  }
  return applied;
}

/** node.add 可选 position（{x,y,z}，出生落位）；非法/缺省落世界原点 */
function asPosition(v: unknown): Vec3 | undefined {
  if (!v || typeof v !== "object") return undefined;
  const p = v as Record<string, unknown>;
  const x = Number(p.x);
  const y = Number(p.y);
  const z = Number(p.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : undefined;
}

/** id / id 数组两种形态 → 字符串列表（空串剔除） */
function asIdList(v: unknown): string[] {
  const list: unknown[] = Array.isArray(v) ? v : [v];
  return list.map((x) => String(x)).filter(Boolean);
}

/** 收集节点子树 id（含自身；删除返回值按真实级联范围上报） */
function collectSubtreeIds(id: string, out: string[]): void {
  if (!graph().has(id)) return;
  out.push(id);
  for (const child of graph().childrenOf(id)) collectSubtreeIds(child.id, out);
}

/** 任意 JSON → MoveTarget 列表（剔除缺 id / 父级非法的残缺项——原 engine 端
 *  对未知父级一律 no-op，这里前置剔除；index 缺省 0，与 splice(undefined) 同义） */
function asMoveTargets(v: unknown): MoveTarget[] {
  if (!Array.isArray(v)) return [];
  const out: MoveTarget[] = [];
  for (const item of v) {
    const m = asRecord(item);
    if (!m || typeof m.id !== "string" || !m.id) continue;
    const newParentId =
      m.newParentId === null ? null : typeof m.newParentId === "string" ? m.newParentId : undefined;
    if (newParentId === undefined) continue;
    out.push({
      id: m.id,
      newParentId,
      newIndex: typeof m.newIndex === "number" ? m.newIndex : 0,
    });
  }
  return out;
}

/** 任意 JSON → TransformSnapshot（position/rotation/scale 各轴须为有限数字） */
function asTransformSnapshot(v: unknown): TransformSnapshot | undefined {
  const r = asRecord(v);
  if (!r) return undefined;
  const part = (o: unknown): { x: number; y: number; z: number } | null => {
    const p = asRecord(o);
    if (!p) return null;
    const axes = [p.x, p.y, p.z];
    if (axes.some((a) => typeof a !== "number" || !Number.isFinite(a))) return null;
    return { x: axes[0] as number, y: axes[1] as number, z: axes[2] as number };
  };
  const position = part(r.position);
  const rotation = part(r.rotation);
  const scale = part(r.scale);
  return position && rotation && scale ? { position, rotation, scale } : undefined;
}

/** 后端场景文档树中按 id 取材质引用（核验用；节点缺失返回 null） */
function docNodeMaterial(root: unknown, id: string): string | null {
  const rec = asRecord(root);
  if (!rec) return null;
  if (rec.id === id) return typeof rec.material === "string" ? rec.material : null;
  const children = Array.isArray(rec.children) ? rec.children : [];
  for (const child of children) {
    const hit = docNodeMaterial(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

registerCommand({
  id: "node.add",
  label: "添加节点",
  group: "节点",
  expose: true,
  description:
    "在指定父节点下新增节点（kind: group/mesh/light/camera/skybox/fog/audio/particle/terrain/nav/logic/script/model；mesh 可带 subtype 几何与 position 出生落位，light 可带 subtype 灯光，skybox 可带 subtype 天空，fog 可带 subtype 雾类型，nav 可带 subtype 导航节点（area/agent），script 用 rel/path=脚本 .ts 相对路径，model/audio/terrain 用 path 或 rel 资产路径；parentId 或 parent 指定父节点，缺省挂根——仅当选中的是容器型节点（空组/UI 画布/布局）时才挂到其下，实体选中不隐式收子）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const st = editor();
    if (!st.state.mounted) throw new Error("编辑器未就绪，无法添加节点");
    for (const key of Object.keys(args ?? {})) {
      if (!ADD_KEYS.has(key)) {
        throw new Error(
          `node.add 不支持字段: ${key}（支持: ${[...ADD_KEYS].join("/")}；其余节点属性放 props）`,
        );
      }
    }
    // parent 别名：模型常写 parent（值可为节点 id 或 "root"），与 parentId 等价
    const parentRaw = args?.parentId ?? args?.parent;
    const parentId = parentRaw ? String(parentRaw) : undefined;
    const kind = String(args?.kind ?? args?.type ?? "group").toLowerCase();
    const subtype = args?.subtype !== undefined ? String(args.subtype) : undefined;
    // 枚举分支拼错直接报错（此前静默退化成默认值）
    if (kind !== "mesh" && kind !== "meshnode" && args?.geometry !== undefined) {
      throw new Error("geometry 仅 mesh 节点支持（其它类型用 subtype）");
    }
    if (kind !== "light" && kind !== "lightnode" && args?.lightKind !== undefined) {
      throw new Error("lightKind 仅 light 节点支持");
    }
    if (kind !== "skybox" && kind !== "skyboxnode" && args?.skyKind !== undefined) {
      throw new Error("skyKind 仅 skybox 节点支持");
    }
    if (kind !== "fog" && kind !== "fognode" && args?.fogKind !== undefined) {
      throw new Error("fogKind 仅 fog 节点支持");
    }
    // 材质引用有两种写法：顶层 material 与 props.material（模型/助手常用后者）。
    // 两种都必须走同一套「先等注册表就绪，拿不到就报错」——只认顶层时 props
    // 写法会绕过预取，节点虽写入 rel 但渲染落默认材质（applied 仍报成功）。
    const propsArg = asRecord(args?.props);
    // props 与顶层同时给出时 props 优先（与 applyAddExtras 的合并顺序一致）
    const materialRaw = propsArg?.material ?? args?.material;
    if (materialRaw !== undefined && typeof materialRaw !== "string") {
      throw new Error(`material 需要 .mat 资产相对路径字符串，收到: ${JSON.stringify(materialRaw)}`);
    }
    const materialRel = typeof materialRaw === "string" ? materialRaw.trim() : "";
    if (materialRel && !/\.mat$/i.test(materialRel)) {
      throw new Error(`material 需要 .mat 资产相对路径，收到: ${materialRel}`);
    }
    // 名字在创建时传入（factory 的 name 选项）：避免「add + rename」两条历史
    const name = args?.name ? String(args.name).trim() : "";
    // 材质注册表是惰性加载的：先预取目标材质及其着色器再建节点/绑定，
    // 避免首次引用材质时先落默认外观（甚至被迟到的 add 回显覆盖）。
    if (materialRel) {
      // 显式等待注册表：preload 会等待在途加载（不是「缓存没有就跳过」）
      await engine().materials.preload([materialRel]);
      if (!engine().materials.has(materialRel)) {
        const reason = engine().materials.isReady()
          ? "文件缺失或解析失败，先 asset.refresh 或检查路径"
          : "项目资产访问器未接入（项目/场景尚未装载完成）";
        throw new Error(`材质未就绪，未创建节点（MATERIAL_NOT_READY）: ${materialRel}（${reason}）`);
      }
      const shaderRel = engine().materials.shaderFor(materialRel);
      if (shaderRel && !engine().shaders.has(shaderRel)) {
        await engine().shaders.preload([shaderRel]);
      }
    }
    let node;
    switch (kind) {
      case "group":
      case "node":
        node = engine().addEmptyGroup(parentId, name);
        break;
      case "mesh":
      case "meshnode":
        // subtype=data → 数据化网格节点（source=data，载荷经检查器导入）
        // position：出生落位（{x,y,z}，缺省回退引擎默认出生偏移）
        node = subtype === "data"
          ? engine().addDataMesh(parentId, asPosition(args?.position), name)
          : engine().addMesh(
              strictSubtype(GEOMETRY_KINDS, subtype ?? args?.geometry, "geometry") ?? "box",
              parentId,
              asPosition(args?.position),
              name,
            );
        break;
      case "light":
      case "lightnode":
        node = engine().addLight(
          strictSubtype(LIGHT_KINDS, subtype ?? args?.lightKind, "lightKind") ?? "point",
          parentId,
          name,
        );
        break;
      case "camera":
      case "cameranode":
        node = engine().addCamera(parentId, name);
        break;
      case "skybox":
      case "skyboxnode":
        node = engine().addSkybox(
          strictSubtype(SKYBOX_KINDS, subtype ?? args?.skyKind, "skyKind") ?? "procedural",
          parentId,
          name,
        );
        break;
      case "fog":
      case "fognode":
        node = engine().addFog(
          strictSubtype(FOG_KINDS, subtype ?? args?.fogKind, "fogKind") ?? "linear",
          parentId,
          name,
        );
        break;
      case "audio":
      case "audionode": {
        // 可选 path：直接绑定音频资产（资产面板「添加到场景」）
        const audioSrc = args?.path ?? args?.rel;
        node = engine().addAudio(parentId, audioSrc !== undefined && audioSrc !== null ? String(audioSrc) : "", name);
        break;
      }
      case "particle":
      case "particles":
      case "particlesystem":
      case "particlesystemnode":
        node = engine().addParticleSystem(parentId, name);
        break;
      case "nav":
      case "navarea":
      case "navagent": {
        // nav:<area|agent>（裸 "nav" = 区域）；导航区域覆盖范围自动取所采样地形
        const navKind = kind === "nav" ? (subtype ?? "area") : kind === "navarea" ? "area" : "agent";
        if (navKind !== "area" && navKind !== "agent") {
          throw new Error(`未知导航类型: ${navKind}（应为 area/agent）`);
        }
        if (navKind === "agent") node = engine().addNavAgent(parentId, name);
        else node = engine().addNavArea(parentId, name);
        break;
      }
      case "logic":
      case "fsm":
      case "fsmrunner":
      case "bt":
      case "btrunner": {
        // logic:<fsm|bt>（裸 "fsm"/"bt" 亦可）；运行器建好后经检查器绑定逻辑资产
        const logicKind = kind.startsWith("logic")
          ? (subtype ?? "fsm")
          : kind.startsWith("fsm")
            ? "fsm"
            : "bt";
        if (logicKind === "bt") node = engine().addBtRunner(parentId, name);
        else if (logicKind === "fsm") node = engine().addFsmRunner(parentId, name);
        else throw new Error(`未知逻辑运行器类型: logic:${logicKind}（应为 fsm/bt）`);
        break;
      }
      case "terrain":
      case "terrainnode": {
        // 可选 path：直接绑定 .terrain 资产（资产面板「添加到场景」/devtools），
        // 快照资产设置到节点（运行时不读资产文件，设置内嵌在节点上）
        const terrainSrc = args?.path ?? args?.rel;
        const terrainPath = terrainSrc !== undefined && terrainSrc !== null ? String(terrainSrc) : "";
        if (terrainPath) {
          if (!isTerrainAssetRel(terrainPath)) {
            throw new Error(`非地形资产: ${terrainPath}（应为 .terrain）`);
          }
          const root = getProjectStore().currentPath;
          if (!root) throw new Error("未打开项目，无法读取地形资产");
          const text = await api.readText(root, terrainPath);
          const doc = JSON.parse(text) as { settings?: unknown };
          node = engine().addTerrain(
            parentId,
            {
              asset: terrainPath,
              terrain: parseTerrainSettings(doc.settings),
            },
            name,
          );
        } else {
          node = engine().addTerrain(parentId, undefined, name);
        }
        break;
      }
      case "ui":
      case "uicanvas":
      case "uiimage":
      case "uitext":
      case "uibutton":
      case "uilayout": {
        // ui:<canvas|text|image|button|layout>（裸 "ui" = 画布）；Widget 建议挂在画布下
        const uiKind = kind === "ui" ? (subtype ?? "canvas") : kind.startsWith("ui") ? kind.slice(2) : (subtype ?? "canvas");
        switch (uiKind) {
          case "canvas": {
            // 画布渲染尺寸默认取项目设置（设计分辨率按屏幕方向定向）
            const ps = getProjectStore();
            let w = Math.max(1, Math.round(ps.designWidth));
            let h = Math.max(1, Math.round(ps.designHeight));
            if (ps.orientation === "portrait" && w > h) [w, h] = [h, w];
            if (ps.orientation === "landscape" && h > w) [w, h] = [h, w];
            node = engine().addUICanvas(
              parentId,
              {
                designWidth: w,
                designHeight: h,
              },
              name,
            );
            break;
          }
          case "text":
            node = engine().addUIText(parentId, name);
            break;
          case "image":
            node = engine().addUIImage(parentId, name);
            break;
          case "button":
            node = engine().addUIButton(parentId, name);
            break;
          case "layout":
            node = engine().addUILayout(parentId, name);
            break;
          default:
            throw new Error(`未知 UI 节点类型: ui:${uiKind}（应为 canvas/text/image/button/layout）`);
        }
        break;
      }
      case "script":
      case "scriptnode": {
        // 脚本路径多别名：模型惯写 rel/path，与历史契约 scriptRel/subtype 等价
        const rel = subtype ?? args?.scriptRel ?? args?.rel ?? args?.path;
        if (!rel)
          throw new Error(
            "脚本节点缺少脚本路径：用 rel（或 path/scriptRel/subtype）= 如 src/Player.ts 的 .ts 资产相对路径",
          );
        const nt = getScriptsStore().scriptNodeTypes().find((s) => s.rel === rel);
        node = engine().addScriptNode(String(rel), nt?.nodeType ?? { kind: "node" }, parentId, name);
        break;
      }
      case "model": {
        const rel = args?.path ?? args?.rel;
        if (!rel)
          throw new Error("模型节点缺少资产路径：用 path（或 rel）= 模型资产相对路径（.glb/.gltf）");
        node = engine().addModel(String(rel), parentId, asPosition(args?.position), name);
        break;
      }
      default:
        throw new Error(
          `未知节点类型: ${kind}（应为 group/mesh/light/camera/skybox/fog/audio/particle/terrain/nav/logic/script/model）`,
        );
    }
    const applied: string[] = [];
    if (name) applied.push("name");
    // 创建即落位/尺寸/材质：此前这些字段被静默丢弃（外部 Agent 只能两段式再写）
    applied.push(...applyAddExtras(node, args ?? {}));
    // 材质是「成功响应里丢数据」的高危字段：等写链落账后回读后端文档核验。
    // 只信后端权威态——前端镜像的本地乐观值在补丁未落账时也已正确，无法自证。
    if (materialRel) {
      await graph().quiesceWrites();
      const doc = (await sceneApi.doc()) as { root?: unknown } | null;
      const actual = docNodeMaterial(doc?.root, node.id);
      if (actual !== materialRel) {
        const at = applied.indexOf("material");
        if (at >= 0) applied.splice(at, 1);
        throw new Error(
          `材质绑定未生效（MATERIAL_NOT_APPLIED）：请求 ${materialRel}，后端实际 ${actual ?? "(节点缺失)"}。` +
            `节点 ${node.id} 已创建，可用 node.set {id, material} 重试`,
        );
      }
    }
    return { id: node.id, name: node.name, type: kind, applied };
  },
});

registerCommand({
  id: "node.component.add",
  label: "添加组件",
  group: "节点",
  expose: true,
  description:
    "给节点添加组件（属性面板组件卡同源，一次撤销）。脚本组件：不传 type，给 script=脚本 .ts 相对路径（如 src/Player.ts）；" +
    "内置组件：type=rigidBody/collider/light/audioSource/animationClip（light 可带 lightKind）。重复挂载的脚本与单实例组件幂等/报错",
  run: (_ctx, args: Record<string, unknown>) => {
    const id = String(args?.id ?? "");
    const node = graph().get(id);
    if (!node) throw new Error(`未找到节点: ${id}（先用 scene.tree 或层级面板查节点 id）`);
    const raw = node.toJSON() as JsonRecord;
    const comps: Array<Record<string, unknown>> = Array.isArray(raw.components)
      ? [...(raw.components as Array<Record<string, unknown>>)]
      : [];
    const typeRaw = String(args?.type ?? "script").toLowerCase();
    const BUILTIN = new Set(["rigidbody", "collider", "light", "audiosource", "animationclip"]);
    let comp: NodeComponentRef;
    if (typeRaw === "script" || typeRaw === "scriptcomponent") {
      const rel = String(args?.script ?? args?.rel ?? args?.path ?? "").trim();
      if (!rel) throw new Error("缺少 script 参数（脚本 .ts 相对路径，如 src/Player.ts）");
      if (comps.some((c) => c.type === "script" && String(c.script) === rel)) {
        return { ok: true, id, added: false, note: `脚本组件已挂载：${rel}（勿重复添加；改参数在属性面板或用 node.set）` };
      }
      comp = createScriptComponentRef(rel);
    } else if (BUILTIN.has(typeRaw)) {
      // 命令入参已小写化；描述符/元数据键是驼峰（rigidBody/audioSource/animationClip），
      // 经归一映射回登记键，否则 descriptorOf 查不到报"未登记的组件类型"
      const t = canonicalComponentType(typeRaw);
      if (!t) {
        throw new Error(`未知组件类型: ${args?.type}（内置组件 type=rigidBody/collider/light/audioSource/animationClip）`);
      }
      if (!canAddComponent({ components: comps as unknown as NodeComponentRef[] }, t)) {
        throw new Error(`「${componentMetaOf(t).label}」是单实例组件，该节点已挂载`);
      }
      // lightKind 可选且须为合法灯型（组件描述符按灯型初始化默认参数）
      const lightKind = LIGHT_KINDS.find((k) => k === args?.lightKind);
      comp = createComponentRef(t, lightKind ? { lightKind } : {});
    } else {
      throw new Error(
        `未知组件类型: ${args?.type}（脚本组件不传 type 只给 script；内置组件 type=rigidBody/collider/light/audioSource/animationClip）`,
      );
    }
    const after = { ...raw, components: [...comps, comp] } as unknown as JsonRecord;
    engine().patchNode(id, raw, after, "添加组件");
    return { ok: true, id, added: true, component: comp };
  },
});

registerCommand({
  id: "node.rename",
  label: "重命名节点",
  group: "节点",
  expose: true,
  description: "重命名节点（id 缺省时重命名当前选中节点）",
  run: (_ctx, args: Record<string, unknown>) => {
    const name = String(args?.name ?? "").trim();
    if (!name) return { renamed: false };
    if (args?.id) {
      graph().rename(String(args.id), name);
    } else {
      engine().renameSelected(name);
    }
    return { renamed: true, name };
  },
});

registerCommand({
  id: "node.delete",
  label: "删除节点",
  group: "节点",
  expose: true,
  description: "删除节点（id/ids：节点 id 或 id 数组；根场景节点不可删除）",
  run: (_ctx, args: Record<string, unknown>) => {
    const ids = asIdList(args?.ids ?? (args?.id ? [args.id] : []));
    const root = graph().root;
    let targets = ids.filter((id) => {
      const n = graph().get(id);
      return !!n && n.id !== root?.id;
    });
    if (targets.length > 1) {
      // 剔除互为子孙的冗余项，只保留顶层，避免父删后子再删的重复
      targets = targets.filter(
        (tid) => !targets.some((other) => other !== tid && graph().isDescendant(other, tid)),
      );
    }
    if (!targets.length) {
      console.warn("根场景节点不可删除");
      return { deleted: [], roots: [] };
    }
    // 真实级联范围：删除父级会连同子孙一起消失，返回值完整列给调用方
    const removed: string[] = [];
    for (const id of targets) collectSubtreeIds(id, removed);
    engine().deleteNodes(targets);
    return { deleted: removed, roots: targets };
  },
});

registerCommand({
  id: "node.duplicate",
  label: "复制节点",
  group: "节点",
  expose: true,
  description: "复制节点子树（id/ids：节点 id 或 id 数组；缺省 = 当前选中节点；根场景节点不可复制；一次撤销）",
  canRun: (ctx) => {
    if (ctx.view !== "editor") return false;
    const s = editor();
    if (!s.state.mounted) return false;
    return !!s.state.selectedId;
  },
  run: (_ctx, args: Record<string, unknown>) => {
    let ids = asIdList(args?.ids ?? (args?.id ? [args.id] : []));
    // 缺省：复制当前选中节点（Ctrl+D 快捷键路径）
    if (!ids.length) {
      ids = [...engine().selectionIds];
    }
    const root = graph().root;
    let targets = ids.filter((id) => {
      const n = graph().get(id);
      return !!n && n.id !== root?.id;
    });
    if (targets.length > 1) {
      // 剔除互为子孙的冗余项，只保留顶层，避免父复制后子再复制的重复
      targets = targets.filter(
        (tid) => !targets.some((other) => other !== tid && graph().isDescendant(other, tid)),
      );
    }
    if (!targets.length) {
      console.warn("根场景节点不可复制");
      return { duplicated: [] };
    }
    const newIds: string[] = [];
    for (const id of targets) {
      const newId = engine().duplicateNode(id);
      if (newId) newIds.push(newId);
    }
    if (newIds.length) engine().setSelection(newIds);
    return { duplicated: newIds };
  },
});

registerCommand({
  id: "node.reparent",
  label: "移动节点",
  group: "节点",
  description: "移动节点到新父级/新位置（moves：MoveTarget[]；selectIds 移动后选中）",
  run: (_ctx, args: Record<string, unknown>) => {
    const moves = asMoveTargets(args?.moves);
    const valid: MoveTarget[] = [];
    for (const m of moves) {
      const n = graph().get(m.id);
      if (!n || n.isRoot) continue;
      // 成环：新父是被拖节点自身或其子孙（拖入自身子树）
      if (m.newParentId === m.id || (m.newParentId && graph().isDescendant(m.id, m.newParentId))) {
        console.warn("无法移动：不能拖入自身或其子孙节点");
        return { reparented: [] };
      }
      valid.push(m);
    }
    if (valid.length) {
      engine().reparentNodes(valid);
      const sel = asStrings(args?.selectIds);
      if (sel.length) engine().setSelection(sel);
    }
    return { reparented: valid.map((m) => m.id) };
  },
});

registerCommand({
  id: "node.patch",
  label: "更新节点",
  group: "节点",
  description: "整节点属性补丁（before/after 快照，一次撤销）",
  run: (_ctx, args: Record<string, unknown>) => {
    const id = String(args?.id ?? "");
    if (!id || !graph().has(id)) return { patched: false };
    engine().patchNode(
      id,
      args.before as JsonRecord,
      args.after as JsonRecord,
      typeof args.label === "string" ? args.label : undefined,
    );
    return { patched: true };
  },
});

registerCommand({
  id: "node.setTransform",
  label: "设置变换",
  group: "节点",
  description: "写入节点变换快照（position/rotation/scale，一次撤销）",
  run: (_ctx, args: Record<string, unknown>) => {
    const id = String(args?.id ?? "");
    if (id) {
      const snapshot = asTransformSnapshot(args?.snapshot);
      if (!snapshot) {
        throw new Error("缺少有效 snapshot（position/rotation/scale 各 {x,y,z} 有限数字）");
      }
      engine().setTransform(id, snapshot);
    }
    return { ok: true };
  },
});

registerCommand({
  id: "node.set",
  label: "设置节点属性",
  group: "节点",
  expose: true,
  description:
    "设置节点属性（写入节点 JSON 并走撤销历史）。两种形式：{id, prop, value} 单属性，" +
    "或 {id, ...字段} 字段包（name/visible/active/tag/transform/position/rotation/scale 等" +
    "任意混写；transform 与分量支持部分字段逐轴合并，未给的分量保持原值）",
  run: async (_ctx, args: Record<string, unknown>) => {
    const id = String(args?.id ?? "");
    const node = graph().get(id);
    if (!node) throw new Error(`未找到节点: ${id}`);
    const parsed = parseNodeSetArgs(args);
    if ("error" in parsed) throw new Error(parsed.error);
    const { name, transform, props } = parsed.patch;
    // 材质同样是惰性注册表：写入前等预取完成，拿不到就报错（不留「rel 已写、
    // 渲染落默认」的半生效状态）
    const materialRel = typeof props?.material === "string" ? props.material.trim() : "";
    if (materialRel) {
      await engine().materials.preload([materialRel]);
      if (!engine().materials.has(materialRel)) {
        const reason = engine().materials.isReady()
          ? "文件缺失或解析失败，先 asset.refresh 或检查路径"
          : "项目资产访问器未接入（项目/场景尚未装载完成）";
        throw new Error(`材质未就绪，未修改节点（MATERIAL_NOT_READY）: ${materialRel}（${reason}）`);
      }
      const shaderRel = engine().materials.shaderFor(materialRel);
      if (shaderRel && !engine().shaders.has(shaderRel)) {
        await engine().shaders.preload([shaderRel]);
      }
    }
    const set: string[] = [];
    if (name !== undefined) {
      if (node.name !== name) graph().rename(id, name);
      set.push("name");
    }
    if (transform) {
      const merged = mergeTransformSnapshot(
        currentTransform(node.transform.position, node.transform.rotation, node.transform.scale),
        transform,
      );
      if ("error" in merged) throw new Error(merged.error);
      engine().setTransform(id, merged.snapshot);
      set.push("transform");
    }
    if (props) {
      // 属性命令通道的值域收敛：未知属性/非法 geometry/非正 size 报错自纠，
      // 值按节点实例字段类型归一（与 node.add 的 props 走同一校验）
      const coerced = coercePropsToNode(node, props);
      if ("error" in coerced) throw new Error(coerced.error);
      const before = node.toJSON() as JsonRecord;
      const after = {
        ...(before as unknown as Record<string, unknown>),
        ...coerced.props,
      } as unknown as JsonRecord;
      engine().patchNode(id, before, after, "开发者服务·设置节点");
      set.push(...Object.keys(coerced.props));
    }
    return { ok: true, id, set };
  },
});

registerCommand({
  id: "node.alignCameraToViewport",
  label: "相机对齐当前视口",
  group: "节点",
  description: "把相机节点位姿与取景参数对齐到当前编辑器视口相机（id 缺省 = 当前选中节点；一次撤销）",
  run: (_ctx, args: Record<string, unknown>) => {
    const st = editor();
    if (!st.state.mounted) throw new Error("编辑器未就绪，无法对齐相机");
    const id = args?.id ? String(args.id) : st.state.selectedId;
    if (!id) return { aligned: false };
    const aligned = engine().alignCameraToViewport(id);
    if (!aligned) console.warn("对齐失败：目标不是相机节点");
    return { aligned, id };
  },
});

registerCommand({
  id: "node.select",
  label: "选中节点",
  group: "节点",
  expose: true,
  description: "选中场景节点（id 传空 = 取消选中）",
  run: (_ctx, args: Record<string, unknown>) => {
    engine().select(args?.id ? String(args.id) : null);
    return { ok: true };
  },
});

registerCommand({
  id: "node.renameSelected",
  label: "重命名选中节点",
  group: "节点",
  description: "弹出统一输入框重命名当前选中节点（层级右键/F2 共用；根节点不可重命名）",
  canRun: (ctx) => {
    if (ctx.view !== "editor") return false;
    const s = getEditorStore();
    if (!s.state.mounted) return false;
    if (!s.state.selectedId) return false;
    // 脚本工作台：正在文本编辑（Monaco 等）时不劫持 F2（保留编辑器自身重命名等行为）
    if (s.state.viewMode === "script" && isEditingText()) return false;
    return true;
  },
  run: async () => {
    const store = getEditorStore();
    if (!store.state.mounted) return { renamed: false };
    const id = store.state.selectedId;
    if (!id) return { renamed: false };
    const node = graph().get(id);
    if (!node || node.isRoot) return { renamed: false };
    const current = node.name;
    const name = await prompt({
      title: "重命名节点",
      label: current,
      initial: current,
      confirmText: "重命名",
    });
    if (name && name.trim()) {
      graph().rename(id, name.trim());
      return { renamed: true, name: name.trim() };
    }
    return { renamed: false };
  },
});
