// ---------------------------------------------------------------------------
// @priority P0
// 批处理优化「网页运行时」冒烟（Node 直接运行，不经打包）：
// 喂真实 buildSceneTree + optimizeScene 构建链路，验证烘焙副本的世界变换正确——
//   ① 同材质同几何（实例化路径）：变换过的父节点下的网格必须按**世界**矩阵
//     烘进 InstancedMesh（回归：烘焙时场景世界矩阵未刷新，祖先变换全丢，
//     副本烘到错误位置 → 原网格又已隐藏，视觉上整组消失）；
//   ② 同材质不同几何（合并路径）：合并几何的世界包围盒含父链变换；
//   ③ 平铺场景（无父变换）实例矩阵不变；
//   ④ 不同材质各自成组 <2 → 不批处理，原网格保持可见；
//   ⑤ excludeNodeIds（脚本图引用实体）不烘焙；
//   ⑥ 父链可动（祖先被图引用/带脚本/刚体组件/导航代理/动画绑定）→ 子网格
//     不烘焙，父级被驱动移动后子网格同步跟随（回归：只查网格自身可动性，
//     可动父节点下的同材质子网格被烘焙后留在原地不跟随）。
// 运行：pnpm smoke batching-runtime
// ---------------------------------------------------------------------------
import { createSuite, runtimeURL as runtime, coreURL as core } from "../harness.mjs";

const { ok, finish } = createSuite();

const { buildSceneTree } = await import(runtime("nodes.mjs"));
const { optimizeScene } = await import(runtime("batching.mjs"));
const { MAT_DEFAULTS } = await import(runtime("material.mjs"));
const THREE = await import(core("three.module.min.js"));

// 完整材质默认值（MeshStandardMaterial 分支会把每个字段透传给 three，
// 散传字段缺省会在 Node 控制台刷 undefined 参数告警）
const matOf = (color) => ({ ...MAT_DEFAULTS, color });

const meshJson = (id, extra = {}) => ({
  type: "meshNode",
  id,
  name: id,
  source: "primitive",
  geometry: "box",
  size: { x: 1, y: 1, z: 1 },
  material: "mat-a",
  ...extra,
});

/** 模型测试模板：单网格 Group（克隆共享 geometry/material，批处理按同 key 成组） */
const mkPlainTemplate = () => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return g;
};

function entryOf(built, id) {
  return built.nodes.find((n) => n.json.id === id);
}
function worldPosOf(obj) {
  obj.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
}

console.log("[1] 实例化路径：变换过的父节点下同材质网格按世界矩阵烘焙");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      {
        type: "node",
        id: "group",
        transform: { position: { x: 100, y: 20, z: -50 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        children: [
          meshJson("a", { transform: { position: { x: 5, y: 0, z: 0 } } }),
          meshJson("b", { transform: { position: { x: -5, y: 0, z: 0 } } }),
        ],
      },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });

  const a = entryOf(built, "a").obj;
  const b = entryOf(built, "b").obj;
  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  ok(!!inst && !a.visible && !b.visible, "同材质成组 → InstancedMesh 替代、原网格隐藏");

  // 期望世界位置：父旋转 y=90° 把 ±x 映到 ∓z
  const expA = worldPosOf(a);
  const expB = worldPosOf(b);
  const m = new THREE.Matrix4();
  inst.getMatrixAt(0, m);
  const p0 = new THREE.Vector3().setFromMatrixPosition(m);
  inst.getMatrixAt(1, m);
  const p1 = new THREE.Vector3().setFromMatrixPosition(m);
  const near = (p, q) => p.distanceTo(q) < 1e-4;
  ok(
    (near(p0, expA) && near(p1, expB)) || (near(p0, expB) && near(p1, expA)),
    `实例矩阵 = 完整世界变换（期望 ${expA.toArray().map((v) => v.toFixed(1))} / ${expB.toArray().map((v) => v.toFixed(1))}）`,
  );
}

