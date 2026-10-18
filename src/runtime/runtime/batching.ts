// 场景批处理优化：InstancedMesh + 静态几何合并，减少 DrawCall。
// - InstancedMesh：相同 (geometry, material, layer) 的静态网格 → 1 个 InstancedMesh
// - 静态合并：同材质不同几何的静态网格 → mergeGeometries 合并为单个 Mesh
// - 基元（source=primitive）与数据化网格（source=data）：实例化 + 合并两路都走；
// - 模型（source=model）：仅实例化、不合并——同 GLB 多节点共享模板的
//   geometry/material（SkeletonUtils.clone 不复制），天然按 key 成组（围栏×18 →
//   1 个 InstancedMesh）；合并会跨不同几何拼 attributes（uv/顶点色等有无不齐
//   时静默丢数据），对模型不安全。候选是 __modelRoot 下的叶子网格，资格为
//   「整节点全有或全无」：子树内任一网格蒙皮/带形变目标/多材质/透明 → 整节点
//   不烘焙（部分烘焙会撕裂模型内部结构）；
// - 均不处理带动画/脚本/物理/描边/透明的网格；父链上任一「运行期可动」的节点
//   （图/动画引用、脚本/刚体组件、导航代理）也会连带取消其子树的批处理资格——
//   子网格运行期会跟随父级移动，烘焙副本则永远停留在烘焙时的世界位姿
// - 原始网格 visible=false 保留在树中（脚本仍可寻址），优化网格挂场景根
// - 「运行期动态」勾选的节点（json.runtimeDynamic）整节点豁免烘焙；
// - 被烘焙的节点按 owner 挂 batchBinding（userData.batchBinding）：tve 脚本对
//   位姿/可见性的写入同步到实例副本（矩阵脏检查 + 零缩放隐藏）——子弹、
//   可破坏物无需任何组件即可被脚本驱动；「合并」成员无法逐节点同步，
//   需脚本驱动的基元请勾选运行期动态

import * as THREE from "../core/three.module.min.js";
import { postLog } from "../core/log";
import type { NodeJson } from "./node-json";

interface MeshEntry {
  json: NodeJson;
  obj: THREE.Object3D;
}

interface ClipEntry {
  nodeId: string;
}

/** 烘焙候选：mesh = 参与分组的网格；owner = 脚本可寻址的节点对象
 *  （基元 = 网格本身；模型 = container，一个 owner 可有多个叶子条目）。
 *  烘焙后按 owner 挂 batchBinding（脚本位姿/可见性写入同步到实例副本）。 */
interface BatchCandidate {
  mesh: THREE.Mesh;
  ownerId: string;
  ownerObj: THREE.Object3D;
}

/** 烘焙绑定条目：实例网格 + 该成员在其中的实例下标 + 原叶子网格（矩阵事实源） */
interface BatchBindingEntry {
  inst: THREE.InstancedMesh;
  index: number;
  leaf: THREE.Mesh;
}

/** 烘焙绑定（挂在 owner.userData.batchBinding，tve entity 写入据此转发）：
 *  - 位姿：owner 的 updateMatrixWorld 被覆写为「先原语义、后把各叶子世界矩阵
 *    对齐进实例」（脏检查跳过未变帧；渲染器每帧从场景根递归调用，脚本对
 *    position/rotation/scale/translate/lookAt 的任何写入下一帧即有表现）；
 *  - 可见性：InstancedMesh 无逐实例开关，以零缩放矩阵收拢为退化点实现隐藏
 *    （零面积三角形不被光栅化，阴影同理），恢复时从叶子世界矩阵还原。 */
interface BatchBinding {
  visible: boolean;
  setVisible(v: boolean): void;
  sync(): void;
}