console.log("[2] 合并路径：同材质不同几何的世界包围盒含父链变换");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      {
        type: "node",
        id: "group",
        transform: { position: { x: 100, y: 20, z: -50 } },
        children: [
          meshJson("a", { geometry: "box", transform: { position: { x: 5, y: 0, z: 0 } } }),
          meshJson("b", { geometry: "sphere", size: { x: 2, y: 2, z: 2 }, transform: { position: { x: -5, y: 0, z: 0 } } }),
        ],
      },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0x00ff00)]]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });

  const merged = scene.children.find((c) => c.name === "__batchedMerge");
  ok(!!merged, "同材质不同几何 → mergeGeometries 合并");
  if (merged) {
    // 世界空间回归检查：合并几何应落在 group 偏移附近（x≈100，z≈-50）
    merged.geometry.computeBoundingBox();
    const bb = merged.geometry.boundingBox;
    ok(
      bb.min.x > 90 && bb.max.x > 100 && bb.min.z < -40 && bb.max.z < -40 + 12,
      `合并几何为世界空间（x∈[${bb.min.x.toFixed(1)},${bb.max.x.toFixed(1)}] z∈[${bb.min.z.toFixed(1)},${bb.max.z.toFixed(1)}]，期望以 (100,-50) 为中心）`,
    );
  }
}

console.log("[3] 平铺场景（无父变换）实例矩阵不变");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      meshJson("a", { transform: { position: { x: 5, y: 0, z: 0 } } }),
      meshJson("b", { transform: { position: { x: -5, y: 0, z: 0 } } }),
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });
  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  const m = new THREE.Matrix4();
  const ps = [];
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, m);
    ps.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  ok(
    inst.count === 2 && ps.some((p) => p.x === 5) && ps.some((p) => p.x === -5),
    "平铺场景实例位置 (±5,0,0) 保持",
  );
}

console.log("[4] 不同材质各自成组 <2 → 不批处理");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [meshJson("a", { material: "mat-a" }), meshJson("b", { material: "mat-b" })],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([
      ["mat-a", matOf(0xff0000)],
      ["mat-b", matOf(0x0000ff)],
    ]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });
  const a = entryOf(built, "a").obj;
  const b = entryOf(built, "b").obj;
  ok(
    a.visible && b.visible && !scene.children.some((c) => c.name.startsWith("__batched")),
    "材质不同不成组，原网格保持可见",
  );
}

console.log("[5] excludeNodeIds（脚本图引用实体）不烘焙");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [meshJson("a"), meshJson("b"), meshJson("c")],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { excludeNodeIds: ["a"], nodes: built.nodes });
  const a = entryOf(built, "a").obj;
  ok(a.visible, "被引用实体不烘焙、保持可见");
  const baked = scene.children.find((c) => c.name === "__batchedInstances");
  ok(!!baked && baked.count === 2, "其余同材质网格照常实例化");
}

console.log("[6] 图引用父节点 → 子网格不烘焙，父级移动时同步跟随");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      {
        type: "node",
        id: "carrier",
        children: [meshJson("a"), meshJson("b"), meshJson("c")],
      },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map(),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], {
    excludeNodeIds: ["carrier"], // 父节点被脚本图引用（会被图驱动移动）
    nodes: built.nodes,
  });
  const a = entryOf(built, "a").obj;
  const b = entryOf(built, "b").obj;
  ok(
    a.visible && b.visible && !scene.children.some((c) => c.name.startsWith("__batched")),
    "可动父节点下的子网格全部不烘焙、保持可见",
  );
  // 回归症状本体：父级被驱动移动后，子网格必须跟着走（留在原地 = 被烘焙了）
  const carrier = entryOf(built, "carrier").obj;
  carrier.position.set(50, 10, -20);
  carrier.updateMatrixWorld(true);
  const wp = worldPosOf(a);
  ok(
    wp.x === 50 && wp.y === 10 && wp.z === -20,
    `父级移动后子网格世界位置跟随（got ${wp.toArray().map((v) => v.toFixed(0))}）`,
  );
}

console.log("[7] 祖先带 script/rigidBody 组件或导航代理/动画绑定 → 子网格不烘焙");
{
  const mk = (extra) => ({
    type: "node",
    id: "root",
    children: [{ type: "node", id: "carrier", ...extra, children: [meshJson("a"), meshJson("b")] }],
  });
  const cases = [
    ["script 组件", mk({ components: [{ id: "s1", type: "script", enabled: true }] }), {}],
    ["rigidBody 组件", mk({ components: [{ id: "r1", type: "rigidBody", enabled: true }] }), {}],
    ["navAgentNode", mk({ type: "navAgentNode" }), {}],
    ["动画绑定", mk({}), { clips: [{ nodeId: "carrier" }] }],
  ];
  for (const [label, sceneJson, extraOpts] of cases) {
    const scene = new THREE.Scene();
    const built = buildSceneTree(sceneJson, scene, {
      materialParams: new Map([["mat-a", matOf(0xff0000)]]),
      models: new Map(),
    });
    const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
    optimizeScene(scene, meshes, extraOpts.clips ?? [], { nodes: built.nodes });
    const a = entryOf(built, "a").obj;
    ok(
      a.visible && !scene.children.some((c) => c.name.startsWith("__batched")),
      `${label}祖先 → 子网格不烘焙`,
    );
  }
}