interface OptimizeOptions {
  instancing?: boolean;
  batching?: boolean;
  /**
   * 排除节点 id（合并/实例化会把原网格置 visible=false，渲染的是副本）：
   * 脚本图引用到的实体必须保持原对象可见且未被烘焙——图在运行期移动的是
   * 树中的原对象，被批处理吞掉后位姿变化没有任何视觉表现。
   * player 经 graphReferencedEntityIds(graphDoc, nodes) 预计算传入。
   */
  excludeNodeIds?: Iterable<string>;
  /**
   * 全量场景节点表（json + obj）：识别「父链可动」用——祖先节点带
   * script/rigidBody 组件或为导航代理时，其子网格会跟随父级移动，
   * 必须连同子树一起取消烘焙资格（只查网格自身的组件会漏掉这一层）。
   */
  nodes?: MeshEntry[];
}

/** 场景批处理优化入口 */
export function optimizeScene(
  scene: THREE.Scene,
  meshes: MeshEntry[],
  clips: ClipEntry[],
  options?: OptimizeOptions,
): void {
  const opts = {
    instancing: options?.instancing !== false,
    batching: options?.batching !== false,
  };

  // 烘焙前先刷新整棵树的世界矩阵：副本按 matrixWorld 烘到场景根，而 player 在
  // 批处理时尚未推进过矩阵（首帧渲染/configureShadows 都在其后），单节点
  // updateMatrixWorld 只会拿父链上还是恒等的 matrixWorld 相乘，祖先变换全丢——
  // 父节点带位移的网格会被烘到错误位置（原网格已隐藏 → 视觉上整组消失）。
  scene.updateMatrixWorld(true);

  const animatedNodeIds = new Set<string>();
  for (const c of clips) if (c.nodeId) animatedNodeIds.add(c.nodeId);

  const excludeNodeIds = options?.excludeNodeIds ? new Set(options.excludeNodeIds) : undefined;

  // 父链可动检测的输入：图/动画引用 id 集合 + 全量节点表（查祖先组件用）
  const movingIds = new Set<string>(excludeNodeIds ?? []);
  for (const c of clips) if (c.nodeId) movingIds.add(c.nodeId);
  const jsonById = new Map<string, NodeJson>();
  for (const { json } of options?.nodes ?? []) {
    if (json && typeof json.id === "string") jsonById.set(json.id, json);
  }
  /** 任一祖先「运行期可动」（被图/动画引用、带脚本/刚体组件、导航代理）→ 子树不可烘焙 */
  const hasDynamicAncestor = (obj: THREE.Object3D): boolean => {
    for (let p = obj.parent; p && p !== scene; p = p.parent) {
      const id = typeof p.userData.nodeId === "string" ? p.userData.nodeId : "";
      if (!id) continue;
      if (movingIds.has(id)) return true;
      const pj = jsonById.get(id);
      if (!pj) continue;
      if (pj.type === "navAgentNode") return true;
      const comps = Array.isArray(pj.components) ? pj.components : [];
      for (const c of comps) {
        if (!c || c.enabled === false) continue;
        if (c.type === "script" || c.type === "rigidBody") return true;
      }
    }
    return false;
  };

  const staticCandidates: BatchCandidate[] = [];
  // 合并资格与实例化资格分离：模型叶子只可实例化（见文件头注释），基元/数据两路都可
  const mergeEligible = new Set<THREE.Mesh>();
  for (const { json, obj } of meshes) {
    // 运行期动态显式豁免（检查器「运行期动态」勾选）：脚本要驱动位姿/可见性的物体
    if (json.runtimeDynamic === true) continue;
    const ownerId = typeof obj.userData.nodeId === "string" ? obj.userData.nodeId : "";
    if (json.source === "model") {
      collectModelMeshes(obj, json, animatedNodeIds, excludeNodeIds, hasDynamicAncestor, (mesh) =>
        staticCandidates.push({ mesh, ownerId, ownerObj: obj }),
      );
      continue;
    }    if (!isStaticMesh(json, obj, animatedNodeIds, excludeNodeIds)) continue;
    if (hasDynamicAncestor(obj)) continue;
    staticCandidates.push({ mesh: obj as THREE.Mesh, ownerId, ownerObj: obj });
    mergeEligible.add(obj as THREE.Mesh);
  }
  if (staticCandidates.length < 2) return;

  let instanced = 0;
  let merged = 0;
  // 合并候选恒过滤到基元/数据（模型叶子无论实例化开关如何都不进合并）
  let remaining = staticCandidates.filter((c) => mergeEligible.has(c.mesh));

  if (opts.instancing) {
    const result = buildInstancedMeshes(scene, staticCandidates);
    instanced = result.instancedCount;
    remaining = result.remaining.filter((c) => mergeEligible.has(c.mesh));
  }

  if (opts.batching && remaining.length > 1) {
    merged = mergeStaticGeometries(scene, remaining.map((c) => c.mesh));
  }

  if (instanced > 0 || merged > 0) {
    postLog("info", `[批处理] InstancedMesh ${instanced} 组，几何合并 ${merged} 组，优化 ${instanced + merged} 个 DrawCall`);
  }
}