console.log("[8] 模型实例化：同 GLB 多节点按共享几何/材质成组，不进合并");
{
  const scene = new THREE.Scene();
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const modelTemplate = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geom, mat));
    return g;
  };
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      {
        type: "node",
        id: "carrier",
        transform: { position: { x: 40, y: 0, z: 0 } },
        children: [
          { type: "meshNode", id: "f1", name: "f1", source: "model", model: "a/fence.glb", transform: { position: { x: 5, y: 0, z: 0 } } },
          { type: "meshNode", id: "f2", name: "f2", source: "model", model: "a/fence.glb", transform: { position: { x: -5, y: 0, z: 0 } } },
        ],
      },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map(),
    models: new Map([["a/fence.glb", { template: modelTemplate(), clips: [] }]]),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });

  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  const f1 = entryOf(built, "f1").obj;
  const f2 = entryOf(built, "f2").obj;
  const leafHidden = (nodeObj) => {
    let all = true;
    nodeObj.traverse((o) => {
      if (o.isMesh && o.visible) all = false;
    });
    return all;
  };
  ok(!!inst && inst.count === 2, "同 GLB 两节点 → 1 个 InstancedMesh（count=2）");
  ok(leafHidden(f1) && leafHidden(f2), "原模型叶子网格已隐藏（容器空组按设计保留）");
  ok(!scene.children.some((c) => c.name === "__batchedMerge"), "模型叶子不进几何合并");
  // 实例矩阵 = 世界变换（含 carrier 偏移 x=40 ± 叶内 5）
  const m = new THREE.Matrix4();
  const ps = [];
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, m);
    ps.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  ok(
    ps.some((p) => Math.abs(p.x - 45) < 1e-4) && ps.some((p) => Math.abs(p.x - 35) < 1e-4),
    `实例矩阵含完整父链世界变换（got x=${ps.map((p) => p.x.toFixed(1)).join("/")}）`,
  );
  // 叶子网格层级（layer 位掩码）复制到 InstancedMesh
  ok(inst.layers.mask === 1, "烘焙实例层级掩码保持");
}

console.log("[9] 模型排除路径：蒙皮/形变/多材质/透明/脚本组件/图引用 → 整节点不烘焙");
{
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mkTemplate = (kind) => {
    const g = new THREE.Group();
    if (kind === "skinned") {
      const skin = new THREE.SkinnedMesh(geom, new THREE.MeshStandardMaterial());
      const bone = new THREE.Bone();
      skin.add(bone);
      skin.bind(new THREE.Skeleton([bone]));
      g.add(skin);
    } else if (kind === "morph") {
      const m = geom.clone();
      m.morphAttributes.position = [geom.getAttribute("position").clone()];
      g.add(new THREE.Mesh(m, new THREE.MeshStandardMaterial()));
    } else if (kind === "multimat") {
      g.add(new THREE.Mesh(geom, [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]));
    } else if (kind === "transparent") {
      g.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 })));
    } else {
      g.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial()));
    }
    return g;
  };
  const rels = { skinned: "m/skin.glb", morph: "m/morph.glb", multimat: "m/mm.glb", transparent: "m/t.glb" };
  const models = new Map(Object.entries(rels).map(([k, rel]) => [rel, { template: mkTemplate(k), clips: [] }]));
  const cases = [
    ["蒙皮叶子", "s1", rels.skinned, {}],
    ["形变目标叶子", "s2", rels.morph, {}],
    ["多材质叶子", "s3", rels.multimat, {}],
    ["透明叶子", "s4", rels.transparent, {}],
    ["节点带 script 组件", "s5", rels.skinned, { components: [{ id: "sc", type: "script", enabled: true }] }],
  ];
  for (const [label, id, rel, extra] of cases) {
    const scene = new THREE.Scene();
    const sceneJson = {
      type: "node",
      id: "root",
      children: [
        { type: "meshNode", id, name: id, source: "model", model: rel, ...extra },
        { type: "meshNode", id: `${id}-ok`, name: `${id}-ok`, source: "model", model: "a/fence.glb" },
        { type: "meshNode", id: `${id}-ok2`, name: `${id}-ok2`, source: "model", model: "a/fence.glb" },
      ],
    };
    const modelsWithFence = (() => {
      const m = new Map(models);
      m.set("a/fence.glb", { template: mkTemplate("plain"), clips: [] });
      return m;
    })();
    const built = buildSceneTree(sceneJson, scene, {
      materialParams: new Map(),
      models: modelsWithFence,
    });
    const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
    optimizeScene(scene, meshes, [], { nodes: built.nodes });
    const target = entryOf(built, id).obj;
    const leafVisible = (() => {
      let v = false;
      target.traverse((o) => {
        if (o.isMesh && o.visible) v = true;
      });
      return v;
    })();
    ok(leafVisible, `${label} → 模型保持可见（未烘焙）`);
    // 同场景里合格的 fence 两节点照常实例化（阴性对照）
    const inst = scene.children.find((c) => c.name === "__batchedInstances");
    ok(!!inst && inst.count === 2, `${label} → 合格模型照常成组（对照）`);
  }
  // 图引用排除：excludeNodeIds 命中模型节点
  {
    const scene = new THREE.Scene();
    const sceneJson = {
      type: "node",
      id: "root",
      children: [
        { type: "meshNode", id: "g1", name: "g1", source: "model", model: "a/fence.glb" },
        { type: "meshNode", id: "g2", name: "g2", source: "model", model: "a/fence.glb" },
        { type: "meshNode", id: "g3", name: "g3", source: "model", model: "a/fence.glb" },
      ],
    };
    const models2 = new Map([["a/fence.glb", { template: mkTemplate("plain"), clips: [] }]]);
    const built = buildSceneTree(sceneJson, scene, { materialParams: new Map(), models: models2 });
    const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
    optimizeScene(scene, meshes, [], { excludeNodeIds: ["g1"], nodes: built.nodes });
    const g1 = entryOf(built, "g1").obj;
    let v1 = false;
    g1.traverse((o) => {
      if (o.isMesh && o.visible) v1 = true;
    });
    ok(v1, "图引用模型节点保持可见");
    const inst = scene.children.find((c) => c.name === "__batchedInstances");
    ok(!!inst && inst.count === 2, "其余同 GLB 节点照常实例化（count=2）");
  }
}

console.log("[10] instancing=false + batching=true：模型不被合并，基元照常合并");
{
  const scene = new THREE.Scene();
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      { type: "meshNode", id: "m1", name: "m1", source: "model", model: "a/fence.glb" },
      { type: "meshNode", id: "m2", name: "m2", source: "model", model: "a/fence.glb" },
      meshJson("p1", { geometry: "box" }),
      meshJson("p2", { geometry: "sphere", size: { x: 1, y: 1, z: 1 } }),
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map([["a/fence.glb", { template: (() => { const g = new THREE.Group(); g.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial())); return g; })(), clips: [] }]]),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { instancing: false, batching: true, nodes: built.nodes });
  const m1 = entryOf(built, "m1").obj;
  let leafVisible = false;
  m1.traverse((o) => {
    if (o.isMesh && o.visible) leafVisible = true;
  });
  ok(leafVisible, "合并路径不吞模型叶子（原模型可见）");
  ok(!scene.children.some((c) => c.name === "__batchedInstances"), "实例化关闭 → 无实例网格");
  ok(!!scene.children.find((c) => c.name === "__batchedMerge"), "基元照常合并");
}

console.log("[11] runtimeDynamic 标记：整节点豁免烘焙（模型 + 基元）");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      { type: "meshNode", id: "d1", name: "d1", source: "model", model: "a/fence.glb", runtimeDynamic: true },
      { type: "meshNode", id: "d2", name: "d2", source: "model", model: "a/fence.glb" },
      { type: "meshNode", id: "d3", name: "d3", source: "model", model: "a/fence.glb" },
      meshJson("p1", { runtimeDynamic: true }),
      meshJson("p2"),
      meshJson("p3"),
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map([["mat-a", matOf(0xff0000)]]),
    models: new Map([["a/fence.glb", { template: mkPlainTemplate(), clips: [] }]]),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });

  const d1 = entryOf(built, "d1").obj;
  let d1Visible = false;
  d1.traverse((o) => {
    if (o.isMesh && o.visible) d1Visible = true;
  });
  ok(d1Visible, "标记运行期动态的模型保持原样（未烘焙）");
  ok(d1.userData.batchBinding === undefined, "运行期动态节点不挂烘焙绑定");
  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  ok(!!inst && inst.count === 2, "其余同 GLB 节点照常成组（count=2）");
  const p1 = entryOf(built, "p1").obj;
  ok(p1.visible && p1.userData.batchBinding === undefined, "标记运行期动态的基元保持原样");
  const pInst = scene.children.filter((c) => c.name === "__batchedInstances");
  ok(pInst.length === 2, "基元组与模型组各自实例化（两组）");
}