/** 判断是否为可批处理的静态网格 */
function isStaticMesh(
  json: NodeJson,
  obj: THREE.Object3D,
  animatedNodeIds: Set<string>,
  excludeNodeIds?: Set<string>,
): boolean {
  // 基元与数据化网格都是纯静态几何（模型/动画/脚本/物理路径不走批处理）
  if (json.source !== "primitive" && json.source !== "data") return false;
  if (!(obj as THREE.Mesh).isMesh) return false;
  const nodeId = obj.userData.nodeId;
  if (nodeId && animatedNodeIds.has(nodeId)) return false;
  // 场景图引用实体：运行期位姿由脚本图驱动，不可烘焙（烘焙=原对象隐藏）
  if (nodeId && excludeNodeIds?.has(nodeId)) return false;
  if (obj.children.length > 0) return false;
  const comps = Array.isArray(json.components) ? json.components : [];
  for (const c of comps) {
    if (!c || c.enabled === false) continue;
    if (c.type === "script" || c.type === "rigidBody" || c.type === "collider") return false;
  }
  const mat = (obj as THREE.Mesh).material as THREE.Material;
  if (mat && mat.transparent) return false;
  // wireframe 只有基元材质有（结构断言；描边/线框网格不走合并）
  if (mat && (mat as { wireframe?: boolean }).wireframe) return false;
  return true;
}

/**
 * 模型节点（source=model）的静态烘焙候选收集：__modelRoot 克隆子树里的叶子网格。
 * 资格判定为「整节点全有或全无」：
 * - 节点级排除（与基元同语义）：动画绑定/图引用/自身带 script/rigidBody/collider
 *   组件的节点整棵不烘焙；
 * - 叶子级排除：蒙皮网格（骨骼绑定逐克隆重建，实例化共用单几何会撕裂）、
 *   带形变目标（morph 逐实例插值状态不同）、多材质分组、透明——任一叶子命中
 *   即整节点放弃（部分烘焙会隐藏一半模型）；
 * - 祖先可动性逐叶子走 hasDynamicAncestor（容器 nodeId → 祖先链，覆盖图引用
 *   父级/脚本祖先/导航代理）。
 */
function collectModelMeshes(
  obj: THREE.Object3D,
  json: NodeJson,
  animatedNodeIds: Set<string>,
  excludeNodeIds: Set<string> | undefined,
  hasDynamicAncestor: (o: THREE.Object3D) => boolean,
  push: (mesh: THREE.Mesh) => void,
): void {
  const nodeId = typeof obj.userData.nodeId === "string" ? obj.userData.nodeId : "";
  if (nodeId && animatedNodeIds.has(nodeId)) return;
  if (nodeId && excludeNodeIds?.has(nodeId)) return;
  const comps = Array.isArray(json.components) ? json.components : [];
  for (const c of comps) {
    if (!c || c.enabled === false) continue;
    if (c.type === "script" || c.type === "rigidBody" || c.type === "collider") return;
  }
  const leaves: THREE.Mesh[] = [];
  let eligible = true;
  obj.traverse((o) => {
    if (!eligible) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh === true;
    const geom = mesh.geometry;
    const morphed = !!geom && Object.keys(geom.morphAttributes).length > 0;
    const mat = mesh.material;
    const multiMat = Array.isArray(mat);
    const single = multiMat ? null : (mat as THREE.Material);
    if (skinned || morphed || multiMat || !single || single.transparent) {
      eligible = false;
      return;
    }
    leaves.push(mesh);
  });
  if (!eligible) return;
  for (const leaf of leaves) {
    if (hasDynamicAncestor(leaf)) return;
  }
  for (const leaf of leaves) push(leaf);
}