console.log("[12] 烘焙绑定：脚本移动烘焙节点 → 下一帧实例矩阵跟随");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      { type: "meshNode", id: "b1", name: "b1", source: "model", model: "a/fence.glb" },
      { type: "meshNode", id: "b2", name: "b2", source: "model", model: "a/fence.glb" },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map(),
    models: new Map([["a/fence.glb", { template: mkPlainTemplate(), clips: [] }]]),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });
  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  const b1 = entryOf(built, "b1").obj;
  ok(!!b1.userData.batchBinding, "烘焙节点挂 batchBinding");

  // 模拟脚本驱动：写位姿 + 渲染器帧矩阵刷新（updateMatrixWorld 递归触发同步）
  b1.position.set(50, 10, -20);
  scene.updateMatrixWorld();
  const m = new THREE.Matrix4();
  const readPos = (idx) => {
    inst.getMatrixAt(idx, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const ps = [readPos(0), readPos(1)];
  ok(
    ps.some((p) => Math.abs(p.x - 50) < 1e-4 && Math.abs(p.y - 10) < 1e-4),
    `实例矩阵跟随脚本位移（got ${ps.map((p) => `${p.x},${p.y},${p.z}`).join(" | ")}）`,
  );
  // 未动的另一节点保持原位
  ok(ps.some((p) => p.x === 0 && p.y === 0 && p.z === 0), "未驱动的兄弟节点保持烘焙位姿");
}

console.log("[13] 烘焙绑定：可见性收拢（隐藏 = 零缩放退化点，恢复 = 还原世界矩阵）");
{
  const scene = new THREE.Scene();
  const sceneJson = {
    type: "node",
    id: "root",
    children: [
      { type: "meshNode", id: "v1", name: "v1", source: "model", model: "a/fence.glb", transform: { position: { x: 5, y: 0, z: 0 } } },
      { type: "meshNode", id: "v2", name: "v2", source: "model", model: "a/fence.glb", transform: { position: { x: -5, y: 0, z: 0 } } },
    ],
  };
  const built = buildSceneTree(sceneJson, scene, {
    materialParams: new Map(),
    models: new Map([["a/fence.glb", { template: mkPlainTemplate(), clips: [] }]]),
  });
  const meshes = built.nodes.filter((n) => n.json.type === "meshNode");
  optimizeScene(scene, meshes, [], { nodes: built.nodes });
  const inst = scene.children.find((c) => c.name === "__batchedInstances");
  const v1 = entryOf(built, "v1").obj;
  const binding = v1.userData.batchBinding;
  scene.updateMatrixWorld();

  // 零缩放矩阵是奇异矩阵，decompose 数值不稳；直接测列向量长度（正常=1，隐藏=0）
  const scaleAt = (idx) => {
    const m = new THREE.Matrix4();
    inst.getMatrixAt(idx, m);
    const e = m.elements;
    return Math.hypot(e[0], e[1], e[2]);
  };
  // v1 的实例下标：叶子矩阵 x=5 的那个
  const idxOf = (x) => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.abs(p.x - x) < 1e-4) return i;
    }
    return -1;
  };
  const i1 = idxOf(5);
  ok(i1 >= 0, "找到 v1 对应实例下标");

  binding.setVisible(false);
  ok(binding.visible === false, "隐藏后绑定可见态翻转");
  ok(scaleAt(i1) === 0, "隐藏 = 实例零缩放（退化点不产生片元）");

  binding.setVisible(true);
  scene.updateMatrixWorld();
  ok(binding.visible === true && Math.abs(scaleAt(i1) - 1) < 1e-4, "恢复显示 = 实例矩阵还原");
}

finish();