/** 按 (geometry, material, layer) 分组创建 InstancedMesh，并按 owner 安装烘焙绑定 */
function buildInstancedMeshes(
  scene: THREE.Scene,
  candidates: BatchCandidate[],
): { remaining: BatchCandidate[]; instancedCount: number } {
  const groups = new Map<string, BatchCandidate[]>();
  for (const cand of candidates) {
    const key = getInstancingKey(cand.mesh);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(cand);
  }

  const remaining: BatchCandidate[] = [];
  let instancedCount = 0;
  // 同 owner 的叶子可能落进多个组（模型内含多种几何）；收集完一次性安装绑定
  const byOwner = new Map<string, { ownerObj: THREE.Object3D; entries: BatchBindingEntry[] }>();

  for (const [, group] of groups) {
    if (group.length < 2) {
      remaining.push(...group);
      continue;
    }
    const template = group[0].mesh;
    const geom = template.geometry;
    // 实例化按单材质分组（getInstancingKey 含 material.uuid），此处必为单材质；
    // 层级按叶子网格的 layer 掩码整组复制（模型叶子层级在 layers 位掩码上，
    // 容器的 userData.nodeLayer 不会传到叶子）
    const mat = template.material as THREE.Material;

    const inst = new THREE.InstancedMesh(geom, mat, group.length);
    inst.castShadow = template.castShadow;
    inst.receiveShadow = template.receiveShadow;
    inst.layers.mask = template.layers.mask;
    // 脚本驱动的烘焙节点会运行期改写实例矩阵：动态_hint（量级为几十项，无实测差异）
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = "__batchedInstances";

    for (let i = 0; i < group.length; i++) {
      const cand = group[i];
      cand.mesh.updateMatrixWorld();
      inst.setMatrixAt(i, cand.mesh.matrixWorld);
      cand.mesh.visible = false;
      cand.mesh.castShadow = false;
      if (cand.ownerId) {
        let slot = byOwner.get(cand.ownerId);
        if (!slot) {
          slot = { ownerObj: cand.ownerObj, entries: [] };
          byOwner.set(cand.ownerId, slot);
        }
        slot.entries.push({ inst, index: i, leaf: cand.mesh });
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
    instancedCount++;
  }

  for (const [, slot] of byOwner) installBatchBinding(slot.ownerObj, slot.entries);

  return { remaining, instancedCount };
}

/** 安装烘焙绑定：userData 承载（tve entity 据此转发写入）+ updateMatrixWorld 尾随同步。
 *  渲染器每帧从场景根递归调用 updateMatrixWorld（与可见性无关），脚本对
 *  position/rotation/scale/translate/lookAt 的任何写入下一帧即对齐到实例。 */
function installBatchBinding(ownerObj: THREE.Object3D, entries: BatchBindingEntry[]): void {
  const binding = createBatchBinding(entries);
  ownerObj.userData.batchBinding = binding;
  const protoUpdate = THREE.Object3D.prototype.updateMatrixWorld;
  ownerObj.updateMatrixWorld = ((force?: boolean) => {
    protoUpdate.call(ownerObj, force);
    binding.sync();
  }) as typeof ownerObj.updateMatrixWorld;
}

/** 创建烘焙绑定：位姿脏检查同步 + 可见性零缩放收拢（见 BatchBinding 注释） */
function createBatchBinding(entries: BatchBindingEntry[]): BatchBinding {
  const last = entries.map(() => new THREE.Matrix4());
  for (let i = 0; i < entries.length; i++) last[i].copy(entries[i].leaf.matrixWorld);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const binding: BatchBinding = {
    visible: true,
    setVisible(v: boolean): void {
      if (binding.visible === v) return;
      binding.visible = v;
      if (!v) {
        for (const e of entries) {
          e.inst.setMatrixAt(e.index, ZERO);
          e.inst.instanceMatrix.needsUpdate = true;
        }
        return;
      }
      // 恢复：清缓存（零矩阵必不等）让下一次 sync 从叶子世界矩阵还原；
      // 立刻主动推一轮，隐藏当帧即可见
      for (let i = 0; i < entries.length; i++) last[i].copy(ZERO);
      binding.sync();
    },
    sync(): void {
      if (!binding.visible) return;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (last[i].equals(e.leaf.matrixWorld)) continue;
        e.inst.setMatrixAt(e.index, e.leaf.matrixWorld);
        last[i].copy(e.leaf.matrixWorld);
        e.inst.instanceMatrix.needsUpdate = true;
      }
    },
  };
  return binding;
}

/** 实例化分组 key：geometry+material+layer 对象身份（材质取 uuid——类型库未暴露
 *  Material.id，uuid 同为对象身份；层级取 layers 位掩码——基元/模型叶子的层级
 *  都落在 layers 上，同节点子树同掩码） */
function getInstancingKey(mesh: THREE.Mesh): string | null {
  const geom = mesh.geometry;
  const mat = mesh.material as THREE.Material;
  if (!geom || !mat) return null;
  return `${geom.id}|${mat.uuid}|${mesh.layers.mask}`;
}

/** 按材质分组合并几何体 */
function mergeStaticGeometries(scene: THREE.Scene, meshes: THREE.Mesh[]): number {
  const byMaterial = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.Material;
    let group = byMaterial.get(mat.uuid);
    if (!group) {
      group = [];
      byMaterial.set(mat.uuid, group);
    }
    group.push(mesh);
  }

  let mergedCount = 0;

  for (const [, group] of byMaterial) {
    if (group.length < 2) continue;
    const template = group[0];
    const mat = template.material;
    const layer = template.userData.nodeLayer || 0;

    const geometries: THREE.BufferGeometry[] = [];
    for (const mesh of group) {
      mesh.updateMatrixWorld();
      const clone = mesh.geometry.clone();
      clone.applyMatrix4(mesh.matrixWorld);
      geometries.push(clone);
    }

    const merged = mergeGeometries(geometries);
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = template.castShadow;
    mesh.receiveShadow = template.receiveShadow;
    mesh.layers.set(layer);
    mesh.name = "__batchedMerge";
    scene.add(mesh);

    for (const original of group) {
      original.visible = false;
      original.castShadow = false;
    }
    mergedCount++;
  }

  return mergedCount;
}

/** 合并多个 BufferGeometry（position + normal + uv + index） */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geometries.length) return null;

  let posCount = 0;
  let idxCount = 0;
  for (const g of geometries) {
    const pos = g.attributes.position;
    if (!pos) return null;
    posCount += pos.count;
    if (g.index) idxCount += g.index.count;
  }

  const positions = new Float32Array(posCount * 3);
  const hasNormals = geometries.every((g) => g.attributes.normal);
  const normals = hasNormals ? new Float32Array(posCount * 3) : null;
  const hasUVs = geometries.every((g) => g.attributes.uv);
  const uvs = hasUVs ? new Float32Array(posCount * 2) : null;
  const indices = idxCount > 0 ? new Uint32Array(idxCount) : null;

  let posOff = 0;
  let normOff = 0;
  let uvOff = 0;
  let idxOff = 0;
  let vertOff = 0;

  for (const g of geometries) {
    const pos = g.attributes.position;
    positions.set(pos.array as Float32Array, posOff);
    posOff += pos.count * 3;

    if (normals && g.attributes.normal) {
      const norm = g.attributes.normal;
      normals.set(norm.array as Float32Array, normOff);
      normOff += norm.count * 3;
    }
    if (uvs && g.attributes.uv) {
      const uv = g.attributes.uv;
      uvs.set(uv.array as Float32Array, uvOff);
      uvOff += uv.count * 2;
    }
    if (indices && g.index) {
      const idx = g.index;
      const arr = idx.array;
      for (let i = 0; i < idx.count; i++) {
        indices[idxOff + i] = arr[i] + vertOff;
      }
      idxOff += idx.count;
    }
    vertOff += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normals) merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  if (uvs) merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  if (indices) merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}