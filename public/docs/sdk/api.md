<!-- 由 scripts/gen-api-docs.mjs 自动生成，来源 src/framework/scripting/tve.d.ts，请勿手改。 -->

# tve SDK API 参考

<!-- 生成物说明：本页是类型契约的全量参考；入门与专题讲解见 SDK 总览等手写文档。 -->
<!-- 声明级示例来自 scripts/api-docs/examples/（ts tve 标记块随 pnpm docs:test 验证）。 -->

> tve —— 引擎脚本 SDK 类型契约（模块说明符 "tve"）
> 用户脚本以 `import { Component, property, nodeType, engine } from "tve"`
> 访问引擎能力。本文件是脚本类型的唯一事实源：编辑器（Monaco 智能提示 /
> 诊断）直接加载本文件，运行时实现在 public/engine/core/tve.mjs
> （播放器侧；两者保持镜像同步）。
> 对外 API 参考文档 public/docs/sdk/api.md 由本文件自动生成
> （pnpm gen:api-docs），改 API 后重跑即可，文档本身不要手改。
> 
> 设计约束：全部为引擎自有类型（Vec3 普通对象、度制欧拉角，与编辑器数据模型
> 一致），不暴露任何 three.js / WebGL 接口。

## 基础类型

### interface Vec3

三维向量（引擎自有类型；旋转型 Vec3 使用"度"为单位）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |

### PropType

```ts
type PropType = "number" | "string" | "boolean" | "color" | "vec3";
```

组件属性类型（检查器按此渲染编辑控件；也可由字段初值/类型推断）

### EntityKind

```ts
type EntityKind =
  | "node"
  | "meshNode"
  | "cameraNode"
  | "lightNode"
  | "pointLightNode"
  | "directionalLightNode"
  | "ambientLightNode"
  | "spotLightNode"
  | "skyboxNode"
  | "fogNode"
  | "audioNode"
  | "particleSystemNode"
  | "terrainNode"
  | "fsmRunnerNode"
  | "btRunnerNode"
  | "uiCanvasNode"
  | "uiImageNode"
  | "uiTextNode"
  | "uiButtonNode"
  | "uiLayoutNode";
```

场景节点类型键（与编辑器节点序列化的 type 字段一致）。
脚本节点引用属性（type 用节点类）按此过滤候选场景节点。

### NodeClass

```ts
type NodeClass =
  | typeof Transform
  | typeof MeshNode
  | typeof LightNode
  | typeof CameraNode
  | typeof SkyboxNode
  | typeof FogNode
  | typeof ParticleSystemNode
  | typeof TerrainNode
  | typeof FsmRunnerNode
  | typeof BtRunnerNode
  | typeof UICanvasNode
  | typeof UIImageNode
  | typeof UITextNode
  | typeof UIButtonNode
  | typeof UILayoutNode;
```

节点类型 token 类的构造器形状（@property 的 type 选项可用）

### ComponentClass

```ts
type ComponentClass =
  | typeof RigidBody
  | typeof Collider
  | typeof Light
  | typeof AudioSource
  | typeof AnimationClip
  | typeof SkeletalAnimation;
```

内置组件门面类（@property 组件引用字段 / getComponent / addComponent 可用）

### interface PropDef

单个组件属性的定义（运行时组件声明用；编辑器侧另有同名 AST 结构）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `PropType \| string` |  |
| `default` | `number \| string \| boolean \| Vec3` |  |
| `label?` | `string` |  |
| `min?` | `number` |  |
| `max?` | `number` |  |
| `step?` | `number` |  |

### ScriptNodeKind

```ts
type ScriptNodeKind =
  | "node"
  | "meshNode"
  | "cameraNode"
  | "lightNode"
  | "skyboxNode"
  | "fogNode"
  | "particleSystemNode"
  | "terrainNode"
  | "uiCanvasNode"
  | "uiImageNode"
  | "uiTextNode"
  | "uiButtonNode"
  | "uiLayoutNode";
```

脚本声明的可创建节点类型基础（对应编辑器节点类型键）

## 装饰器（@property / @nodeType 声明式写法）

### property()

```ts
property(options?: {
  /**
   * 值类型。基本类型：number/string/boolean/color/vec3（缺省按字段初值推断）；
   * 或节点类型类：把该属性声明为场景节点引用（检查器选择场景节点，
   * 运行期字段为该节点的 Entity）；
   * 或内置组件门面类：把该属性声明为组件引用（运行期 get-or-create 绑定门面）。
   */
  type?: PropType | NodeClass | ComponentClass;
  /** 检查器显示名（缺省用字段名） */
  label?: string;
  /** 悬浮说明（显示在控件标题） */
  tooltip?: string;
  /** number 专用：最小值 / 最大值 / 步进 */
  min?: number;
  max?: number;
  step?: number;
}): PropertyDecorator
```

属性装饰器：把成员字段声明为脚本组件的可编辑属性（检查器自动按字段类型
渲染控件；字段初值即默认值；运行期直接以 `this.字段名` 读写）。

类型由字段初值推断：number / boolean / string；颜色字符串（#rrggbb 等）与
{x,y,z} 向量对象需显式传 type 或声明对应类型。

**场景节点引用**：type 传节点类型类（Transform / MeshNode / LightNode /
CameraNode / SkyboxNode / ParticleSystemNode / FsmRunnerNode / BtRunnerNode，
或用小写别名 meshNode 等）即声明"引用一个场景节点"。
检查器按类型过滤列出可选的场景节点，选择结果在运行期解析为该节点的 Entity
（未选择为 null）：

```ts tve
import { Component, property, MeshNode } from "tve";

export default class Game extends Component {
  @property({ type: MeshNode, label: "目标网格" })
  target: MeshNode | null = null;   // 运行期指向被引用的网格节点

  onUpdate(delta: number) {
    if (this.target) this.target.rotate(0, 90 * delta, 0);
  }
}
```

**内置组件引用**：type 传内置组件门面类（AnimationClip / SkeletalAnimation /
RigidBody / Collider / Light / AudioSource），或直接以组件类作装饰器实参
（`@property(AnimationClip)`），即声明"引用一个内置组件"。该字段不出现在
检查器中；运行期宿主在本实体上 get-or-create 对应组件并把门面绑定到字段：

```ts tve
import { Component, property, AnimationClip } from "tve";

export default class Punch extends Component {
  @property(AnimationClip)
  anim!: AnimationClip;            // 运行期 = 实体上的关键帧动画剪辑组件

  onStart() {
    this.anim.speed = 2;
    this.anim.play();
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

三种属性写法（推荐字段 + `@property` 装饰器）：

```ts tve
import { Component, property, MeshNode, AnimationClip, engine } from "tve";

export default class Demo extends Component {
  // 1. 基本类型：类型由字段初值推断（number/boolean/string）
  @property({ label: "速度", min: 0, max: 100, step: 1, tooltip: "度/秒" })
  speed = 90;
  @property({ label: "无敌" })
  invincible = false;

  // 2. 特殊值类型：颜色（#rrggbb 字符串）与向量需显式传 type
  @property({ type: "color", label: "受击闪色" })
  hitColor = "#ff3020";
  @property({ type: "vec3", label: "出生点" })
  spawnPoint = { x: 0, y: 1, z: 0 };

  // 3a. 场景节点引用：type 传节点类型类，检查器按类型过滤可选节点
  @property({ type: MeshNode, label: "目标网格" })
  target: MeshNode | null = null;

  // 3b. 内置组件引用：装饰器实参直接传组件类，运行期 get-or-create 绑定门面
  @property(AnimationClip)
  anim!: AnimationClip;

  onUpdate(delta: number) {
    if (this.target) this.target.rotate(0, this.speed * delta, 0);
    engine.log("速度", this.speed, "无敌", this.invincible);
  }
}
```

### property()

```ts
property(component: ComponentClass): PropertyDecorator
```

组件引用速记重载：装饰器实参直接传内置组件门面类（等价
`@property({ type: AnimationClip })`）——声明组件引用字段，不出现在检查器，
运行期宿主 get-or-create 绑定门面。

**示例**（doctest：随文档测试套件逐块验证）

三种属性写法（推荐字段 + `@property` 装饰器）：

```ts tve
import { Component, property, MeshNode, AnimationClip, engine } from "tve";

export default class Demo extends Component {
  // 1. 基本类型：类型由字段初值推断（number/boolean/string）
  @property({ label: "速度", min: 0, max: 100, step: 1, tooltip: "度/秒" })
  speed = 90;
  @property({ label: "无敌" })
  invincible = false;

  // 2. 特殊值类型：颜色（#rrggbb 字符串）与向量需显式传 type
  @property({ type: "color", label: "受击闪色" })
  hitColor = "#ff3020";
  @property({ type: "vec3", label: "出生点" })
  spawnPoint = { x: 0, y: 1, z: 0 };

  // 3a. 场景节点引用：type 传节点类型类，检查器按类型过滤可选节点
  @property({ type: MeshNode, label: "目标网格" })
  target: MeshNode | null = null;

  // 3b. 内置组件引用：装饰器实参直接传组件类，运行期 get-or-create 绑定门面
  @property(AnimationClip)
  anim!: AnimationClip;

  onUpdate(delta: number) {
    if (this.target) this.target.rotate(0, this.speed * delta, 0);
    engine.log("速度", this.speed, "无敌", this.invincible);
  }
}
```

### nodeType()

```ts
nodeType(options?: {
  kind?: ScriptNodeKind;
  label?: string;
}): ClassDecorator
```

节点类型装饰器（类装饰器，可选）：声明脚本类同时作为一种可创建的节点类型，
出现在层级面板「添加节点 > 脚本节点」；创建时生成 kind 对应的基础节点并自动
挂上本脚本组件（以脚本定义节点行为）。

```ts tve
import { Component, nodeType } from "tve";

@nodeType({ kind: "meshNode", label: "敌人" })
export default class Enemy extends Component {
  // ...
}
```
kind 缺省 node（空组）；label 缺省取类名。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, nodeType, property } from "tve";

// 类装饰器：声明脚本类同时成为一种可创建节点类型（层级面板「添加节点 > 脚本节点」）
// kind = 生成的基础节点类型；label = 菜单显示名（缺省取类名）
@nodeType({ kind: "meshNode", label: "敌人" })
export default class Enemy extends Component {
  @property({ label: "生命值", min: 1 })
  hp = 100;

  @property({ label: "移动速度", min: 0 })
  speed = 2;
}
```

kind 缺省为 `"node"`（空组基础节点）：

```ts tve
import { Component, nodeType, property } from "tve";

@nodeType({ label: "旋转体" })
export default class Spin extends Component {
  @property({ min: 0 })
  speed = 90;

  onUpdate(delta: number) {
    this.entity.rotate(0, this.speed * delta, 0);
  }
}
```

## 组件 / 实体

### ComponentProps

```ts
type ComponentProps = Record<string, unknown>;
```

组件属性值集合（供声明式引用；装饰器字段写法无需本类型）

### GraphInputValue

```ts
type GraphInputValue = Entity | Entity[] | number | boolean | string | Vec3 | null;
```

场景图接入口传入值（原型卡「接入」口 → 本实体上的脚本组件）：
实体（集）为 Entity/Entity[]，数据为标量/向量；未接入或上游为空为 null。

### interface ComponentLifecycle

组件生命周期回调契约（Component 基类的钩子接口；全部可选，按需实现）。
调度方为播放器脚本宿主（engine/core/scripts.mjs）：
全部实例化后先统一 onEnable 再统一 onStart；
每帧先按固定步长驱动 onFixedUpdate，再分派物理碰撞回调并调 onUpdate；
全部模拟（脚本/动画/物理/粒子）更新后、渲染前驱动 onLateUpdate；
停机时逐实例 onDisable → onDestroy。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, engine, Entity, MeshNode, property, Vec3 } from "tve";

// 全部钩子可选、按需实现；onEnable 全体先于 onStart 全体
export default class Lifecycle extends Component {
  @property({ type: MeshNode, label: "目标" })
  target: MeshNode | null = null;

  onEnable() {
    // 实例创建后：可安全引用其他实体与组件
    engine.log("enabled on", this.entity.name);
  }

  onStart() {
    // 全部实例创建后、首个 onUpdate 前，一次性初始化
  }

  onGraphInput(value: MeshNode[] | number | Vec3 | null) {
    // 场景图接入口收到新值（值变化边沿触发）；同值可随时读 this.graphInput
  }

  onFixedUpdate(fixedDelta: number) {
    // 固定步长 1/60s（与物理同频；掉帧补偿 0..4 次）——施力/速度写这里
  }

  onUpdate(delta: number) {
    // 每帧（渲染帧率）
  }

  onLateUpdate(delta: number) {
    // 全部模拟（脚本/动画/物理/粒子）后、相机回填与渲染前——相机跟随写这里
  }

  onCollisionEnter(other: Entity) {
    // 碰撞开始（须挂碰撞体 + 项目启用物理；传感器同样触发）
    engine.log("hit", other.name);
  }

  onCollisionExit(other: Entity) {
    // 接触断开
  }

  onDisable() {
    // 停机：释放定时器/事件订阅（先于 onDestroy）
  }

  onDestroy() {
    // 实例销毁
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `onEnable()` | `void` | 生命周期：实例创建后调用（全部实例的 onEnable 先于全部 onStart）；此时可安全引用其他实体与组件。 |
| `onStart()` | `void` | 生命周期：全部脚本实例创建后、首个 onUpdate 前调用一次（初始化玩法逻辑） |
| `onGraphInput(value: GraphInputValue)` | `void` | 场景图接入口：本实体原型卡片的「接入」口收到新值时调用（值变化边沿触发； 装配期收到初值即回调一次）。value 与 this.graphInput 同源；实体集为 Entity[]，数据为标量/向量。仅场景图模式（预览/导出注入 script-graph.json） 且接入口接线时触发。 |
| `onUpdate(delta: number)` | `void` | 生命周期：每帧调用（delta = 距上一帧的秒数） |
| `onFixedUpdate(fixedDelta: number)` | `void` | 生命周期：固定步长更新，每 1/60 秒一次（与物理步进同频；fixedDelta = 固定 步长秒数）。帧率无关：一次渲染帧内可能不调用或连续调用多次（掉帧补偿， 上限 4 次）。适合与物理相关的确定性逻辑（施力/速度控制）；调用先于同帧的 onUpdate 与物理步进。 |
| `onLateUpdate(delta: number)` | `void` | 生命周期：晚更新，每帧一次。在全部脚本/动画/物理/粒子更新完成后、相机 位姿回填与渲染前调用（delta = 距上一帧的秒数）——需要覆盖本帧一切位姿 写入的逻辑（相机跟随、HUD 对齐等）放这里。 |
| `onCollisionEnter(other: Entity)` | `void` | 物理碰撞开始（本节点碰撞体与 other 的碰撞体开始接触；在 onUpdate 前调用）。 需要：本节点挂碰撞体组件 + 项目设置启用物理。传感器（isSensor）同样触发。 |
| `onCollisionExit(other: Entity)` | `void` | 物理碰撞结束（与 other 的接触断开；参数为对方实体） |
| `onDisable()` | `void` | 生命周期：页面卸载/预览停机时调用一次（先于 onDestroy），用于释放 定时器/事件订阅等外部资源。 |
| `onDestroy()` | `void` | 生命周期：实例销毁时调用（页面卸载/预览停机时先于本回调触发 onDisable） |

### class Component<P extends ComponentProps = ComponentProps> implements ComponentLifecycle

脚本组件基类（装饰器声明式写法，推荐）：

```ts tve
import { Component, nodeType, property, engine } from "tve";

@nodeType({ kind: "node", label: "旋转体" })
export default class Spin extends Component {
  @property({ label: "速度", min: 0 })
  speed = 90;

  onStart() {
    engine.log("挂载于", this.entity.name);
  }

  onUpdate(delta: number) {
    this.entity.rotate(0, this.speed * delta, 0); // this.speed 类型为 number
  }
}
```

生命周期：onStart 挂载后调用一次；onUpdate 每帧调用（delta = 秒）；
onFixedUpdate 固定步长调用（1/60s，与物理同频）；onLateUpdate 在全部模拟
更新后、渲染前调用。
运行时 `this` 上还提供一个只读属性值视图 `this.props`（装饰器字段的
当前值 + 检查器配置的覆盖值），便于以字典方式遍历。

**组件字段**：字段声明为内置组件门面类型（`anim!: AnimationClip;` 或
`@property(AnimationClip) anim: AnimationClip | null = null;`）时，运行期宿主
自动在本实体上 get-or-create 对应组件并把门面绑定到字段——无需手写
getComponent。裸声明须带确定类型标注（`!` 断言或 `| null = null` 初值，
strict 模式下无初值字段需要其中一种写法）。

字段类型为**用户脚本类**时（配合 `import type` 只引入类型，不产生运行时
import 依赖），宿主同样 get-or-create：实体已挂载该脚本组件则绑定实例，
没有则动态创建并立即进入生命周期（按需自动挂载依赖组件）：

```ts tve
import { Component, math } from "tve";

// 跨脚本文件时用 import type 只引类型（编译期擦除）；下例同文件演示
class CameraFollow extends Component {
  offset = math.v3(0, 0, 0);
}

export default class Enemy extends Component {
  follow!: CameraFollow;   // 自动绑定/创建本实体上的 CameraFollow 组件

  onStart() {
    this.follow.offset = math.v3(0, 3, 5);
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, engine, MeshNode, AnimationClip } from "tve";

export default class Full extends Component {
  // 装饰器字段：初值即默认值与类型推断来源；检查器配置的覆盖值运行期生效
  @property({ label: "速度", min: 0 })
  speed = 90;

  // 组件字段（裸声明须带确定类型标注）：运行期宿主 get-or-create 并绑定门面
  anim!: AnimationClip;

  @property({ type: MeshNode, label: "目标" })
  target: MeshNode | null = null;

  // 只读视图：装饰器字段当前值 + 检查器覆盖值（不要写入）
  // this.props.speed 与 this.speed 同源

  onStart() {
    // 一次性初始化（全部实例的 onEnable 先于全部 onStart）
    this.anim.speed = 2;
    this.anim.play();
    engine.log("挂载于", this.entity.name);
  }

  onUpdate(delta: number) {
    // 每帧逻辑；this.speed 类型为 number
    if (this.target) this.entity.rotate(0, this.speed * delta, 0);
  }

  onDestroy() {
    // 释放定时器/事件订阅等外部资源
  }
}
```

#### `props?: { [key: string]: PropDef }`

@deprecated 推荐使用字段 + @property 装饰器声明属性。此静态声明仍受支持：
声明后检查器按此渲染编辑控件，未在节点上配置的属性取 default，
运行期经 `this.props` 读取（此时用泛型 P 声明 this.props 的类型）。

#### `constructor(entity: Entity)`

@internal 由运行时构造（挂载到节点时创建实例），脚本不要直接 new。

#### `entity: Entity`

宿主实体（挂载所在节点）

#### `props: Readonly<P>`

属性值视图（只读）：字段装饰器字段的当前值，叠加检查器配置的覆盖值；
兼容旧静态 props 声明的脚本。不要在本视图写入。

#### `graphInput: GraphInputValue`

场景图接入口的最新值（只读轮询；与 onGraphInput 的 value 同源）：
原型卡「接入」口接入实体集 → Entity[]，接入数据 → 标量/向量，
未接线/上游为空 → null。仅场景图模式下由宿主写入。

#### `onEnable(): void`

生命周期：实例创建后调用（全部实例的 onEnable 先于全部 onStart）

#### `onStart(): void`

生命周期：全部脚本实例创建后、首个 onUpdate 前调用一次（初始化玩法逻辑）

#### `onUpdate(delta: number): void`

生命周期：每帧调用（delta = 距上一帧的秒数）

#### `onFixedUpdate(fixedDelta: number): void`

生命周期：固定步长更新，每 1/60 秒一次（与物理步进同频；fixedDelta = 固定
步长秒数）。一次渲染帧内可能不调用或连续调用多次（掉帧补偿，上限 4 次）；
调用先于同帧的 onUpdate 与物理步进。

#### `onLateUpdate(delta: number): void`

生命周期：每帧一次，全部脚本/动画/物理/粒子更新后、渲染前调用（相机跟随等）

#### `onCollisionEnter(other: Entity): void`

物理碰撞开始（本节点碰撞体与 other 的碰撞体开始接触；在 onUpdate 前调用）

#### `onCollisionExit(other: Entity): void`

物理碰撞结束（与 other 的接触断开；参数为对方实体）

#### `onDisable(): void`

生命周期：页面卸载/预览停机时调用一次（先于 onDestroy），用于释放外部资源

#### `onDestroy(): void`

生命周期：实例销毁时调用（先于本回调触发 onDisable）

### class Entity

场景实体（节点在脚本运行期的句柄；变换与编辑器同一套语义，旋转为度制欧拉角）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, math, MeshNode, Entity } from "tve";

export default class EntityDemo extends Component {
  @property({ type: MeshNode, label: "目标" })
  target: MeshNode | null = null;

  onStart() {
    const e = this.entity;
    // 标识（只读）：id 与场景文件一致；name 可写即时生效
    e.id;     // 节点 id（string）
    e.kind;   // 类型键："node"/"meshNode"/"pointLightNode"…
    e.name = "玩家";

    // 变换（读取返回快照副本；写入接受部分字段）
    e.position = { y: 1 };              // 只改 y
    const p = e.position;               // 快照：改 p 不影响实体
    p.x += 100;
    e.position.x;                       // 仍是写入时的 x
    e.rotation = { x: 0, y: 45, z: 0 }; // 度制欧拉角 XYZ
    e.scale = { x: 2 };

    // 世界位置（只读快照）
    e.worldPosition;

    // 增量变换
    e.translate(0, 0, -1);   // 沿本地轴平移
    e.rotate(0, 90, 0);      // 本地旋转叠加（度）
    e.lookAt({ x: 0, y: 0, z: 0 }); // 朝向世界目标（前向 = -Z）

    // 层级
    e.parent;   // 父实体（根节点 null）
    e.children; // 子实体列表（快照）
    const child = e.find("炮塔");        // 子树内按名/路径查找（"父/子/孙"）
    void child;

    // 可见性 / 渲染层
    e.visible = true;
    e.layer = 0; // 0~31

    void p;
  }

  onUpdate() {
    if (!this.target) return;
    // 组件访问：内置门面类 / 类型键字符串 / 脚本类名
    const rigid = this.entity.getComponent("rigidBody");
    void rigid;
    const other = this.target as Entity;
    void other;
    // math 配合实体做方向计算
    const dir = math.normalize(math.sub(this.target.position, this.entity.position));
    void dir;
  }
}
```

`addComponent` 动态挂组件（预览运行态生效，不回写场景文件）：

```ts tve
import { Component, Light, AudioSource, engine } from "tve";

export default class AddComp extends Component {
  onStart() {
    // 追加灯光（多实例；settings 缺省项回默认）
    const light = this.entity.addComponent(Light, {
      kind: "point",
      color: 0xffaa33,
      intensity: 2,
      distance: 10,
    });
    light!.intensity = 3; // 返回门面，写入即时生效

    // 追加音源并播放
    const audio = this.entity.addComponent(AudioSource, { source: "assets/hit.ogg", volume: 0.8 });
    audio!.play();

    // 挂脚本组件（按类名/源路径）
    const hp = this.entity.addComponent("HPBar", { hp: 100 });
    engine.log("挂上了", !!hp);

    // RigidBody/Collider 仅启动期按场景数据构建，运行时创建返回 null
    void this.entity.addComponent("rigidBody"); // null：物理组件不可运行时创建
  }
}
```

#### `constructor()`

@internal 由运行时构造

#### `id: string`

节点 id（与场景文件中的节点 id 一致）

#### `kind: EntityKind`

节点类型键（与场景序列化的 type 字段一致：node/meshNode/pointLightNode…）

#### `get name(): string`

名称（可写，即时生效）

#### `set name(value: string)`

#### `tag: string`

节点标签（检查器 Node 卡设置，空串 = 无标签）

#### `get layer(): number`

渲染层级索引（0~31；可写，应用到对象子树的渲染层）

#### `set layer(value: number)`

#### `get visible(): boolean`

可见性（可写，即时生效；含子级继承）

#### `set visible(value: boolean)`

#### `get position(): Vec3`

本地位置（读取返回快照副本；写入接受部分字段——缺省分量保持不变）

#### `set position(value: Partial<Vec3>)`

#### `get rotation(): Vec3`

本地旋转（度制欧拉角 XYZ；读取返回快照副本；写入接受部分字段）

#### `set rotation(value: Partial<Vec3>)`

#### `get scale(): Vec3`

本地缩放（读取返回快照副本；写入接受部分字段）

#### `set scale(value: Partial<Vec3>)`

#### `get worldPosition(): Vec3`

世界位置（只读快照）

#### `get parent(): Entity | null`

父实体（根节点返回 null）

#### `get children(): Entity[]`

子实体列表（快照）

#### `translate(x: number, y: number, z: number): void`

沿本地轴平移：position += (x, y, z)

#### `rotate(xDeg: number, yDeg: number, zDeg: number): void`

本地旋转叠加（度）：rotation += (x, y, z)

#### `lookAt(target: Vec3): void`

朝向世界坐标目标（前向 = -Z，与灯光/相机朝向约定一致）

#### `find(nameOrPath: string): Entity | null`

在本实体子树内查找：支持名称路径（"父/子/孙"）或单名称深度优先匹配。
未找到返回 null。

#### `getComponent(component: "rigidBody" \| typeof RigidBody): RigidBody | null`

获取实体上挂载的组件（未挂载返回 null）。
- 内置组件：传门面类（RigidBody/Light/AudioSource/AnimationClip/
  SkeletalAnimation/Collider）或类型键字符串（"rigidBody" 等；"animation"/
  "anim" 为骨骼动画别名）。多实例组件（如多个动画剪辑组件）取首个，句柄稳定；
- 脚本组件：传脚本类（构造器）按类匹配；或传脚本源路径 / 类名字符串
  （"src/hp.ts" / "HPBar"）——按类型名查找：所有脚本类在加载后
  全局可见，脚本之间互相引用组件无需 import（严格模式下用
  `import type` 只引入类型即可获得智能提示）。
- 注意：节点句柄类（LightNode/MeshNode/CameraNode/Transform 等，均
  extends Entity）是场景节点而非组件，不能传给 getComponent；灯光属性
  用 `getComponent(Light)`，引用节点本身用 `@property({ type: LightNode })`
  或 `engine.scene.find("name")` 后以 `instanceof LightNode` 收窄。

#### `getComponent(component: "collider" \| typeof Collider): Collider | null`

#### `getComponent(component: "light" \| typeof Light): Light | null`

#### `getComponent(component: "audioSource" \| typeof AudioSource): AudioSource | null`

#### `getComponent(component: "animationClip" \| typeof AnimationClip): AnimationClip | null`

#### `getComponent(component: "animation" \| "anim" \| "skeletalAnimation" \| typeof SkeletalAnimation): SkeletalAnimation | null`

#### `getComponent(component: string): Component | null`

按脚本源路径 / 脚本类名获取已挂载的脚本组件（未挂载返回 null）

#### `getComponent(componentClass: new (...args: never[]) => T): T | null`

#### `addComponent(component: "light" \| typeof Light, settings?: LightAddOptions): Light | null`

动态添加组件并返回实例/门面（预览运行态生效，不回写场景文件）。
- 内置组件 Light / AudioSource / AnimationClip：在本节点追加一个新组件
  （多实例）；settings 为组件设置对象（缺省项回默认）；
- 内置组件 SkeletalAnimation：仅模型网格节点可用；settings 可含 clip/
  autoplay/speed/loop/graph（graph 为动画图定义，传即创建动画图模式）；
- 脚本组件：传脚本类（构造器）或脚本源路径 / 类名字符串，在本实体上
  实例化并立即进入生命周期（onEnable/onStart），props 作为属性配置；
- RigidBody / Collider：物理组件仅启动期按场景数据构建，运行时创建返回 null。

#### `addComponent(component: "audioSource" \| typeof AudioSource, settings?: AudioSourceAddOptions): AudioSource | null`

#### `addComponent(component: "animationClip" \| typeof AnimationClip, settings?: AnimationClipAddOptions): AnimationClip | null`

#### `addComponent(component: "animation" \| "skeletalAnimation" \| typeof SkeletalAnimation, settings?: SkeletalAnimationAddOptions): SkeletalAnimation | null`

#### `addComponent(component: string \| (new (entity: Entity) => Component), props?: ComponentProps): Component | null`

动态创建脚本组件（按脚本类 / 源路径 / 类名查找；props = 属性配置）

#### `addComponent(component: "rigidBody" \| "collider" \| typeof RigidBody \| typeof Collider, settings?: never): null`

## 节点类型（场景节点引用的类型 token）

既可作类型标注（字段类型），也可作为值传给 @property({ type })：
  @property({ type: MeshNode }) target: MeshNode | null = null;
编辑器按类型过滤可选场景节点；运行期字段解析为对应 kind 的 Entity 子类实例
（instanceof 可判断）。小写别名与编辑器节点名一致（meshNode/cameraNode/…）。

### class Transform extends Entity

通用节点（Transform/空组；可引用任意场景节点）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, Transform, MeshNode, LightNode, CameraNode, SkyboxNode, FogNode, engine } from "tve";

export default class NodeRefs extends Component {
  // 通用节点（Transform = 空组基类，可引用任意场景节点）
  @property({ type: Transform, label: "出生点" })
  spawn: Transform | null = null;

  // 网格节点（基元/模型网格）
  @property({ type: MeshNode, label: "目标网格" })
  target: MeshNode | null = null;

  // 灯光 / 相机 / 天空盒 / 雾节点（场景节点句柄）
  @property({ type: LightNode, label: "光源" })
  lamp: LightNode | null = null;
  @property({ type: CameraNode, label: "相机" })
  cam: CameraNode | null = null;
  @property({ type: SkyboxNode, label: "天空盒" })
  sky: SkyboxNode | null = null;
  @property({ type: FogNode, label: "雾" })
  fog: FogNode | null = null;

  onStart() {
    // 节点句柄 = Entity 子类：全部通用能力（变换/层级/查找/组件）可用
    if (this.spawn) this.entity.position = this.spawn.position;
    // instanceof 收窄（engine.scene.find 返回宽类型 Entity）
    const found = engine.scene.find("主相机");
    if (found instanceof CameraNode) found.lookAt({ x: 0, y: 0, z: 0 });
  }
}
```

### class MeshNode extends Entity

网格节点（编辑器 meshNode：基元网格或模型网格）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, MeshNode, math, tween } from "tve";

export default class MeshDemo extends Component {
  // 引用场景里的网格节点（基元/模型网格）；检查器按类型过滤候选
  @property({ type: MeshNode, label: "门" })
  door: MeshNode | null = null;

  @property({ type: MeshNode, label: "移动目标" })
  goal: MeshNode | null = null;

  @property({ label: "开门时长（秒）", min: 0.1 })
  duration = 1;

  onStart() {
    if (!this.door) return;
    // 网格节点 = Entity 子类：变换/层级/组件全量可用
    tween.position(this.door, { y: 3 }, this.duration).easing("quadInOut");
  }

  onUpdate(delta: number) {
    if (!this.goal) return;
    // 与通用实体完全一致的语义（度制欧拉角、快照读写）
    this.entity.rotation = { y: this.entity.rotation.y + 30 * delta };
    const dir = math.normalize(math.sub(this.goal.position, this.entity.position));
    void dir;
  }
}
```

### class LightNode extends Entity

灯光节点句柄（编辑器 lightNode / pointLightNode / directionalLightNode / ambientLightNode / spotLightNode）。

这是场景**节点**句柄（extends Entity），不是组件——不能用 `getComponent(LightNode)`。
灯光属性（intensity/color/kind/...）通过组件门面 `Light` 访问：
```ts tve
import { Component, Light } from "tve";

export default class Torch extends Component {
  onStart() {
    const light = this.entity.getComponent(Light);   // ✅ 组件门面
    // const light2 = this.entity.getComponent("light"); // ✅ 字符串键
    // this.entity.getComponent(LightNode)          // ❌ LightNode 是节点句柄，非组件
    if (light) light.intensity = 2;
  }
}
```
引用灯光节点本身（变换/层级）用 `@property({ type: LightNode })` 声明字段，
或 `engine.scene.find("name")` 后以 `instanceof LightNode` 收窄。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, LightNode, Light } from "tve";

export default class LightNodeDemo extends Component {
  // 引用灯光【节点】（变换/层级/可见性走 Entity 能力）
  @property({ type: LightNode, label: "吊灯节点" })
  lampNode: LightNode | null = null;

  onUpdate() {
    if (!this.lampNode) return;
    // 节点级操作：位置/旋转/可见
    this.lampNode.visible = true;
    // 灯光【属性】（intensity/color/kind…）经组件门面 Light 访问——
    // LightNode 是节点句柄不是组件，不能传给 getComponent
    const light = this.lampNode.getComponent(Light);
    if (light) light.intensity = 2 + Math.sin(Date.now() / 300);
  }
}
```

### class CameraNode extends Entity

相机节点（编辑器 cameraNode）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, CameraNode, math } from "tve";

export default class CameraPick extends Component {
  @property({ type: CameraNode, label: "相机" })
  cam: CameraNode | null = null;

  onStart() {
    // 相机跟随（晚更新阶段覆盖本帧一切位姿写入 → onLateUpdate）
  }

  onLateUpdate(delta: number) {
    if (!this.cam) return;
    const p = this.cam.position;
    this.cam.position = math.lerp(p, this.entity.position, 1 - Math.pow(0.9, delta * 60));
    this.cam.lookAt(this.entity.position);
  }

  onUpdate() {
    if (!this.cam) return;
    // 屏幕坐标 → 世界射线（拾取/视线检测；坐标与 engine.input.pointer 同一空间）
    const ray = this.cam.screenToRay(200, 150);
    if (ray) {
      // ray.origin = 相机世界位置；ray.direction = 归一化世界方向
      void ray.origin;
      void ray.direction;
      // 配合物理射线：engine.physics.castRay({ origin: ray.origin, direction: ray.direction })
    }
    // 相机未就绪/坐标越界 → null
    this.cam.screenToRay(-5, -5); // null：越界
  }
}
```

#### `screenToRay(screenX: number, screenY: number): { origin: Vec3; direction: Vec3 } | null`

屏幕坐标 → 世界空间射线（用于物理拾取/视线检测等）。
screenX/screenY 为画布内 CSS 像素（左上角原点；与 engine.input 指针坐标同一空间）。
返回 `{ origin, direction }`（origin = 相机世界位置，direction = 归一化世界方向）；
相机未就绪/坐标越界返回 null。

### class SkyboxNode extends Entity

天空盒节点（编辑器 skyboxNode）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, SkyboxNode, FogNode } from "tve";

export default class Weather extends Component {
  // 天空盒节点引用（环境级；场景配置在检查器，脚本可运行态微调）
  @property({ type: SkyboxNode, label: "天空盒" })
  sky: SkyboxNode | null = null;

  // 雾节点引用（场景环境级：第一个启用且可见的雾节点生效）
  @property({ type: FogNode, label: "雾" })
  fog: FogNode | null = null;

  onStart() {
    // 运行态开关（不回写场景文件）
    if (this.fog) this.fog.visible = false;
    if (this.sky) this.sky.visible = true;
  }
}
```

### class FogNode extends Entity

雾节点（编辑器 fogNode；场景环境级，第一个启用且可见的雾节点生效）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, FogNode, tween } from "tve";

export default class FogFade extends Component {
  // 雾节点（场景环境级：第一个启用且可见的雾节点生效）
  @property({ type: FogNode, label: "雾节点" })
  fog: FogNode | null = null;

  onStart() {
    // 剧情切入：雾淡出后隐藏（运行态写入不回写场景文件）
    if (!this.fog) return;
    this.fog.visible = true;
    tween.from({ o: 1 }, { o: 0 }, 2).onComplete(() => {
      this.fog!.visible = false;
    });
  }
}
```

### ParticleShape

```ts
type ParticleShape = "cone" | "sphere" | "hemisphere" | "box";
```

粒子发射形状：cone = 圆锥（沿节点本地 -Z）| sphere = 球面 | hemisphere = 上半球 | box = 盒体

### interface ParticleSettings

粒子系统发射设置（与编辑器检查器 Particle System 卡同一字段集）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `duration` | `number` | 发射周期（秒）：非循环系统发射持续该时长后停止 |
| `looping` | `boolean` | 循环发射 |
| `prewarm` | `boolean` | 预热：重启时快进一个周期（仅循环系统） |
| `startDelay` | `number` | 起始延迟（秒） |
| `startLifetime` | `number` | 粒子寿命（秒） |
| `startSpeed` | `number` | 初速度（世界单位/秒） |
| `startSize` | `number` | 初始直径（世界单位） |
| `startColor` | `number` | 初始颜色（0xRRGGBB） |
| `endColor` | `number` | 终点颜色（0xRRGGBB；colorOverLifetime 开启时插值到该色） |
| `gravityModifier` | `number` | 重力系数（1 = 标准重力；0 = 无重力；负值上浮） |
| `emissionRate` | `number` | 发射速率（粒子/秒） |
| `maxParticles` | `number` | 同时存活粒子上限（改动会重建发射器） |
| `shape` | `ParticleShape` |  |
| `shapeRadius` | `number` | 形状半径（圆锥底圆 / 球 / 盒半边长） |
| `shapeAngle` | `number` | 圆锥半角（度；仅 cone） |
| `simulationSpace` | `"local" \| "world"` | 模拟空间：local 跟随节点 / world 留在世界 |
| `colorOverLifetime` | `boolean` | 颜色随寿命（start → end + 末段淡出） |
| `sizeOverLifetime` | `boolean` | 尺寸随寿命（线性缩到 0） |
| `blending` | `"additive" \| "normal"` | 混合：additive 叠加 / normal 透明混合（改动会重建发射器） |
| `texture` | `string` | 粒子贴图（图片资产相对路径；空串 = 内置软圆点。RGB 与粒子颜色相乘、alpha 相乘） |

### interface ParticleState

粒子系统运行态

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `playing` | `boolean` | 正在推进（未暂停且未播完） |
| `paused` | `boolean` |  |
| `finished` | `boolean` | 非循环系统已发射完毕且粒子全部消亡 |
| `alive` | `number` | 当前存活粒子数 |
| `time` | `number` | 系统时间（秒；自播放起累计） |

### class ParticleSystemNode extends Entity

粒子系统节点（编辑器 particleSystemNode）：通用节点能力 + 运行时播放控制 +
发射参数读写（运行态生效，不回写场景文件）。

```ts tve
import { Component, property, ParticleSystemNode } from "tve";

export default class Explode extends Component {
  @property({ type: ParticleSystemNode, label: "爆炸特效" })
  fx: ParticleSystemNode | null = null;

  onStart() {
    if (!this.fx) return;
    this.fx.startColor = 0xffcc33;
    this.fx.emissionRate = 200;
    this.fx.restart();
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, ParticleSystemNode, ParticleSettings } from "tve";

export default class Explode extends Component {
  @property({ type: ParticleSystemNode, label: "爆炸特效" })
  fx: ParticleSystemNode | null = null;

  onStart() {
    if (!this.fx) return;
    // 单字段直写（运行态生效，不回写场景文件）
    this.fx.startColor = 0xffcc33;    // 0xRRGGBB
    this.fx.emissionRate = 200;
    this.fx.gravityModifier = 0.5;

    // 或批量合并（maxParticles/blending 变化会重建发射器）
    const patch: Partial<ParticleSettings> = {
      duration: 1.5,
      looping: false,
      startSpeed: 8,
      shape: "cone",
      shapeAngle: 25,
      colorOverLifetime: true,
    };
    this.fx.setSettings(patch);

    // 播放控制
    this.fx.restart();      // 清空粒子从头开始
    // this.fx.play();      // 暂停态续播
    // this.fx.pause();     // 暂停（保留当前粒子）
    // this.fx.stop();      // 停止发射（存活粒子自然消亡）
    // this.fx.clear();     // 立即清空全部粒子
  }

  onUpdate() {
    if (!this.fx) return;
    // 运行态（只读）：playing / paused / finished / aliveCount / settings
    if (this.fx.finished) this.fx.restart();
  }
}
```

#### `play(): void`

播放（暂停态续播；停止/播完态从头开始）

#### `pause(): void`

暂停（保留当前粒子）

#### `stop(): void`

停止发射（存活粒子自然消亡）

#### `restart(): void`

清空粒子并从头开始（预热系统下一帧快进一个周期）

#### `clear(): void`

立即清空全部粒子（不改变播放态）

#### `playing: boolean`

#### `paused: boolean`

#### `finished: boolean`

非循环系统已发射完毕且粒子全部消亡

#### `aliveCount: number`

当前存活粒子数

#### `settings: ParticleSettings | null`

发射设置快照（未绑定返回 null）

#### `setSettings(patch: Partial<ParticleSettings>): void`

批量合并发射设置（子集；maxParticles/blending 变化会重建发射器）

#### `duration: number`

#### `looping: boolean`

#### `prewarm: boolean`

#### `startDelay: number`

#### `startLifetime: number`

#### `startSpeed: number`

#### `startSize: number`

#### `startColor: number`

初始颜色（0xRRGGBB）

#### `endColor: number`

终点颜色（0xRRGGBB）

#### `gravityModifier: number`

#### `emissionRate: number`

#### `maxParticles: number`

#### `shape: ParticleShape`

#### `shapeRadius: number`

#### `shapeAngle: number`

#### `simulationSpace: "local" | "world"`

#### `colorOverLifetime: boolean`

#### `sizeOverLifetime: boolean`

#### `blending: "additive" | "normal"`

#### `texture: string`

粒子贴图（图片资产相对路径；空串 = 内置软圆点；运行态异步加载后热替换）

### class TerrainNode extends Entity

地形节点（编辑器 terrainNode）：通用节点能力 + 贴地采样
（脚本把物体摆到地表、按坡度撒放植被/装饰物用）。

```ts tve
import { Component, property, TerrainNode } from "tve";

export default class Drop extends Component {
  @property({ type: TerrainNode, label: "地形" })
  ground: TerrainNode | null = null;

  onUpdate() {
    const p = this.entity.position;
    if (this.ground) p.y = this.ground.sampleHeight(p.x, p.z);
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, TerrainNode, math } from "tve";

export default class Drop extends Component {
  @property({ type: TerrainNode, label: "地形" })
  ground: TerrainNode | null = null;

  @property({ label: "离地高度", step: 0.1 })
  offset = 0;

  onUpdate() {
    if (!this.ground) return;
    // 贴地：双线性采样地表高度（节点本地 x/z；仅平移的地形即世界坐标）
    const p = this.entity.position;
    p.y = this.ground.sampleHeight(p.x, p.z) + this.offset;
    this.entity.position = p;
  }
}
```

撒放装饰物（平坦度检测）：

```ts tve
import { Component, property, TerrainNode, math, Vec3 } from "tve";

export default class Scatter extends Component {
  @property({ type: TerrainNode, label: "地形" })
  ground: TerrainNode | null = null;

  scatter(count: number): Vec3[] {
    if (!this.ground) return [];
    const out: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      // sampleSlope：1 = 平地 → 0 = 崖壁（有限差分估算）
      if (this.ground.sampleSlope(x, z) > 0.85) {
        out.push(math.v3(x, this.ground.sampleHeight(x, z), z));
      }
    }
    return out;
  }

  onStart() {
    // 地形设置快照（只读；seed/size/segments/heightScale…）
    void this.ground?.settings;
    this.scatter(50);
  }
}
```

#### `sampleHeight(x: number, z: number): number`

双线性采样地表高度（节点本地 x/z；节点仅平移时即世界坐标；未命中返回 0）

#### `sampleSlope(x: number, z: number): number`

地表平坦度（1 = 平地 → 0 = 崖壁；有限差分估算，撒放可用性检测用）

#### `settings: TerrainSettingsSnapshot | null`

地形设置快照（未绑定返回 null）

### interface TerrainSettingsSnapshot

地形设置快照（SDK 只读视图；与编辑器 TerrainSettings 同形状）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `seed` | `number` |  |
| `size` | `number` |  |
| `segments` | `number` |  |
| `heightScale` | `number` |  |
| `frequency` | `number` |  |
| `octaves` | `number` |  |
| `lacunarity` | `number` |  |
| `gain` | `number` |  |
| `erosion` | `number` |  |
| `warp` | `number` |  |
| `valleyBias` | `number` |  |
| `seaLevel` | `number` |  |
| `talus` | `number` |  |
| `talusPasses` | `number` |  |
| `grassColor` | `number` |  |
| `rockColor` | `number` |  |
| `snowColor` | `number` |  |

## 逻辑运行器（状态机/行为树）：场景节点句柄 + engine.logic 控制接口

.fsm/.bt 资产在编辑器经「逻辑」分组的运行器节点绑定；运行态（当前状态/
黑板/运行记忆）不序列化。控制统一走 engine.logic（按实体寻址）。

### class FsmRunnerNode extends Entity

状态机运行器节点（编辑器 fsmRunnerNode）：控制走 {@link engine.logic}

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, FsmRunnerNode, engine, LogicStateInfo } from "tve";

// 状态机运行器节点（编辑器 fsmRunnerNode，绑定 .fsm 资产）；
// 控制统一走 engine.logic（按实体寻址），本句柄是普通 Entity 子类
export default class Guard extends Component {
  @property({ type: FsmRunnerNode, label: "守卫状态机" })
  brain: FsmRunnerNode | null = null;

  onStart() {
    if (!this.brain) return;
    // 发射事件（事件过渡触发器：进入当前状态以来的首次发射有效）
    engine.logic.fire(this.brain, "onSeen");

    // 写条件过渡的黑板参数（布尔按 0/1 参与比较）
    engine.logic.setFsmParam(this.brain, "alert", 1);

    // 订阅状态进入（match = 状态 id 或显示名，空串 = 任意）
    const off = engine.logic.onFsmEnter(this.brain, "Chase", (s: LogicStateInfo) => {
      engine.log("进入追击", s.name, "已停留", s.time);
    });
    // off(); // 解绑
  }

  onUpdate() {
    if (!this.brain) return;
    // 当前状态快照（未绑定/未启动 null）
    const st = engine.logic.fsmState(this.brain);
    // 读黑板参数（未定义 undefined）
    const alert = engine.logic.getFsmParam(this.brain, "alert");
    // 强制切状态（不经触发器；stateId 或状态名）
    if (st && st.time > 10) engine.logic.forceFsmState(this.brain, "Patrol");
    void alert;
  }
}
```

### class BtRunnerNode extends Entity

行为树运行器节点（编辑器 btRunnerNode）：控制走 {@link engine.logic}

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, BtRunnerNode, engine } from "tve";

// 行为树运行器节点（编辑器 btRunnerNode，绑定 .bt 资产）；控制走 engine.logic
export default class Hunter extends Component {
  @property({ type: BtRunnerNode, label: "猎人行为树" })
  brain: BtRunnerNode | null = null;

  private lastSeq = -1;
  private step = 0;

  onStart() {
    if (!this.brain) return;
    // 写黑板（条件叶子的求值对象）
    engine.logic.setBtParam(this.brain, "hunger", 80);

    // 注册动作叶处理器（按动作名；返回三值状态，缺省视为 success）
    engine.logic.onAction(this.brain, "walkTo", (leaf, session) => {
      // seq = 求值代际：动作重新开始自增，running 续行不变——据此复位内部状态
      if (session.seq !== this.lastSeq) {
        this.lastSeq = session.seq;
        this.step = 0;
      }
      return ++this.step >= 10 ? "success" : "running";
    });
  }

  onUpdate() {
    if (!this.brain) return;
    // 整树最近一次 tick 结果
    const status = engine.logic.btStatus(this.brain); // "success" | "failure" | "running" | null
    // 读黑板 / 通用控制
    void engine.logic.getBtParam(this.brain, "hunger");
    if (status === "failure") engine.logic.restart(this.brain); // 重启（黑板回默认）
    // engine.logic.setRunning(this.brain, false);  // 暂停（恢复时未启动则从入口开始）
  }
}
```

### BTStatus

```ts
type BTStatus = "success" | "failure" | "running";
```

行为树节点求值状态

### interface LogicStateInfo

状态机状态快照

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 状态 id（图内唯一） |
| `name` | `string` | 显示名 |
| `time` | `number` | 当前状态停留秒数 |

### interface BTActionLeaf

动作叶子数据（engine.logic.onAction 处理器的入参）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 叶节点 id（树内唯一；同动作名多处使用时用它区分实例） |
| `action` | `string` | 动作名 |

### interface BTActionSession

动作求值会话：seq 为求值代际，每次全新开始（首次 / 完成后树重启再入 /
被中断后重入）自增；running 续行时不变——有状态的动作比对 seq 复位。

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `seq` | `number` |  |

### BTActionHandler

```ts
type BTActionHandler = (
  leaf: BTActionLeaf,
  session: BTActionSession,
) => BTStatus | void;
```

动作处理器：返回三值状态（缺省视为 success）

### interface LogicApi

逻辑控制接口（engine.logic）：状态机/行为树运行器的脚本入口

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, FsmRunnerNode, BtRunnerNode, engine, LogicStateInfo, BTStatus } from "tve";

export default class BrainControl extends Component {
  @property({ type: FsmRunnerNode, label: "状态机" })
  fsm: FsmRunnerNode | null = null;

  @property({ type: BtRunnerNode, label: "行为树" })
  bt: BtRunnerNode | null = null;

  onStart() {
    // —— 状态机（fsmRunnerNode 实体）——
    if (this.fsm) {
      const st: LogicStateInfo | null = engine.logic.fsmState(this.fsm);
      void st;                                    // {id,name,time} 或 null
      engine.logic.fire(this.fsm, "onSeen");      // 发射事件
      engine.logic.setFsmParam(this.fsm, "hp", 3);// 写黑板（数值/布尔）
      engine.logic.getFsmParam(this.fsm, "hp");   // 读（未定义 undefined）
      engine.logic.forceFsmState(this.fsm, "Flee");// 强制切状态
      engine.logic.onFsmEnter(this.fsm, "", (s) => { void s; });  // 订阅进入
      engine.logic.onFsmExit(this.fsm, "", (s) => { void s; });   // 订阅退出
      engine.logic.onFsmTransition(this.fsm, (from, to) => { void from; void to; });
    }

    // —— 行为树（btRunnerNode 实体）——
    if (this.bt) {
      const status: BTStatus | null = engine.logic.btStatus(this.bt);
      void status;                                // "success"|"failure"|"running"|null
      engine.logic.setBtParam(this.bt, "hunger", 80);
      engine.logic.getBtParam(this.bt, "hunger");
      engine.logic.onAction(this.bt, "walkTo", (leaf, session) => {
        void leaf.id; void leaf.action; void session.seq;
        return "running" satisfies BTStatus;
      });
    }
  }

  onUpdate() {
    // —— 通用（两类运行器）——
    if (this.fsm) {
      engine.logic.setRunning(this.fsm, true); // 暂停/恢复（恢复时未启动从入口开始）
      engine.logic.restart(this.fsm);          // 重启：状态回入口/黑板回默认/清记忆
    }
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `fsmState(entity: Entity)` | `LogicStateInfo \| null` | 状态机当前状态（未绑定/未启动返回 null） |
| `fire(entity: Entity, event: string)` | `void` | 发射事件（进入当前状态以来的首次发射有效；事件过渡的触发器） |
| `setFsmParam(entity: Entity, name: string, value: number \| boolean)` | `void` | 写运行参数（条件过渡的黑板；布尔按 0/1 参与比较） |
| `getFsmParam(entity: Entity, name: string)` | `number \| boolean \| undefined` | 读运行参数（未定义返回 undefined） |
| `forceFsmState(entity: Entity, stateId: string)` | `void` | 强制切换状态（stateId 或状态名；不经触发器；未知忽略） |
| `onFsmEnter(entity: Entity, match: string, cb: (state: LogicStateInfo) => void)` | `() => void` | 订阅状态进入（含初始进入）。match = 状态 id 或显示名（空 = 任意状态）； 返回解绑函数。回调里可安全操作实体（engine.animation.play 等）。 |
| `onFsmExit(entity: Entity, match: string, cb: (state: LogicStateInfo) => void)` | `() => void` | 订阅状态退出（match 参数同 {@link LogicApi.onFsmEnter}） |
| `onFsmTransition(entity: Entity, cb: (from: LogicStateInfo, to: LogicStateInfo) => void)` | `() => void` | 订阅任意过渡（cb(from, to)；返回解绑函数） |
| `btStatus(entity: Entity)` | `BTStatus \| null` | 整树最近一次 tick 结果（未就绪返回 null） |
| `setBtParam(entity: Entity, name: string, value: number \| boolean)` | `void` | 写黑板（条件叶子的求值对象） |
| `getBtParam(entity: Entity, name: string)` | `number \| boolean \| undefined` | 读黑板（未定义返回 undefined） |
| `onAction(entity: Entity, name: string, handler: BTActionHandler)` | `() => void` | 注册动作叶处理器（按动作名；后注册覆盖；返回解绑函数）。 未注册的动作按成功处理。handler 返回 "running" 时下一帧会再次调用 同一动作叶（续行，session.seq 不变）；动作重新开始时 seq 自增，据此复位： ```ts import { Component, engine } from "tve"; export default class Walk extends Component { private lastSeq = -1; private step = 0; onStart() { engine.logic.onAction(this.entity, "walkTo", (leaf, session) => { void leaf.id; if (session.seq !== this.lastSeq) { this.lastSeq = session.seq; this.step = 0; } return ++this.step >= 10 ? "success" : "running"; }); } } ``` |
| `setRunning(entity: Entity, running: boolean)` | `void` | 运行开关（暂停/恢复；恢复时未启动则从入口开始） |
| `restart(entity: Entity)` | `void` | 重启（状态回入口/黑板回默认/清运行记忆） |

## UI（Canvas-Widget）：画布容器 + 图片/文本/按钮 Widget + 布局容器

2D 定位标准：100px = 1 UI 单位；锚点 anchorMin/Max/pivot 为 0..1 归一化
（父矩形/自身），anchoredPosition/offset 单位与 size 一致（UI 单位）。

### UIScaleMode

```ts
type UIScaleMode = "noscale" | "fixedwidth" | "fixedheight" | "fixedauto" | "full";
```

UI 缩放模式（与项目设置 scaleMode 同名集）

### interface UIVec2

UI 锚点/布局容器的二维向量（分量语义见各字段）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |

### interface UIPadding

UI 内边距（UI 单位）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `left` | `number` |  |
| `right` | `number` |  |
| `top` | `number` |  |
| `bottom` | `number` |  |

### class UICanvasNode extends Entity

UI 画布节点（编辑器 uiCanvasNode）：屏幕叠加渲染的 UI 容器根，
Widget（图片/文本/按钮/布局容器）作为其子节点参与叠加；SortOrder 控制叠加顺序。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UICanvasNode, UITextNode, UIVec2 } from "tve";

export default class HUD extends Component {
  @property({ type: UICanvasNode, label: "主画布" })
  canvas: UICanvasNode | null = null;

  @property({ type: UITextNode, label: "计分文本" })
  scoreText: UITextNode | null = null;

  onStart() {
    if (!this.canvas) return;
    // 画布整体叠加序（多画布大者在上）与屏幕适配（仅预览/产物运行时生效）
    this.canvas.sortOrder = 10;
    this.canvas.designWidth = 1920; // 设计像素，100px = 1 UI 单位
    this.canvas.designHeight = 1080;
    this.canvas.scaleMode = "fixedauto";

    // 点锚点定位：枢轴相对锚点的偏移（UI 单位）
    if (this.scoreText) {
      const pos: UIVec2 = { x: -8, y: 4.5 }; // 画布局部：原点在中心，y 向上
      this.scoreText.anchoredPosition = pos;
      this.scoreText.text = "得分 0";
    }
  }
}
```

#### `sortOrder: number`

画布整体排序（多画布叠加时大者在上；优先于画布内 Widget 排序）

#### `designWidth: number`

设计宽度（设计像素；100px = 1 UI 单位）

#### `designHeight: number`

设计高度（设计像素）

#### `scaleMode: UIScaleMode`

屏幕适配方案（仅预览/构建产物运行时生效；编辑器布局视图恒按设计尺寸 1:1 显示）

### interface UIAnchorBase

UI 元素共有锚点字段（位置由锚点系统解析：点锚点用 anchoredPosition，拉伸轴用 offset）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `anchorMin` | `UIVec2` | 归一化锚点下限（父矩形 0..1；某轴 min==max 为点锚点） |
| `anchorMax` | `UIVec2` | 归一化锚点上限（min<max 该轴拉伸，尺寸由边距推导） |
| `pivot` | `UIVec2` | 归一化枢轴（自身 0..1） |
| `anchoredPosition` | `UIVec2` | 点锚点轴：枢轴相对锚点的偏移（UI 单位） |
| `offsetMin` | `UIVec2` | 拉伸轴边距：左/下（UI 单位） |
| `offsetMax` | `UIVec2` | 拉伸轴边距：右/上（UI 单位） |

### interface UIWidgetBase extends UIAnchorBase

UI Widget 共有字段（叠加序 + 矩形尺寸 + 锚点；尺寸/位置单位 = UI 单位，100px = 1 单位）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `sortOrder` | `number` | 画布内叠加序（大者在上；点击命中也按此取最上层） |
| `size` | `{ x: number; y: number }` | 矩形尺寸（UI 单位；拉伸锚点轴由父矩形与边距推导） |
| `opacity` | `number` | 不透明度（0..1，1 = 不透明；图片/文本/按钮渲染到材质透明度） |

### class UIImageNode extends Entity implements UIWidgetBase

UI 图片节点（编辑器 uiImageNode）：矩形图片或纯色块

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UIImageNode, tween } from "tve";

export default class DamageFlash extends Component {
  @property({ type: UIImageNode, label: "受击遮罩" })
  flash: UIImageNode | null = null;

  onStart() {
    if (!this.flash) return;
    // 图片资产相对路径（空串 = 纯色矩形；运行态异步加载热替换）
    this.flash.image = "assets/vignette.png";
    this.flash.color = 0xff2020; // 着色（与图片相乘）
    this.flash.sortOrder = 100;  // 画布内叠加序（大者在上）

    // 拉伸铺满：锚点 min<max 的轴由父矩形与边距推导
    this.flash.anchorMin = { x: 0, y: 0 };
    this.flash.anchorMax = { x: 1, y: 1 };

    // 淡入淡出（UI 字段可补间：对象字段允许部分分量）
    tween.from(this.flash, { color: 0x000000 }, 0.05);
  }
}
```

#### `sortOrder: number`

#### `size: { x: number; y: number }`

#### `opacity: number`

不透明度（0..1，1 = 不透明）

#### `anchorMin: UIVec2`

#### `anchorMax: UIVec2`

#### `pivot: UIVec2`

#### `anchoredPosition: UIVec2`

#### `offsetMin: UIVec2`

#### `offsetMax: UIVec2`

#### `image: string`

图片资产相对路径（空串 = 纯色矩形；运行态异步加载后热替换）

#### `color: number`

着色（0xRRGGBB；与图片相乘）

### class UITextNode extends Entity implements UIWidgetBase

UI 文本节点（编辑器 uiTextNode）：多行文本（自动换行，样式可调）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UITextNode, dataCenter } from "tve";

export default class ScoreLabel extends Component {
  @property({ type: UITextNode, label: "计分文本" })
  label: UITextNode | null = null;

  onStart() {
    if (!this.label) return;
    // 内容与样式（\n 分行；超界自动换行）
    this.label.text = "得分 0";
    this.label.fontSize = 32;          // 设计像素（100px = 1 单位）
    this.label.color = 0xffffff;
    this.label.bold = true;
    this.label.fontFamily = "mono";    // system / serif / mono
    this.label.align = "center";       // 相对文本框

    // 尺寸与锚点（UI 单位；点锚点用 anchoredPosition）
    this.label.size = { x: 6, y: 1 };
    this.label.anchorMin = { x: 0.5, y: 1 };
    this.label.anchorMax = { x: 0.5, y: 1 };
    this.label.pivot = { x: 0.5, y: 1 };
    this.label.anchoredPosition = { x: 0, y: -0.5 };
  }

  onUpdate() {
    // 与数据中心联动刷新
    const score = dataCenter.get<number>("score") ?? 0;
    if (this.label) this.label.text = `得分 ${score}`;
  }
}
```

#### `sortOrder: number`

#### `size: { x: number; y: number }`

#### `opacity: number`

不透明度（0..1，1 = 不透明）

#### `anchorMin: UIVec2`

#### `anchorMax: UIVec2`

#### `pivot: UIVec2`

#### `anchoredPosition: UIVec2`

#### `offsetMin: UIVec2`

#### `offsetMax: UIVec2`

#### `text: string`

文本内容（\n 分行；超界自动换行）

#### `fontSize: number`

字号（设计像素，100px = 1 单位）

#### `color: number`

文本颜色（0xRRGGBB）

#### `bold: boolean`

#### `italic: boolean`

#### `fontFamily: "system" | "serif" | "mono"`

字族：system 系统无衬线 / serif 衬线 / mono 等宽

#### `align: "left" | "center" | "right"`

相对文本框的水平对齐

### class UIButtonNode extends Entity implements UIWidgetBase

UI 按钮节点（编辑器 uiButtonNode）：背景 + 标签，运行时可点击

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UIButtonNode, engine } from "tve";

export default class MenuButtons extends Component {
  @property({ type: UIButtonNode, label: "开始按钮" })
  startBtn: UIButtonNode | null = null;

  onStart() {
    // 外观（背景/标签均可运行态改写）
    if (this.startBtn) {
      this.startBtn.label = "开始游戏";
      this.startBtn.labelColor = 0xffffff;
      this.startBtn.fontSize = 28;
      this.startBtn.color = 0x2f6f3f;    // 背景着色（0xRRGGBB）
      this.startBtn.image = "";          // 空串 = 纯色背景
      this.startBtn.interactable = true; // false = 仅展示，不参与点击命中
    }

    // 点击订阅统一走 engine.ui.onClick（见 UIApi；按钮节点须 interactable）
    if (this.startBtn) {
      const off = engine.ui.onClick(this.startBtn, () => engine.log("开始！"));
      void off; // off() 解绑；组件销毁时调用可防悬挂回调
    }
  }
}
```

#### `sortOrder: number`

#### `size: { x: number; y: number }`

#### `opacity: number`

不透明度（0..1，1 = 不透明；背景与标签整体透明）

#### `anchorMin: UIVec2`

#### `anchorMax: UIVec2`

#### `pivot: UIVec2`

#### `anchoredPosition: UIVec2`

#### `offsetMin: UIVec2`

#### `offsetMax: UIVec2`

#### `image: string`

背景图片资产相对路径（空串 = 纯色背景）

#### `color: number`

背景着色（0xRRGGBB）

#### `label: string`

标签文本

#### `labelColor: number`

标签颜色（0xRRGGBB）

#### `fontSize: number`

标签字号（设计像素，100px = 1 单位）

#### `labelBold: boolean`

#### `interactable: boolean`

可交互（false 时仅展示，不参与点击命中）

### class UILayoutNode extends Entity implements UIWidgetBase

UI 布局容器节点（编辑器 uiLayoutNode）：按横向/竖向/网格排列直接子 UI 节点。
自身有尺寸/锚点（可被父布局排列），无渲染内容；layoutMode=none 时子节点回归锚点定位。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UILayoutNode, UITextNode, UIVec2, UIPadding, engine } from "tve";

export default class StatList extends Component {
  @property({ type: UILayoutNode, label: "属性列表容器" })
  list: UILayoutNode | null = null;

  onStart() {
    if (!this.list) return;
    // 排列模式：横向一行 / 竖向一列 / 网格（none = 子节点回归锚点定位）
    this.list.layoutMode = "vertical";
    this.list.padding = { left: 0.5, right: 0.5, top: 0.3, bottom: 0.3 } as UIPadding;
    this.list.spacing = { x: 0.2, y: 0.3 } as UIVec2; // 子元素间距（UI 单位）
    this.list.gridColumns = 2;                          // 仅 grid 模式

    // 布局槽位矩形可查询（布局解析后的实际位置）
    void engine.ui.rectOf(this.list);
  }
}
```

网格背包（grid 模式，行数由子元素数量推导）：

```ts tve
import { Component, property, UILayoutNode, UITextNode, engine } from "tve";

export default class Inventory extends Component {
  @property({ type: UILayoutNode, label: "背包网格" })
  grid: UILayoutNode | null = null;

  onStart() {
    if (!this.grid) return;
    this.grid.layoutMode = "grid";
    this.grid.gridColumns = 5;
    this.grid.spacing = { x: 0.15, y: 0.15 };
    // 直接子 UI 节点自动入槽（大小可再经 size 微调）
    void this.grid.children.filter((c) => c instanceof UITextNode).length;
  }
}
```

#### `sortOrder: number`

#### `size: { x: number; y: number }`

#### `anchorMin: UIVec2`

#### `anchorMax: UIVec2`

#### `pivot: UIVec2`

#### `anchoredPosition: UIVec2`

#### `offsetMin: UIVec2`

#### `offsetMax: UIVec2`

#### `layoutMode: "none" | "horizontal" | "vertical" | "grid"`

排列模式：none 不排列 / horizontal 横向一行 / vertical 竖向一列 / grid 网格

#### `padding: UIPadding`

内容区内边距（UI 单位）

#### `spacing: UIVec2`

子元素间距（UI 单位；x 横向 / y 纵向）

#### `gridColumns: number`

网格列数（grid 模式；行数由子元素数量推导）

## math —— 向量数学库

### interface MathApi

向量数学库（引擎自有类型；纯函数，全部返回新对象，不改写入参）。

```ts tve
import { math, Component } from "tve";

export default class Orbit extends Component {
  onUpdate(delta: number) {
    const dir = math.normalize(math.sub(this.entity.position, math.zero));
    this.entity.position = math.scale(dir, 5);
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { math } from "tve";

// 构造与常量
math.v3(1, 2, 3);        // => {"x":1,"y":2,"z":3}
math.v3(5);              // => {"x":5,"y":0,"z":0}（缺省分量补 0）
math.forward;            // => {"x":0,"y":0,"z":-1}（前向 = -Z）

// 运算（纯函数：返回新对象，不改写入参）
const a = math.v3(1, 2, 3);
math.add(a, math.v3(1, 1, 1));   // => {"x":2,"y":3,"z":4}
math.sub(a, math.one);           // => {"x":0,"y":1,"z":2}
math.scale(a, 2);                // => {"x":2,"y":4,"z":6}
math.dot(math.right, math.right); // => 1（单位向量点积 = 夹角余弦）
math.length(math.v3(3, 4, 0));   // => 5
math.distance(math.zero, math.v3(3, 4, 0)); // => 5

// 归一化（零向量安全返回零向量）
math.normalize(math.v3(0, 5, 0)); // => {"x":0,"y":1,"z":0}
math.normalize(math.zero);        // => {"x":0,"y":0,"z":0}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `v3(x?: number, y?: number, z?: number)` | `Vec3` | 创建向量 {x,y,z}（缺省 0） |
| `zero` | `Vec3` | 常量：零向量（冻结，勿改写） |
| `one` | `Vec3` | 常量：单位向量 (1,1,1)（冻结，勿改写） |
| `up` | `Vec3` | 常量：世界上方向 (0,1,0)（冻结，勿改写） |
| `down` | `Vec3` | 常量：世界下方向 (0,-1,0)（冻结，勿改写） |
| `forward` | `Vec3` | 常量：前方向 (0,0,-1)（冻结，勿改写） |
| `back` | `Vec3` | 常量：后方向 (0,0,1)（冻结，勿改写） |
| `left` | `Vec3` | 常量：左方向 (-1,0,0)（冻结，勿改写） |
| `right` | `Vec3` | 常量：右方向 (1,0,0)（冻结，勿改写） |
| `clone(v: Vec3)` | `Vec3` | 克隆（快照副本，写入不影响原向量） |
| `add(a: Vec3, b: Vec3)` | `Vec3` | 加法 a + b |
| `sub(a: Vec3, b: Vec3)` | `Vec3` | 减法 a - b |
| `scale(v: Vec3, s: number)` | `Vec3` | 数乘 v * s |
| `negate(v: Vec3)` | `Vec3` | 逐分量取反 |
| `abs(v: Vec3)` | `Vec3` | 逐分量取绝对值 |
| `min(a: Vec3, b: Vec3)` | `Vec3` | 逐分量取最小 |
| `max(a: Vec3, b: Vec3)` | `Vec3` | 逐分量取最大 |
| `dot(a: Vec3, b: Vec3)` | `number` | 点积（结果 = \|a\|\|b\|cosθ） |
| `cross(a: Vec3, b: Vec3)` | `Vec3` | 叉积（结果同时垂直于 a、b，方向满足右手定则） |
| `lengthSq(v: Vec3)` | `number` | 模长平方（避免开方，比较距离时更快） |
| `length(v: Vec3)` | `number` | 模长（到原点的直线距离） |
| `distance(a: Vec3, b: Vec3)` | `number` | 两点直线距离 |
| `distanceSq(a: Vec3, b: Vec3)` | `number` | 距离平方 |
| `normalize(v: Vec3)` | `Vec3` | 归一化（模长归 1；零向量返回零向量，不产生 NaN） |
| `lerp(a: Vec3, b: Vec3, t: number)` | `Vec3` | 线性插值 t∈[0,1]（t=0 返回 a 克隆，t=1 返回 b 克隆） |
| `moveTowards(a: Vec3, b: Vec3, maxDelta: number)` | `Vec3` | 由 a 向 b 移动最多 maxDelta（不超过直线距离；匀速移动用） |
| `equals(a: Vec3, b: Vec3, eps?: number)` | `boolean` | 近似相等（逐分量误差 ≤ eps，缺省 1e-6） |
| `clamp(v: number, min: number, max: number)` | `number` | 标量钳制（结果落在 [min, max]） |
| `projectXZ(v: Vec3)` | `Vec3` | XZ 平面投影（返回 y = 0 的副本；把方向约束到水平面） |
| `deltaAngle(current: number, target: number)` | `number` | 角度差（度）= target − current 的最短有符号差（结果 ∈ [-180, 180]）。 角度约定与 Entity.rotation 一致（度制欧拉角）；多圈差值自动归一化。 |
| `moveTowardsAngle(current: number, target: number, maxDelta: number)` | `number` | 角度移近（度）：从 current 沿最短路径向 target 移动最多 maxDelta （配合 delta = 转速×帧间隔 即帧率无关的平滑转身）。 |
| `deadZone(v: number, deadZone: number)` | `number` | 模拟输入死区（线性重映射）：\|v\| ≤ deadZone 归零，其余按符号缩放回 0..1 满量程 （摇杆/扳机等模拟量的标准滤抖处理）。 |
| `degToRad(degrees: number)` | `number` | 度 → 弧度（角度约定与 Entity.rotation 一致） |
| `radToDeg(radians: number)` | `number` | 弧度 → 度 |
| `mat4()` | `number[]` | 创建 4×4 单位矩阵（列主序长度 16） |
| `mat4Multiply(a: number[], b: number[])` | `number[]` | 矩阵乘法 a × b（列主序；结果 = 先 b 变换再 a 变换） |
| `mat4Invert(m: number[])` | `number[]` | 矩阵求逆（列主序；不可逆返回单位矩阵，不产生 NaN） |
| `unproject(ndcX: number, ndcY: number, ndcZ: number, invVP: number[])` | `Vec3` | 屏幕坐标 → 世界坐标（逆投影）。 ndcX/ndcY ∈ [-1,1]（屏幕像素经 NDC 归一化后），ndcZ ∈ [-1,1]（-1 近 1 远）； invVP = (projection × view)^-1（列主序 16 数组，可用 mat4Invert 求逆）。 返回世界空间 Vec3。 |

## tween —— 补间动画系统

驱动方式：由引擎每帧自动推进（脚本 onUpdate 前），创建即开始播放；
无需手动驱动。全部 tween 可链式配置并在任意时刻 stop/pause/resume。

### EaseName

```ts
type EaseName =
  | "linear"
  | "quadIn" | "quadOut" | "quadInOut"
  | "cubicIn" | "cubicOut" | "cubicInOut"
  | "quartIn" | "quartOut" | "quartInOut"
  | "quintIn" | "quintOut" | "quintInOut"
  | "sineIn" | "sineOut" | "sineInOut"
  | "expoIn" | "expoOut" | "expoInOut"
  | "circIn" | "circOut" | "circInOut"
  | "backIn" | "backOut" | "backInOut"
  | "elasticIn" | "elasticOut" | "elasticInOut"
  | "bounceIn" | "bounceOut" | "bounceInOut";
```

缓动函数名（Robert Penner 标准族；"linear" 无方向后缀）。
In = 加速起步，Out = 减速收尾，InOut = 两端缓入缓出。

### easing

```ts
const easing: Readonly<Record<EaseName, (t: number) => number>>;
```

缓动函数表：名称 → 插值函数（t 0..1 → eased；back/elastic 中间超调出界）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { easing } from "tve";

// 名称 → 插值函数（t 0..1 → eased；back/elastic 中间会超调出界）
easing.linear(0.5);  // => 0.5
easing.quadIn(0.5);  // => 0.25（加速起步：t²）
easing.quadOut(0.5); // => 0.75（减速收尾：1-(1-t)²）

// 与 tween.easing 名称共用同一张表
easing.bounceOut(1); // => 1（端点保持 0→1）
easing.elasticOut(0); // => 0
```

### TweenValue

```ts
type TweenValue = number | Partial<Vec3> & Record<string, number | undefined>;
```

可插值目标值：数字，或数值字段对象——{x,y,z} 向量 / {x,y}（size、
anchoredPosition、pivot、spacing）/ {left,right,top,bottom}（padding）等，
允许部分字段（缺省分量保持不动）。

### class Tween

补间句柄：链式配置 + 播放控制。由 tween 工厂创建（创建即自动播放，
同一语句内的链式配置全部生效），脚本不要直接 new。

```ts tve
import { tween, engine, Component } from "tve";

export default class Punch extends Component {
  onStart() {
    tween.position(this.entity, { x: 5, y: 0, z: 0 }, 1)
      .easing("quadOut")
      .onComplete(() => engine.log("到位"));
  }
}
```

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { tween, Component } from "tve";

// 补间句柄由 tween 工厂创建（创建即播放）；同一语句内链式配置全部生效
const t = tween.value(0, 10, 5)
  .easing("sineInOut")
  .delay(0.5)
  .onStart(() => { /* delay 结束后触发一次 */ })
  .onUpdate((value, k) => { /* value = 插值输出；k = easing 后系数 0..1 */ })
  .onComplete(() => { /* 播完触发一次 */ });

t.playing;   // => true
t.paused;    // => false
t.loop(3);   // 循环 3 次（-1 = 无限）
t.yoyo(true); // 往返：偶数次循环反向插值

// 暂停/恢复/停止
t.pause();
t.paused;    // => true
t.resume();
t.stop();          // 移出推进列表，不再恢复
t.playing;         // => false
```

串接（完成后自动启动下一个）：

```ts tve
import { tween } from "tve";

const first = tween.value(0, 1, 0.2);
const second = tween.value(1, 0, 0.2);
const chain = first.then(second); // first 播完自动启动 second
chain === second; // => true（返回 next 以便继续链式配置）
```

#### `constructor()`

@internal 由 tween 工厂创建，脚本不要直接 new

#### `easing(nameOrFn: EaseName \| ((t: number) => number)): this`

缓动：名称（EaseName）或自定义函数 (t 0..1) => eased

#### `delay(seconds: number): this`

开始前延时（秒；多次调用取最后一次）

#### `loop(count: number): this`

循环次数：1 = 单次（缺省）；n = n 次；-1 = 无限循环

#### `yoyo(on?: boolean): this`

往返：偶数次循环反向插值（终点 → 起点；对 sequence/parallel 组无效）

#### `onStart(cb: () => void): this`

开始回调（delay 结束、首轮插值前触发一次）

#### `onUpdate(cb: (value: number, t: number) => void): this`

每帧回调。value = 插值输出（tween.value/tween.color 为插值结果，
其余为系数）；t = easing 后的插值系数 0..1。

#### `onComplete(cb: () => void): this`

完成回调（循环计满触发一次；stop(true) 快进完成同样触发）

#### `then(next: Tween): Tween`

串接：本 tween 完成后自动启动 next（next 无需手动 start）。
返回 next 以便继续链式配置。

#### `stop(complete?: boolean): this`

停止：移出推进列表不再恢复。
complete = true 时先快进到最终落点并触发 onComplete（不启动 then 链）。

#### `pause(): this`

暂停（保留进度）

#### `resume(): this`

从暂停处继续

#### `playing: boolean`

是否正在推进（不含暂停）

#### `paused: boolean`

是否处于暂停态

#### `completed: boolean`

是否已完成（自然播完或 stop(true)）

#### `duration: number`

配置的时长（秒）

#### `elapsed: number`

累计活跃播放时长（秒；不含 delay）

#### `progress: number`

当前循环进度 0..1（easing 前）

#### `loopsDone: number`

已完成的循环数

### interface TweenApi

补间动画 API（`tween` 顶层导出与 `engine.tween` 同一对象）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { tween, easing, Component, MeshNode, property } from "tve";

// 链式配置：创建即自动播放（引擎每帧推进，无需手动驱动）
const t = tween.value(0, 100, 2).easing("quadOut").onUpdate((v) => {
  /* v = 当前插值 */
});
t.playing;    // => true
t.duration;   // => 2
t.progress;   // => 0（尚未推进）

// 31 个缓动名（Robert Penner 标准族）或自定义函数
tween.value(0, 1, 1).easing(easing.backOut);
tween.value(0, 1, 1).easing((t: number) => 1 - Math.abs(1 - t * 2));

// 实体变换补间（部分字段：只写 x，其余保持）
export default class Punch extends Component {
  @property({ type: MeshNode, label: "目标" })
  target: MeshNode | null = null;

  onStart() {
    if (!this.target) return;
    tween.position(this.target, { x: 5 }, 1)
      .easing("quadOut")
      .onComplete(() => tween.scale(this.target!, { y: 0.6 }, 0.15).yoyo(true).loop(2));
  }
}
```

序列与并行组：

```ts tve
import { tween } from "tve";

// 串行组：依次播放；delay/call 是占位符
const seq = tween.sequence([
  tween.delay(0.5),
  tween.call(() => { /* 开始 */ }),
  tween.value(0, 10, 1),
]);
seq.playing; // => true

// 并行组：同时播放
tween.parallel([tween.value(0, 1, 1), tween.color(0xff0000, 0x00ff00, 2)]);

// 全局控制
tween.timeScale = 1;       // 0 = 冻结全部 tween
tween.activeCount >= 3;    // => true（上面创建的都活跃）
tween.killAll();           // 停止全部
tween.activeCount;         // => 0
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `to(target: object, props: Record<string, TweenValue>, duration: number)` | `Tween` | 数值/向量属性插值：目标可以是 Entity（position/rotation/scale 变换、 fontSize/sortOrder 等数字字段）、UI Widget 字段（anchoredPosition/size 等 {x,y} 对象）或任意带同名字段的普通对象；创建即开始播放。 ```ts tween.to(this.entity, { position: { x: 5 }, scale: { y: 2 } }, 1.5); ``` |
| `from(target: object, props: Record<string, TweenValue>, duration: number)` | `Tween` | 反向插值：props 为起点，渐变回开始时的当前值（常用作入场动画） |
| `value(from: number, to: number, duration: number)` | `Tween` | 数值插值（onUpdate 收插值结果） |
| `color(from: number, to: number, duration: number)` | `Tween` | 0xRRGGBB 颜色插值（RGB 通道各自线性；onUpdate 收 0xRRGGBB） |
| `position(entity: Entity, to: TweenValue, duration: number)` | `Tween` | 实体本地位置补间（= to(entity, { position: to }, duration)） |
| `rotation(entity: Entity, toDeg: TweenValue, duration: number)` | `Tween` | 实体本地旋转补间（度制欧拉角） |
| `scale(entity: Entity, to: TweenValue, duration: number)` | `Tween` | 实体本地缩放补间 |
| `sequence(tweens: Tween[])` | `Tween` | 串行组：依次播放子 tween（空数组立即完成）；组级 delay/loop 可用 |
| `parallel(tweens: Tween[])` | `Tween` | 并行组：同时播放子 tween（空数组立即完成）；组级 delay/loop 可用 |
| `delay(seconds: number)` | `Tween` | 纯延时占位（sequence / then 链用） |
| `call(cb: () => void)` | `Tween` | 立即回调占位：下一帧触发 cb（sequence / then 链用） |
| `killAll(complete?: boolean)` | `void` | 停止全部活动 tween（complete = true 先快进终点并触发 onComplete） |
| `pauseAll()` | `void` | 暂停全部活动 tween |
| `resumeAll()` | `void` | 恢复全部暂停中的 tween |
| `activeCount` | `number` | 活动 tween 数（含暂停中的） |
| `timeScale` | `number` | 全局时间缩放（0 = 冻结全部 tween；负数按 0） |

### tween

```ts
const tween: TweenApi;
```

补间动画系统（与 engine.tween 同一对象）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { tween } from "tve";

// 工厂速查（创建即播放）：
//   to / from / value / color / position / rotation / scale /
//   sequence / parallel / delay / call
const t1 = tween.value(0, 100, 1);
const t2 = tween.color(0x000000, 0xffffff, 0.5); // 0xRRGGBB 颜色插值

// to：数值/向量属性插值（Entity 变换、UI 字段、任意同名字段对象）
// from：从 props 反向渐变回当前值（入场动画常用）
tween.to({ hp: 100 }, { hp: 30 }, 0.3);
tween.from({ opacity: 0 }, { opacity: 1 }, 0.3);

// 全局控制与统计
tween.activeCount >= 1; // => true
tween.pauseAll();
tween.resumeAll();
tween.killAll();
tween.activeCount;      // => 0

void t1; void t2;
```

## 脚本通用系统：委托（多播事件）与对象池

两者均为纯脚本设施，与引擎接线无关，
在预览/发布产物中行为一致。

### class Delegate<T extends (...args: never[]) => unknown = () => void>

委托：多播事件容器（参考 C# 多播委托）。
用于把"某件事发生"广播给多个订阅者——组件间解耦通信的标准设施：

```ts tve
import { Delegate, Component, engine } from "tve";

export class GameEvents extends Component {
  static readonly onScore = new Delegate<(delta: number) => void>();
}
// 订阅方（任意组件）：
const token = GameEvents.onScore.add((delta) => engine.log("得分", delta));
GameEvents.onScore.remove(token);   // 或 remove(原函数)
// 发布方：
GameEvents.onScore.invoke(10);
```

语义：同一函数重复订阅只登记一次；invoke 按订阅顺序逐个调用（快照迭代，
回调内 add/remove 安全）；单个回调抛错被隔离上报，不影响其余回调。
建议在组件 onDestroy 中 clear()，避免悬挂订阅。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Delegate, Component } from "tve";

// 定义（常放一个公开组件类上作全局事件总线）
export class GameEvents extends Component {
  static readonly onScore = new Delegate<(delta: number) => void>();
}

// 订阅：add 返回退订令牌（成员函数建议用令牌退订）
const token = GameEvents.onScore.add((delta) => { /* 得分处理 */ });
GameEvents.onScore.count; // => 1

// 同一函数重复订阅只登记一次（同一引用去重）
const fn = () => {};
GameEvents.onScore.add(fn);
GameEvents.onScore.add(fn);
GameEvents.onScore.count; // => 2（lambda + fn；fn 重复添加只登记一次）

// 广播：按订阅顺序逐个调用；单个回调抛错被隔离，不影响其余
GameEvents.onScore.invoke(10);

// 退订：令牌或原函数均可；onDestroy 里 clear() 防悬挂订阅
GameEvents.onScore.remove(token); // => true
GameEvents.onScore.remove(fn);    // => true
GameEvents.onScore.count;         // => 0
GameEvents.onScore.clear();
GameEvents.onScore.count;         // => 0
```

#### `constructor()`

@internal 由脚本直接 new，无需参数

#### `count: number`

已订阅回调数量

#### `add(handler: T): DelegateToken`

订阅回调（同一函数重复订阅只登记一次）。
@returns 移除令牌（退订时传回 remove；成员函数建议用令牌退订）

#### `remove(tokenOrHandler: DelegateToken \| T): boolean`

退订回调：传 add 返回的令牌或原函数均可。返回是否移除了一个订阅

#### `clear(): void`

清空全部订阅（onDestroy 中调用可防悬挂订阅）

#### `invoke(...args: Parameters<T>): void`

广播：按订阅顺序逐个调用全部回调（参数透传给每个订阅者）

### interface DelegateToken

委托移除令牌（不透明句柄；只能从 Delegate.add 获得）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `__delegateToken` | `number` | @internal 令牌序号 |

### class Pool<T>

对象池：复用对象，避免频繁创建/销毁带来的卡顿与 GC 压力。
典型用途：子弹、特效、飘字、临时列表等高频小对象：

```ts tve
import { Pool, Component, engine } from "tve";

interface Bullet { active: boolean; x: number; y: number; }

export default class Gun extends Component {
  private pool = new Pool<Bullet>(
    () => ({ active: false, x: 0, y: 0 }),        // 工厂：新建
    { reset: (b) => { b.active = false; }, initial: 10, max: 100 },
  );

  fire() {
    const b = this.pool.get();                    // 复用空闲对象，池空才新建
    b.active = true;
    // ...使用后归还：
    this.pool.put(b);
  }
}
```

语义：get 优先复用空闲对象（池空才调用工厂新建）；put 先调 reset 清理再入池
（空闲数达 max 上限则丢弃交给 GC）；池只回收自己发出的对象——外来对象或重复
归还返回 false。reset 抛错被捕获忽略（告警上告）。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Pool } from "tve";

interface Bullet {
  active: boolean;
  x: number;
  y: number;
}

// 工厂 + 可选配置：reset 归还清理 / initial 预热 / max 空闲上限
const pool = new Pool<Bullet>(
  () => ({ active: false, x: 0, y: 0 }),
  { reset: (b) => { b.active = false; }, initial: 2, max: 5 },
);

pool.count;         // => 2（预热即备好）
pool.totalCreated;  // => 2

// get：优先复用空闲对象，池空才新建
const a = pool.get();
pool.count;         // => 1

// put：先 reset 清理再入池；非本池对象/重复归还返回 false
pool.put(a);        // => true
pool.put(a);        // => false（已归还过）
pool.put({} as Bullet); // => false（外来对象）

// 评估池命中率：totalCreated 增长越慢 = 复用率越高
pool.prewarm(3);    // 再预热 3 个（受 max 上限约束）
pool.clear();       // 清空空闲列表（不影响已借出的对象）
pool.count;         // => 0
```

#### `constructor(factory: () => T, options?: { /** 归还时的清理回调（put 时调用；抛错被捕获忽略） */ reset?: (item: T) => void; /** 预热数量（创建即备好空闲对象） */ initial?: number; /** 空闲上限（超出后归还的对象被丢弃交给 GC） */ max?: number; })`

@internal factory = 对象工厂；options 全部可选

#### `count: number`

空闲对象数量

#### `totalCreated: number`

累计创建的对象总数（评估池命中率用）

#### `prewarm(n: number): void`

预热：提前创建 n 个空闲对象（受 max 上限约束）

#### `get(): T`

取一个对象：优先复用空闲对象，池空则新建

#### `put(item: T): boolean`

归还对象：先 reset 清理再入池；非本池对象/重复归还返回 false

#### `clear(): void`

清空空闲列表（释放引用交给 GC；不影响已借出的对象）

## 数据中心：跨组件共享的命名数据仓库，内置热/冷分解——热数据（活动工作集）

即时读写，闲置/超量的数据自动"降温"为冻结快照（冷区），再次访问自动"回温"。

### interface DataCenterOptions

数据中心配置项（configure 增量合并）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `hotLimit?` | `number` | 热容量上限：热数据条数超过该值时，清扫按最久未访问（LRU）降冷（缺省 64） |
| `coldTtl?` | `number` | 冷却时长（毫秒）：热数据闲置超过该时长，清扫时降冷（缺省 30000） |
| `autoSweep?` | `boolean` | 惰性自动清扫开关（set/get/has 访问时按 sweepInterval 触发；缺省 true） |
| `sweepInterval?` | `number` | 自动清扫最小间隔（毫秒；缺省 10000） |

### interface DataCenterStats

统计快照（观测热/冷分布与命中情况）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `hot` | `number` | 热数据条数 |
| `cold` | `number` | 冷数据条数 |
| `sweeps` | `number` | 累计清扫次数 |
| `promotions` | `number` | 累计回温次数（冷数据被访问后转热） |
| `hits` | `number` | 累计命中次数 |
| `misses` | `number` | 累计未命中次数 |

### class DataCenter

数据中心：跨组件共享的命名数据仓库，内置热/冷分解。

```ts tve
import { dataCenter, Component } from "tve";

export default class Game extends Component {
  onStart() {
    dataCenter.set("score", 0);            // 写即热
  }
  onEnemyKilled() {
    const score = dataCenter.get<number>("score") ?? 0;
    dataCenter.set("score", score + 10);   // 其他组件可随时读取
  }
  onDestroy() {
    dataCenter.delete("score");            // 用完清理，避免悬挂数据
  }
}
```

热/冷语义：
- 写入（set）即进入热区，即时生效；
- 长期未访问或超出热容量（hotLimit）的数据在清扫时**降冷**为冻结快照
  （深拷贝隔离——冷数据不受后续改动影响）；
- 读取冷数据自动**回温**为热数据并返回快照值；
- 清扫默认按 sweepInterval 惰性自动触发，也可手动 `sweep()`；
- 冷数据建议存纯数据（普通对象/数组/原始值）；含函数等不可克隆对象按
  结构化克隆 → JSON → 原引用逐级兜底。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { DataCenter } from "tve";

// 隔离实例（new；全局单例见 dataCenter）——可自定义热/冷策略
const dc = new DataCenter({ hotLimit: 2, coldTtl: 0 });

// 写即热、读返回活动引用
dc.set("score", 10);
dc.get<number>("score"); // => 10
dc.has("score");         // => true
dc.keys();               // => ["score"]
dc.hotKeys();            // => ["score"]

// 冷热分解：cool 降冷为冻结快照；读冷数据自动回温并返回快照值
dc.set("hp", 100);
dc.cool("hp");           // => true
dc.coldKeys();           // => ["hp"]
dc.get<number>("hp");    // => 100（回温 + 返回快照）
dc.hotKeys().length;     // => 2（回温后全热）

// sweep 手动清扫：闲置降冷 + 超出 hotLimit 按 LRU 降冷
dc.set("mp", 50);
dc.sweep();              // 超出 hotLimit=2，最久未访问的降冷
dc.stats().cold >= 1;    // => true

// 删除（热/冷一并移除）
dc.delete("score");      // => true
dc.get<number>("score", 0); // => 0（未命中回 defaultValue）
```

#### `constructor(options?: DataCenterOptions)`

@internal 可 new 出隔离实例（不影响全局单例 dataCenter）

#### `configure(options: DataCenterOptions): void`

调整容量/冷却策略（增量合并）

#### `set(key: string, value: T): void`

写入数据（写即热；同名冷数据快照被覆盖）

#### `get(key: string, defaultValue?: T): T | undefined`

读取数据：热数据返回活动引用（改动实时生效）；冷数据自动回温后返回快照值；
未命中返回 defaultValue。

#### `has(key: string): boolean`

是否存在该键（热或冷）

#### `delete(key: string): boolean`

删除数据（热/冷一并移除）。返回是否存在

#### `keys(): string[]`

全部键名（热 + 冷）

#### `hotKeys(): string[]`

热数据键名（当前活动工作集）

#### `coldKeys(): string[]`

冷数据键名（已降冷的冻结快照）

#### `warm(key: string): boolean`

手动回温指定键。返回是否存在

#### `cool(key: string): boolean`

手动降冷指定键（值以冻结快照形式进入冷区）。返回是否降冷

#### `sweep(): number`

手动清扫（闲置 ≥ coldTtl 降冷 + 超出 hotLimit 按 LRU 降冷）。返回降冷条数

#### `stats(): DataCenterStats`

统计快照

### dataCenter

```ts
const dataCenter: DataCenter;
```

全局数据中心单例（跨组件共享游戏数据；需要隔离时 new DataCenter()）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { dataCenter, Component } from "tve";

// 全局单例：跨组件共享游戏数据。写入即热，其他组件随时读取
export default class ScoreBoard extends Component {
  onStart() {
    dataCenter.set("score", 0);
  }

  onEnemyKilled() {
    // 未命中回默认值；get 返回 T | undefined（严格模式收窄后再用）
    const score = dataCenter.get<number>("score") ?? 0;
    dataCenter.set("score", score + 10);
  }

  onDestroy() {
    // 用完清理，避免悬挂数据
    dataCenter.delete("score");
  }
}

// 基本读写断言（单例本身可在任何位置直接用）
dataCenter.set("t", 1);
dataCenter.get<number>("t"); // => 1
dataCenter.has("t");         // => true
dataCenter.delete("t");      // => true
```

## 内置组件门面（getComponent / addComponent / 组件字段声明的对象）

门面 = 组件设置 + 运行时后端的实时视图：属性写入即时生效（预览运行态，
不回写场景文件）；@internal 构造器由运行时创建，脚本不要 new。

### declare class RigidBody

刚体组件门面：mode 为刚体形态；物理方法与 engine.physics 同名接口等价（已绑定本实体）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, RigidBody, Vec3 } from "tve";

export default class Jump extends Component {
  rigid!: RigidBody; // 组件字段：运行期自动绑定门面（未挂刚体时为空转）

  onFixedUpdate(fixedDelta: number) {
    // 物理写入放固定步长（1/60s，与物理步进同频，先于同帧 onUpdate）
    const v = this.rigid.getLinearVelocity();
    if (v && v.y === 0) {
      // 施加冲量起跳（世界空间，N·s）
      this.rigid.applyImpulse(0, 6, 0);
      this.rigid.wakeUp();
    }
    // 速度直写 / 重力缩放（0 = 不受重力）
    // this.rigid.setLinearVelocity(0, 0, 5);
    // this.rigid.setGravityScale(0.5);
    void fixedDelta;
  }

  onCollisionEnter(other: typeof this.entity) {
    // 碰撞回调里读门面信息
    void this.rigid.mode;           // "static" | "kinematic" | "dynamic"
    void this.rigid.colliderCount;  // 碰撞体数量
    void this.rigid.gravityScale;
    void other.id;
    void ({} as Vec3);
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `id: string`

组件引用 id（运行时创建的组件为生成 id）

#### `mode: "static" | "kinematic" | "dynamic"`

刚体形态：static（隐式静态）/ kinematic（运动学）/ dynamic（动力学）

#### `gravityScale: number`

当前重力缩放

#### `colliderCount: number`

碰撞体数量

#### `setGravityScale(scale: number): void`

设置重力缩放（0 = 不受重力）

#### `setLinearVelocity(x: number, y: number, z: number): void`

直接设置线速度（m/s）

#### `getLinearVelocity(): Vec3 | null`

读取线速度

#### `applyImpulse(x: number, y: number, z: number): void`

施加冲量（世界空间，N·s）

#### `wakeUp(): void`

唤醒

### RigidBodyFacade

```ts
type RigidBodyFacade = RigidBody;
```

兼容别名（旧版以接口形式提供刚体门面类型）

### declare class Collider

碰撞体组件门面（只读信息；形状/表面材质在检查器编辑，运行时不可变）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, Collider, Entity } from "tve";

export default class Pickup extends Component {
  // 碰撞体门面：形状/表面材质在检查器编辑，运行时只读
  col!: Collider;

  onCollisionEnter(other: Entity) {
    const col = this.entity.getComponent(Collider) ?? this.col;
    void col.shape;      // "box"/"sphere"/"capsule"/"cylinder"/"convex"（场景命中形状）
    void col.isSensor;   // 传感器：只产生触发不产生碰撞响应
    void col.friction;   // 摩擦系数
    void col.restitution;// 弹性系数
    void col.count;      // 物理世界中的碰撞体数量
    // 传感器触发区（拾取物/传送门）惯用法：isSensor + onCollisionEnter
    if (col.isSensor && other.name === "Player") {
      // 拾取逻辑……
    }
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `id: string`

组件引用 id

#### `shape: string`

场景中命中的碰撞形状（box/sphere/capsule/cylinder/convex）

#### `isSensor: boolean`

是否传感器（只产生触发不产生碰撞响应）

#### `friction: number`

摩擦系数

#### `restitution: number`

弹性系数

#### `count: number`

物理世界中的碰撞体数量

### declare class Light

灯光组件门面：设置写入即时同步到活动灯光对象（类型切换重建灯光）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, LightNode, Light, tween } from "tve";

export default class Torch extends Component {
  @property({ type: LightNode, label: "火把节点" })
  lamp: LightNode | null = null;

  onStart() {
    // 灯光属性经组件门面 Light 访问（节点句柄只管变换/层级）
    const light = this.lamp?.getComponent(Light);
    if (!light) return;
    light.kind = "point";       // point/directional/spot/ambient（切换即重建灯光）
    light.color = 0xffa030;
    light.intensity = 2;
    light.distance = 12;        // 点光/聚光照射距离
    light.decay = 2;            // 物理衰减指数
    light.castShadow = true;
    light.shadowStrength = 0.6; // 阴影浓度 0~1

    // 聚光灯参数
    // light.angle = 30;        // 光束半角（度）
    // light.penumbra = 0.4;    // 边缘柔和度 0~1

    // 渲染层级掩码（只照亮掩码内层的对象；-1 = 全部）
    // light.cullingMask = 0b11;

    // 火光呼吸（intensity 补间循环往返）
    tween.to(light, { intensity: 3 }, 0.4).yoyo(true).loop(-1).easing("sineInOut");
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `id: string`

组件引用 id

#### `get enabled(): boolean`

是否启用（禁用 = 灯光对象隐藏）

#### `set enabled(value: boolean)`

#### `get kind(): "point" | "directional" | "spot" | "ambient"`

灯光类型：point/directional/spot/ambient（写入即重建灯光对象）

#### `set kind(value: "point" \| "directional" \| "spot" \| "ambient")`

#### `get color(): number`

光色（0xRRGGBB）

#### `set color(value: number)`

#### `get intensity(): number`

强度

#### `set intensity(value: number)`

#### `get cullingMask(): number`

渲染层级掩码（灯光 Culling Mask：只照亮掩码内层的对象；-1 = 全部层）

#### `set cullingMask(value: number)`

#### `get distance(): number`

点光/聚光灯：照射距离（0 = 无限远）

#### `set distance(value: number)`

#### `get decay(): number`

点光/聚光灯：物理衰减指数

#### `set decay(value: number)`

#### `get angle(): number`

聚光灯：光束半角（度）

#### `set angle(value: number)`

#### `get penumbra(): number`

聚光灯：边缘柔和度 0~1

#### `set penumbra(value: number)`

#### `get castShadow(): boolean`

点光/平行光/聚光灯：投射阴影

#### `set castShadow(value: boolean)`

#### `get shadowStrength(): number`

阴影浓度 0~1（1 = 纯黑阴影）

#### `set shadowStrength(value: number)`

#### `get shadowBias(): number`

阴影深度偏移（压制自阴影麻点）

#### `set shadowBias(value: number)`

#### `get shadowNormalBias(): number`

阴影法线偏移（≤0 = 自动按纹素相对化）

#### `set shadowNormalBias(value: number)`

#### `get shadowNear(): number`

阴影近裁剪面（比这更近的物体不参与投影）

#### `set shadowNear(value: number)`

#### `get shadowRadius(): number`

阴影软化半径（PCF 采样核，1 = 硬阴影；Soft 档 = 4）

#### `set shadowRadius(value: number)`

#### `get shadowResolution(): number`

阴影贴图分辨率（0 = 自动：平面 2048 / 点光 1024；512~4096 显式档位，写入重建灯光对象）

#### `set shadowResolution(value: number)`

#### `get shadowType(): "off" | "hard" | "soft"`

Shadow 类型档位（"off" | "hard" | "soft"；读写投射开关 + 软化半径）

#### `set shadowType(value: "off" \| "hard" \| "soft")`

### declare class AudioSource

音源组件门面：播放控制按组件 id 寻址；设置写入经运行时合并生效

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, AudioSource } from "tve";

export default class Sfx extends Component {
  sfx!: AudioSource; // 组件字段：运行期自动绑定门面

  onStart() {
    // 音源设置（写入经运行时合并生效）
    this.sfx.source = "assets/hit.ogg"; // 音频资产引用（写入即重载）
    this.sfx.loop = false;
    this.sfx.volume = 0.8;              // 0..1
    this.sfx.speed = 1;                 // 播放倍速 0.1..4
    this.sfx.spatial = "3d";            // "2d" 全局 / "3d" 位置音源

    // 播放控制（按组件 id 寻址）
    this.sfx.play();     // 暂停态续播；停止/播完态从头播
    // this.sfx.pause();
    // this.sfx.resume();
    // this.sfx.stop();
    this.sfx.setVolume(0.5); // 运行时音量
  }

  onUpdate() {
    // 只读运行态
    void this.sfx.playing;
    void this.sfx.paused;
    void this.sfx.ready; // 缓冲是否就绪
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `id: string`

组件引用 id

#### `get source(): string`

音频资产引用（写入即重载）

#### `set source(value: string)`

#### `get autoplay(): boolean`

自动播放（上下文就绪/节点入图后起播）

#### `set autoplay(value: boolean)`

#### `get loop(): boolean`

循环播放

#### `set loop(value: boolean)`

#### `get volume(): number`

音量 0..1

#### `set volume(value: number)`

#### `get speed(): number`

播放倍速 0.1..4

#### `set speed(value: number)`

#### `get spatial(): "2d" | "3d"`

空间化："2d" 全局 / "3d" 位置音源

#### `set spatial(value: "2d" \| "3d")`

#### `playing: boolean`

是否正在播放

#### `paused: boolean`

是否处于暂停态

#### `ready: boolean`

缓冲是否就绪

#### `play(): void`

播放（暂停态续播；停止/播完态从头播）

#### `stop(): void`

停止并回到起点

#### `pause(): void`

暂停（保留进度）

#### `resume(): void`

从暂停处继续

#### `setVolume(volume: number): void`

运行时音量（0~1）

### declare class AnimationClip

关键帧动画剪辑组件门面（.anim 资产绑定 + 播放控制/进度/倍速）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, AnimationClip } from "tve";

export default class DoorAnim extends Component {
  anim!: AnimationClip; // 关键帧动画剪辑组件（.anim 资产）门面

  onStart() {
    // 绑定剪辑（相对路径；写入即重载；空串解绑）
    this.anim.clip = "assets/door-open.anim";
    this.anim.loop = false;
    this.anim.speed = 1;
    this.anim.autoplay = true;

    // 播放控制与进度
    this.anim.play();   // 从头播放
    // this.anim.pause();
    // this.anim.resume();
    // this.anim.stop();        // 停止并回初始姿势
    // this.anim.time = 0.5;    // 写入即跳转采样（秒）
    void this.anim.duration;    // 剪辑时长（秒；未加载 0）
    void this.anim.playing;
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `id: string`

组件引用 id

#### `get clip(): string`

.anim 资产相对路径（写入即重载剪辑；空串解绑）

#### `set clip(value: string)`

#### `duration: number`

剪辑时长（秒；未加载为 0）

#### `get time(): number`

播放进度（秒；写入即跳转采样）

#### `set time(value: number)`

#### `get speed(): number`

播放速度倍率（>0）

#### `set speed(value: number)`

#### `get loop(): boolean`

循环播放

#### `set loop(value: boolean)`

#### `get autoplay(): boolean`

自动播放（加载完成后起播）

#### `set autoplay(value: boolean)`

#### `playing: boolean`

是否正在推进

#### `paused: boolean`

是否处于暂停态

#### `play(): void`

从头播放

#### `pause(): void`

暂停（保留进度）

#### `resume(): void`

从暂停处继续

#### `stop(): void`

停止并回初始姿势

### AnimLoopMode

```ts
type AnimLoopMode = "loop" | "once" | "pingpong";
```

模型动画循环模式

### interface AnimStateDef

动画图状态定义（name 图内唯一；clip 须为模型内嵌剪辑名）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` |  |
| `clip` | `string` |  |
| `speed?` | `number` | 播放速度倍率（缺省 1） |
| `loop?` | `AnimLoopMode` | 循环模式（缺省 loop） |

### interface AnimConditionDef

参数条件（布尔参数按 0/1 参与数值比较）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `param` | `string` |  |
| `op` | `">" \| "<" \| ">=" \| "<=" \| "==" \| "!="` |  |
| `value` | `number` |  |

### interface AnimTransitionDef

动画图过渡定义：from → to，交叉淡化 duration 秒

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id?` | `string` | 过渡 id（缺省自动生成 t1/t2/…；图内唯一） |
| `from` | `string` |  |
| `to` | `string` |  |
| `duration?` | `number` | 过渡时长（秒；缺省 0.25） |
| `exitTime?` | `number` | 归一化退出时间 0..1（>0 = 源状态播放到该进度才允许过渡；缺省 0） |
| `conditions?` | `AnimConditionDef[]` | 过渡条件（全部满足才过渡） |

### interface AnimGraphDef

动画图定义（SkeletalAnimation.ensureGraph / addComponent(SkeletalAnimation) 用；
 运行期 graph getter 返回同构的活对象，states/transitions/entry/params 可直接改写）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, SkeletalAnimation, AnimGraphDef } from "tve";

export default class Locomotion extends Component {
  anim!: SkeletalAnimation; // 组件字段：运行期自动绑定门面

  onStart() {
    // 动画图定义：状态（模型内嵌剪辑名）+ 条件过渡 + 参数表
    const graph: AnimGraphDef = {
      entry: "Idle",
      states: [
        { name: "Idle", clip: "idle", loop: "loop" },
        { name: "Walk", clip: "walk", speed: 1.2 },
        { name: "Run", clip: "run" },
      ],
      transitions: [
        { from: "Idle", to: "Walk", duration: 0.2, conditions: [{ param: "speed", op: ">", value: 0.1 }] },
        { from: "Walk", to: "Run", duration: 0.25, exitTime: 0.5, conditions: [{ param: "speed", op: ">", value: 5 }] },
        { from: "Run", to: "Idle", duration: 0.3 },
      ],
      params: { speed: 0 },
    };
    if (this.anim.ensureGraph(graph)) {
      // 参数写入驱动条件过渡（每帧评估）
      this.anim.setParam("speed", 6);
    }
  }

  onUpdate() {
    // 运行期活对象可直接改写（下一帧评估生效）
    if (this.anim.graph) {
      this.anim.graph.params!.speed = 2;
    }
    // 图模式下 play(状态名) 切换；getParam 读取
    void this.anim.getParam("speed");
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `entry?` | `string` | 入口状态名（缺省首个状态） |
| `states` | `AnimStateDef[]` |  |
| `transitions?` | `AnimTransitionDef[]` |  |
| `params?` | `Record<string, number \| boolean>` | 参数表（数值或布尔；条件评估的输入） |

### interface BoneTransform

骨骼本地变换快照（rotation 为度制欧拉，与节点 transform 同度制）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `position` | `Vec3` |  |
| `rotation` | `Vec3` |  |
| `scale` | `Vec3` |  |

### interface BoneHierarchyEntry

骨骼层级条目（parent 为骨骼名，根骨骼为 null）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` |  |
| `parent` | `string \| null` |  |
| `children` | `string[]` |  |

### interface MorphGroup

形态键分组（某网格的全部形态键名）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `mesh` | `string` | 网格名（未命名网格自动编号 mesh0/mesh1…） |
| `targets` | `string[]` | 形态键名列表（权重按名读写） |

### interface SkinInfo

蒙皮能力摘要

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `boneCount` | `number` |  |
| `boneNames` | `string[]` |  |
| `morphMeshes` | `number` | 含形态键的网格数 |

### interface IKLinkDef

IK 链关节（effector → 根方向的逐级骨骼；rotationMin/Max 为度制欧拉数组）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `bone` | `string` | 关节骨骼名 |
| `rotationMin?` | `number[]` | 旋转下限 [x,y,z]（度；缺省不限） |
| `rotationMax?` | `number[]` | 旋转上限 [x,y,z]（度；缺省不限） |
| `enabled?` | `boolean` | 是否启用该关节（缺省 true） |

### interface IKDef

IK 链定义（CCD 求解；目标点由引擎创建并挂模型根下——局部空间）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, SkeletalAnimation, IKDef } from "tve";

export default class LookAt extends Component {
  anim!: SkeletalAnimation;

  onStart() {
    // 注册 IK 链（CCD 求解）：末端效应器 + 从其父级向根的关节链
    const def: IKDef = {
      name: "headLook",
      effector: "head",
      links: [
        { bone: "neck", rotationMin: [-30, -45, -15], rotationMax: [30, 45, 15] },
        { bone: "spine2", enabled: true },
      ],
      iteration: 2,
    };
    const id = this.anim.addIK(def); // 成功返回 IK id，失败 null
    if (id) {
      // 目标点（模型根局部空间）每帧写入驱动求解
      this.ikId = id;
    }
  }

  private ikId = "";

  onUpdate() {
    if (!this.ikId) return;
    this.anim.setIKTargetPosition(this.ikId, 0.3, 1.6, -0.8);
    // 读取 / 启停 / 清单
    void this.anim.getIKTargetPosition(this.ikId);
    void this.anim.iks; // [{id,name,effector,enabled}]
    // this.anim.setIKEnabled(this.ikId, false);
    // this.anim.removeIK(this.ikId);
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `name?` | `string` | 可选名称（缺省同 id） |
| `effector` | `string` | 末端效应器骨骼名（必填） |
| `links?` | `IKLinkDef[]` | 关节链（从效应器的父级向根方向排列） |
| `iteration?` | `number` | 每帧 CCD 迭代次数（缺省 1） |

### interface IKEntry

IK 链运行态条目

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` |  |
| `name` | `string` |  |
| `effector` | `string` |  |
| `enabled` | `boolean` |  |

### interface BoneAttachOptions

骨骼绑定选项（attachToBone 用）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `keepOffset?` | `boolean` | 保持 attach 时刻的相对位姿（缺省 true；false = 对象原点对齐骨骼原点） |
| `syncRotation?` | `boolean` | 跟随骨骼旋转（缺省 true；false = 仅锚点位置跟随，姿态自主控制） |
| `syncScale?` | `boolean` | 跟随骨骼缩放（缺省 false） |

### interface BoneAttachmentEntry

骨骼绑定运行态条目

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `node` | `string` | 目标节点 id |
| `bone` | `string` | 骨骼名 / IK id / IK name |
| `syncRotation` | `boolean` |  |
| `syncScale` | `boolean` |  |
| `keepOffset` | `boolean` |  |

### interface AnimEventPayload

动画事件负载（finished/loop 回调参数）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `clip` | `string` |  |

### declare class SkeletalAnimation

骨骼动画（模型内嵌动画）门面：单剪辑 anim / 动画图 animGraph 的运行期视图。
仅模型网格节点（source=model）拥有绑定；图模式下 play(状态名) 切换状态，
setParam 写入图参数驱动条件过渡。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, SkeletalAnimation } from "tve";

export default class ActorAnim extends Component {
  // 仅模型网格节点拥有绑定；组件字段运行期自动绑定门面
  anim!: SkeletalAnimation;

  onStart() {
    // 单剪辑模式
    this.anim.clip = "run";      // 模型内嵌剪辑名（写入即切换播放）
    this.anim.speed = 1.2;
    this.anim.loop = "loop";     // loop / once / pingpong
    this.anim.play();            // 缺省取首个剪辑

    void this.anim.clips;        // 模型内嵌剪辑名列表
    void this.anim.currentClip;
    void this.anim.playing;
    void this.anim.hasGraph;     // 是否动画图模式

    // —— 混合层（权重独立于 play/stop）——
    this.anim.fadeIn("walk", 0.25);          // 权重 0→1
    this.anim.fadeOut("run", 0.25);          // 权重→0（动作不停止）
    this.anim.crossFade("run", "walk", 0.3); // 交叉淡化（warp 自动对齐相位）
    this.anim.setWeight("aim", 0.7);         // 直接设权重（确保动作在播）
    void this.anim.getWeight("aim");
    this.anim.setActionSpeed("walk", 1.5);   // 单动作速度（与全局速度相乘）
    this.anim.setActionLoop("attack", "once");
    this.anim.playOneShot("wave");           // 一次性动作：定格末帧后淡回基础层
    this.anim.globalSpeed(1);
    this.anim.stopAction("aim");             // 停止单层

    // 事件订阅（返回注销函数）
    const off1 = this.anim.onFinished((e) => { void e.clip; }); // 播完
    const off2 = this.anim.onLoop((e) => { void e.clip; });     // 循环
    void off1; void off2;

    // 加法混合层（独立权重，如疲劳叠加摆动）
    this.anim.playAdditive("tired", 0.5);
    this.anim.stopAdditive("tired");
  }
}
```

蒙皮完全控制（骨骼/形态键/IK/绑定）：

```ts tve
import { Component, SkeletalAnimation } from "tve";

export default class RigControl extends Component {
  anim!: SkeletalAnimation;

  onStart() {
    void this.anim.skinInfo;   // {boneCount, boneNames, morphMeshes}
    void this.anim.bones;      // 骨骼名列表
    void this.anim.boneHierarchy; // [{name,parent,children}]
    void this.anim.morphs;     // [{mesh, targets}] 形态键清单

    // 骨骼读写（度制欧拉；动作播放中 mixer 每帧覆写被驱动骨骼——
    // 手动写入适用于暂停/未被驱动的骨骼，或每帧覆写场景）
    void this.anim.getBoneTransform("head"); // {position,rotation,scale} 快照
    this.anim.setBoneRotation("head", 0, 15, 0);
    this.anim.resetBone("head");
    this.anim.resetPose();
    void this.anim.getBoneWorldPosition("leftHand");

    // 形态键（0..1 权重；mesh 传 "" 取首个含该目标的网格）
    this.anim.setMorphWeight("", "smile", 0.8);
    void this.anim.getMorphWeight("", "smile");

    // 场景节点绑到骨骼上跟随（装备挂点）
    // this.anim.attachToBone(swordEntity, "rightHand", { keepOffset: true });
    // this.anim.detach(swordEntity);
    void this.anim.attachments;
  }
}
```

#### `constructor()`

@internal 由运行时构造，脚本不要直接 new

#### `entity: Entity`

宿主实体

#### `clips: string[]`

模型内嵌剪辑名列表

#### `currentClip: string | null`

当前播放的剪辑名（图模式为当前状态绑定的剪辑；未播放 null）

#### `playing: boolean`

是否正在播放

#### `get clip(): string`

当前剪辑名（缺省取首个；写入即切换播放，图模式下为目标状态名）

#### `set clip(value: string)`

#### `get speed(): number`

播放速度倍率（当前动作 + 单剪辑设置）

#### `set speed(value: number)`

#### `get loop(): AnimLoopMode`

循环模式：loop/once/pingpong

#### `set loop(value: AnimLoopMode)`

#### `get autoplay(): boolean`

自动播放（影响设置重放路径）

#### `set autoplay(value: boolean)`

#### `hasGraph: boolean`

是否处于动画图模式

#### `graph: AnimGraphDef | null`

动画图活对象（entry/states/transitions/params 可直接改写，下一帧评估生效；无图 null）

#### `play(clipOrState?: string): void`

播放：clip 缺省取首个剪辑；图模式下参数为目标状态名（缺省回入口状态）

#### `pause(): void`

暂停（保留进度；图状态机暂停评估）

#### `resume(): void`

从暂停处继续

#### `stop(): void`

停止并回初始姿势

#### `getParam(name: string): number | boolean | null`

图参数读取（无图/未声明返回 null）

#### `setParam(name: string, value: number \| boolean): void`

图参数写入（布尔/数值；条件评估每帧读取）

#### `ensureGraph(def: AnimGraphDef): boolean`

创建/替换动画图（非法状态/过渡按引擎规则收敛剔除；成功返回 true）

#### `removeGraph(): void`

移除动画图（回单剪辑语义）

#### `addState(state: AnimStateDef): boolean`

新增图状态（{name, clip, speed?, loop?}；重名拒绝，返回是否成功）

#### `removeState(name: string): boolean`

移除图状态（连带剔除涉及它的过渡）

#### `addTransition(transition: AnimTransitionDef): boolean`

新增过渡（from/to 须为已有状态且不同；成功返回 true）

#### `removeTransition(id: string): boolean`

移除过渡（按 id）

#### `skinInfo: SkinInfo | null`

蒙皮能力摘要（{boneCount, boneNames, morphMeshes}；未绑定模型 null）

#### `setWeight(clip: string, w: number): boolean`

动作权重（确保动作在播；0 即静默层。与 play/stop 的 currentClip 语义独立）

#### `getWeight(clip: string): number | null`

动作当前有效权重（淡入淡出进行中的实时值；未命中 null）

#### `fadeIn(clip: string, dur?: number): boolean`

权重 0→1 淡入（缺省 0.25 秒）

#### `fadeOut(clip: string, dur?: number): boolean`

权重→0 淡出（动作本身不停止）

#### `crossFade(from: string, to: string, dur?: number, warp?: boolean): boolean`

交叉淡化 from→to（warp=true 自动对齐两动作相位）

#### `setActionSpeed(clip: string, scale: number): boolean`

单动作播放速度（与 globalSpeed 相乘生效）

#### `setActionLoop(clip: string, mode: AnimLoopMode): boolean`

单动作循环模式（"loop"/"once"/"pingpong"；once 定格末帧）

#### `stopAction(clip: string): boolean`

停止单个动作（不影响其他混合层）

#### `playOneShot(clip: string, fade?: number): boolean`

一次性动作：定格末帧后自动淡回基础动作（表情/挥手等，缺省 0.25 秒过渡）

#### `globalSpeed(scale: number): boolean`

全局播放速度（mixer 速度，影响全部动作）

#### `onFinished(cb: (e: AnimEventPayload) => void): () => void`

订阅动作播完事件（LoopOnce 到达末帧；负载 {clip}），返回注销函数

#### `onLoop(cb: (e: AnimEventPayload) => void): () => void`

订阅动作循环事件（负载 {clip}），返回注销函数

#### `playAdditive(clip: string, weight?: number): boolean`

以加法混合叠加播放剪辑（权重独立于基础层；未转换剪辑惰性 makeClipAdditive）

#### `stopAdditive(clip: string): boolean`

停止加法层动作

#### `bones: string[]`

骨骼名列表（无骨骼返回 []）

#### `boneHierarchy: BoneHierarchyEntry[]`

骨骼层级（[{name,parent,children}]）

#### `getBoneTransform(name: string): BoneTransform | null`

骨骼本地变换快照（未命中 null）

#### `setBonePosition(name: string, x: number, y: number, z: number): boolean`

骨骼本地位移。注意：动作播放中 mixer 每帧覆写被驱动骨骼；手动写入适用于
 暂停/未被驱动的骨骼，或每帧覆写场景（IK/朝向）

#### `setBoneRotation(name: string, x: number, y: number, z: number): boolean`

骨骼本地旋转（度制欧拉）

#### `setBoneScale(name: string, x: number, y: number, z: number): boolean`

骨骼本地缩放

#### `resetBone(name: string): boolean`

复位单个骨骼到绑定姿势

#### `resetPose(): boolean`

复位全部骨骼到绑定姿势

#### `getBoneWorldPosition(name: string): Vec3 | null`

骨骼世界坐标（未命中 null）

#### `morphs: MorphGroup[]`

形态键清单（[{mesh, targets}]）

#### `setMorphWeight(mesh: string, target: string, v: number): boolean`

形态键权重写入（0..1；mesh 传 "" 取首个含该目标的网格）

#### `getMorphWeight(mesh: string, target: string): number | null`

形态键权重读取（未命中 null）

#### `addIK(def: IKDef): string | null`

注册 IK 链（目标点挂模型根下局部空间；成功返回 IK id，失败 null）

#### `removeIK(id: string): boolean`

移除 IK（solver 不再更新）

#### `setIKEnabled(id: string, v: boolean): boolean`

IK 启停

#### `setIKTargetPosition(id: string, x: number, y: number, z: number): boolean`

目标点位置（模型根局部空间）

#### `getIKTargetPosition(id: string): Vec3 | null`

目标点位置读取（未命中 null）

#### `iks: IKEntry[]`

IK 清单（[{id,name,effector,enabled}]）

#### `attachToBone(target: Entity \| string, bone: string, opts?: BoneAttachOptions): boolean`

把场景节点绑到骨骼/IK 目标上每帧跟随（target 为 Entity 或节点 id，须在模型
 子树之外；bone 传骨骼名、IK id 或 IK name；见 BoneAttachOptions）

#### `detach(target: Entity \| string): boolean`

解除节点绑定（target 为 Entity 或节点 id）

#### `attachments: BoneAttachmentEntry[]`

绑定清单（[{node, bone, syncRotation, syncScale, keepOffset}]）

### interface LightAddOptions

addComponent(Light) 创建参数（缺省项回默认）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `kind?` | `"point" \| "directional" \| "spot" \| "ambient"` |  |
| `color?` | `number` | 光色（0xRRGGBB；lightColor 别名） |
| `lightColor?` | `number` |  |
| `intensity?` | `number` |  |
| `cullingMask?` | `number` | 渲染层级掩码（灯光 Culling Mask：只照亮掩码内层的对象；-1 = 全部层） |
| `distance?` | `number` |  |
| `decay?` | `number` |  |
| `angle?` | `number` | 聚光灯光束半角（度） |
| `penumbra?` | `number` |  |
| `castShadow?` | `boolean` |  |
| `shadowStrength?` | `number` | 阴影浓度 0~1 |
| `shadowBias?` | `number` | 阴影深度偏移 |
| `shadowNormalBias?` | `number` | 阴影法线偏移（≤0 = 自动） |
| `shadowNear?` | `number` | 阴影近裁剪面 |
| `shadowRadius?` | `number` | 阴影软化半径（1 = 硬阴影，Soft 档 = 4） |
| `shadowResolution?` | `number` | 阴影贴图分辨率（0 = 自动：平面 2048 / 点光 1024；512~4096 显式档位） |
| `shadowType?` | `"off" \| "hard" \| "soft"` | Shadow 类型档位（优先于 castShadow/shadowRadius） |

### interface AudioSourceAddOptions

addComponent(AudioSource) 创建参数（缺省项回默认）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `source?` | `string` | 音频资产引用（项目内相对路径） |
| `autoplay?` | `boolean` |  |
| `loop?` | `boolean` |  |
| `volume?` | `number` |  |
| `speed?` | `number` |  |
| `spatial?` | `"2d" \| "3d"` |  |
| `refDistance?` | `number` |  |
| `maxDistance?` | `number` |  |
| `rolloff?` | `number` |  |

### interface AnimationClipAddOptions

addComponent(AnimationClip) 创建参数（缺省项回默认）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `clip?` | `string` | .anim 资产相对路径（可后续经门面 clip 写入） |
| `autoplay?` | `boolean` |  |
| `loop?` | `boolean` |  |
| `speed?` | `number` |  |

### interface SkeletalAnimationAddOptions

addComponent(SkeletalAnimation) 创建参数（仅模型网格节点；缺省项回默认）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `clip?` | `string` | 播放剪辑名 / 目标状态名 |
| `autoplay?` | `boolean` |  |
| `speed?` | `number` |  |
| `loop?` | `AnimLoopMode` |  |
| `graph?` | `AnimGraphDef` | 动画图定义（传入即创建动画图模式） |

## engine 入口

### interface TimeState

帧时间信息

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `delta` | `number` | 距上一帧的秒数 |
| `elapsed` | `number` | 运行期累计秒数 |
| `frame` | `number` | 帧序号（从 1 开始） |

### interface PointerState

指针状态（坐标 = 画布内 CSS 像素；pointerId 从按下到抬起恒定，多点触控区分各触点）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |
| `down` | `boolean` |  |
| `pointerId` | `number` |  |

### interface InputApi

键盘与指针输入。按键用 KeyboardEvent.code（如 "KeyW"、"Space"、"ArrowLeft"）。
键盘支持任意多键同时按住（keys / isKeyDown 轮询 + onKeyDown/KeyUp 事件）；
指针支持多点触控（pointers / getPointer 按 pointerId 区分各触点，
鼠标也是其中一个触点，pointerId 通常恒定）。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, engine, math } from "tve";

export default class Controls extends Component {
  private offKey?: () => void;

  onStart() {
    // —— 事件订阅（返回取消订阅函数；指针事件参数为 PointerState）——
    this.offKey = engine.input.onKeyDown((key) => {
      // key 为 KeyboardEvent.code（"KeyW"、"Space"、"ArrowLeft"…）
      if (key === "Space") this.jump();
    });
    // engine.input.onKeyUp((key) => {});
    // engine.input.onPointerDown((p) => {});   // p.x / p.y / p.down / p.pointerId
    // engine.input.onPointerUp((p) => {});
    // engine.input.onPointerMove((p) => {});
    // engine.input.onPointerCancel((p) => {}); // 系统抢占：不会再有 onPointerUp
  }

  onUpdate(delta: number) {
    // —— 轮询 ——
    const w = engine.input.isKeyDown("KeyW");
    const arrow = engine.input.keys.has("ArrowLeft"); // 当前按下集合（实时）
    if (w || arrow) this.entity.translate(0, 0, -2 * delta);

    // 主指针（画布内 CSS 像素，左上原点；跟随最后活跃触点）
    void engine.input.pointer.x;
    void engine.input.pointer.down;

    // 多点触控：pointerId → 状态实时映射（鼠标也是一个触点）
    for (const p of engine.input.pointers.values()) void p.pointerId;
    const first = engine.input.getPointer(0);
    void first;
    void math;
  }

  jump() { /* ... */ }

  onDisable() {
    this.offKey?.(); // 释放订阅
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `isKeyDown(key: string)` | `boolean` | 按键当前是否按下 |
| `keys` | `ReadonlySet<string>` | 当前按下的全部按键（KeyboardEvent.code 实时集合；勿直接修改） |
| `onKeyDown(handler: (key: string) => void)` | `() => void` | 订阅按键按下；返回取消订阅函数 |
| `onKeyUp(handler: (key: string) => void)` | `() => void` | 订阅按键抬起；返回取消订阅函数 |
| `pointer` | `PointerState` | 主指针状态（x/y 跟随最后活跃触点；down = 存在按下中的触点） |
| `pointers` | `ReadonlyMap<number, PointerState>` | 按下中的全部触点（pointerId → 状态 实时映射；勿直接修改） |
| `getPointer(pointerId: number)` | `PointerState \| null` | 按 pointerId 查触点（未按下返回 null） |
| `onPointerDown(handler: (pointer: PointerState) => void)` | `() => void` | 订阅指针按下；返回取消订阅函数 |
| `onPointerUp(handler: (pointer: PointerState) => void)` | `() => void` | 订阅指针抬起；返回取消订阅函数 |
| `onPointerCancel(handler: (pointer: PointerState) => void)` | `() => void` | 订阅指针取消（系统抢占：浏览器手势等；触点被强制移除，不会再来 onPointerUp）；返回取消订阅函数 |
| `onPointerMove(handler: (pointer: PointerState) => void)` | `() => void` | 订阅指针移动；返回取消订阅函数 |

### interface SceneApi

场景查询

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, engine, CameraNode, Light, MeshNode } from "tve";

export default class SceneQuery extends Component {
  onStart() {
    // 根实体（空场景 null）
    void engine.scene.root;

    // 按名称/路径查找（语义同 Entity.find；深度优先）
    const cam = engine.scene.find(" Cameras/Main");
    if (cam instanceof CameraNode) cam.lookAt({ x: 0, y: 0, z: 0 });

    // 全量快照
    void engine.scene.findAll().length;

    // 按标签查（检查器 Node 卡设置 tag）
    const enemy = engine.scene.findByTag("enemy");      // 第一个命中
    void engine.scene.findAllByTag("enemy").length;     // 文档序全量

    // 按类型查组件（token = 脚本类/源路径/类名/内置门面类/类型键）
    const sun = engine.scene.findComponent(Light);      // 文档序第一个
    void engine.scene.findComponents(Light).length;     // 全量
    const hp = engine.scene.findComponent("HPBar");     // 按脚本类名
    void hp;
    void MeshNode;
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `root` | `Entity \| null` | 根实体（空场景为 null） |
| `find(nameOrPath: string)` | `Entity \| null` | 从根开始按名称/路径查找（语义同 Entity.find） |
| `findAll()` | `Entity[]` | 全部实体（快照数组） |
| `findByTag(tag: string)` | `Entity \| null` | 按标签查实体（返回第一个命中；无命中/空标签返回 null） |
| `findAllByTag(tag: string)` | `Entity[]` | 按标签查实体（文档序全量；无命中返回空数组） |
| `findComponent(token: string \| ComponentClass \| (new (...args: never[]) => Component))` | `Component \| RigidBody \| Collider \| Light \| AudioSource \| AnimationClip \| SkeletalAnimation \| null` | 全场景按类型查组件：token = 脚本类 / 脚本源路径 / 脚本类名 / 内置组件门面类 / 类型键；返回文档序第一个命中 （未命中 null）。 |
| `findComponents(token: string \| ComponentClass \| (new (...args: never[]) => Component))` | `Array<Component \| RigidBody \| Collider \| Light \| AudioSource \| AnimationClip \| SkeletalAnimation>` | 全场景按类型查组件（文档序全量；无命中返回空数组） |

### interface AnimationApi

模型动画运行期控制（按实体寻址；仅模型网格节点有效）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, MeshNode, engine } from "tve";

export default class AnimControl extends Component {
  @property({ type: MeshNode, label: "角色（模型网格）" })
  actor: MeshNode | null = null;

  onStart() {
    if (!this.actor) return;
    // 模型动画运行期控制（按实体寻址；仅模型网格节点有效）
    engine.animation.play(this.actor, "run"); // 图模式 = 目标状态名；缺省取首个剪辑
    // engine.animation.pause(this.actor);
    // engine.animation.resume(this.actor);
    // engine.animation.stop(this.actor);   // 回初始姿势
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `play(entity: Entity, clip?: string)` | `void` | 播放（单剪辑模式 clip = 剪辑名缺省取首个；动画图模式 clip = 目标状态名） |
| `stop(entity: Entity)` | `void` | 停止并回到初始姿势 |
| `pause(entity: Entity)` | `void` | 暂停（保留当前进度） |
| `resume(entity: Entity)` | `void` | 从暂停处继续 |

### interface AudioApi

音频运行期控制（按实体寻址；音源节点与挂音源组件的节点有效，
实体上多个音源时寻址首个）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, MeshNode, engine } from "tve";

export default class Bgm extends Component {
  @property({ type: MeshNode, label: "音源节点" })
  source: MeshNode | null = null;

  onStart() {
    if (!this.source) return;
    // 音频运行期控制（按实体寻址：音源节点或挂音源组件的节点）
    engine.audio.play(this.source);
    engine.audio.setVolume(this.source, 0.5); // 运行时音量（不落盘）
    // engine.audio.pause(this.source);
    // engine.audio.resume(this.source);
    // engine.audio.stop(this.source);
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `play(entity: Entity)` | `void` | 播放（暂停态续播；停止/播完态从头播） |
| `stop(entity: Entity)` | `void` | 停止并回到起点 |
| `pause(entity: Entity)` | `void` | 暂停（保留当前进度） |
| `resume(entity: Entity)` | `void` | 从暂停处继续 |
| `setVolume(entity: Entity, volume: number)` | `void` | 运行时音量（0~1；不落盘） |

### interface ParticlesApi

粒子系统运行期控制（按实体寻址；仅粒子系统节点有效）。
拿到 {@link ParticleSystemNode} 实体时也可直接调用其同名方法/属性。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, ParticleSystemNode, engine, ParticleSettings } from "tve";

export default class FxControl extends Component {
  @property({ type: ParticleSystemNode, label: "烟尘特效" })
  smoke: ParticleSystemNode | null = null;

  onStart() {
    if (!this.smoke) return;
    // 按实体寻址的运行期控制（与节点句柄同名方法等价）
    engine.particles.play(this.smoke);
    // engine.particles.pause(this.smoke);
    // engine.particles.stop(this.smoke);   // 停止发射，存活粒子自然消亡
    // engine.particles.restart(this.smoke);
    // engine.particles.clear(this.smoke);

    // 运行态快照（非粒子节点 null）
    void engine.particles.stateOf(this.smoke); // {playing,paused,finished,alive,time}

    // 合并发射设置（子集；运行态生效不回写场景文件）
    const patch: Partial<ParticleSettings> = { emissionRate: 120, startColor: 0x999999 };
    engine.particles.setSettings(this.smoke, patch);
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `play(entity: Entity)` | `void` | 播放（暂停态续播；停止/播完态从头开始） |
| `pause(entity: Entity)` | `void` | 暂停（保留当前粒子） |
| `stop(entity: Entity)` | `void` | 停止发射（存活粒子自然消亡） |
| `restart(entity: Entity)` | `void` | 清空粒子并从头开始 |
| `clear(entity: Entity)` | `void` | 立即清空全部粒子 |
| `stateOf(entity: Entity)` | `ParticleState \| null` | 运行态（非粒子节点返回 null） |
| `setSettings(entity: Entity, patch: Partial<ParticleSettings>)` | `void` | 合并发射设置（子集；运行态生效，不回写场景文件） |

### interface PhysicsApi

物理运行期控制（按实体寻址；仅挂了刚体组件的节点有效）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, CameraNode, engine } from "tve";

export default class ClickMove extends Component {
  @property({ type: CameraNode, label: "相机" })
  cam: CameraNode | null = null;

  onFixedUpdate() {
    if (!this.cam) return;
    // —— 施力/速度（动力学体；放固定步长回调）——
    // engine.physics.applyImpulse(this.entity, 0, 5, 0);  // 冲量（N·s，世界空间）
    // engine.physics.applyForce(this.entity, 0, -9.8, 0); // 持续力（N，每帧调用）
    // engine.physics.setLinearVelocity(this.entity, 0, 0, 5);   // m/s
    // engine.physics.setAngularVelocity(this.entity, 0, 3, 0); // rad/s
    void engine.physics.getLinearVelocity(this.entity); // Vec3 | null
    void engine.physics.bodyInfo(this.entity); // {mode,gravityScale,colliderCount} | null
    // engine.physics.setGravityScale(this.entity, 0); // 0 = 不受重力
    // engine.physics.wakeUp(this.entity);             // 修改参数后唤醒睡眠体
    // engine.physics.setGravity(0, -9.8, 0);          // 世界重力（影响全部动力学体）
  }

  onUpdate() {
    // —— 射线投射（拾取/视线检测）——
    if (!this.cam || !engine.input.pointer.down) return;
    const ray = this.cam.screenToRay(engine.input.pointer.x, engine.input.pointer.y);
    if (!ray) return;
    const hits = engine.physics.castRay({
      origin: ray.origin,
      direction: ray.direction,
      maxDistance: 100,
      excludeNodeIds: [this.entity.id], // 排除自身
    });
    void hits; // PhysicsRayHit[]：按距离升序（nodeId/point/normal/distance）
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `applyImpulse(entity: Entity, x: number, y: number, z: number)` | `void` | 施加冲量（世界空间，N·s；动力学体） |
| `applyForce(entity: Entity, x: number, y: number, z: number)` | `void` | 施加持续力（世界空间，N；动力学体，每帧调用生效） |
| `setLinearVelocity(entity: Entity, x: number, y: number, z: number)` | `void` | 直接设置线速度（m/s） |
| `setAngularVelocity(entity: Entity, x: number, y: number, z: number)` | `void` | 直接设置角速度（rad/s） |
| `getLinearVelocity(entity: Entity)` | `Vec3 \| null` | 读取线速度（未绑定/世界未就绪返回 null） |
| `bodyInfo(entity: Entity)` | `{ mode: "static" \| "kinematic" \| "dynamic"; gravityScale: number; colliderCount: number } \| null` | 节点物理体信息（未绑定刚体/碰撞体返回 null） |
| `setGravityScale(entity: Entity, scale: number)` | `void` | 重力缩放（0 = 不受重力） |
| `wakeUp(entity: Entity)` | `void` | 唤醒（修改参数后让睡眠中的体立即响应） |
| `setGravity(x: number, y: number, z: number)` | `void` | 世界重力（影响全部动力学体） |
| `castRay(options: { /** 射线起点（世界空间） */ origin: Vec3; /** 射线方向（世界空间；无需归一化） */ direction: Vec3; /** 最大距离（缺省 Infinity） */ maxDistance?: number; /** 返回所有命中（缺省 false = 仅最近命中；当前仅返回最近命中） */ allHits?: boolean; /** 排除的节点 id 列表（不参与命中） */ excludeNodeIds?: string[]; })` | `PhysicsRayHit[] \| Promise<PhysicsRayHit[]>` | 射线投射（世界空间；返回按距离升序排列的命中列表；空数组 = 未命中） |

### interface PhysicsRayHit

物理射线命中结果（世界空间）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `nodeId` | `string` | 命中刚体所属节点 id |
| `point` | `Vec3` | 命中点世界坐标 |
| `normal` | `Vec3` | 命中面法线（世界空间，归一化） |
| `distance` | `number` | 沿射线从起点到命中点的世界距离 |

### interface UIScreenMetrics

UI 画布屏幕度量（屏幕像素 ↔ UI 单位换算用；随窗口尺寸/缩放模式变化，建议每帧读取）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `width` | `number` | 渲染画布 CSS 尺寸（屏幕像素；与 engine.input.pointer 同一空间） |
| `height` | `number` |  |
| `rootWidth` | `number` | 屏幕矩形在 UI 单位下的尺寸（由缩放模式与窗口比例决定） |
| `rootHeight` | `number` |  |
| `pxPerUnitX` | `number` | 每单位像素数（= width/rootWidth、height/rootHeight） |
| `pxPerUnitY` | `number` |  |
| `scaleMode` | `UIScaleMode` | 画布缩放模式 |
| `designWidth` | `number` | 设计尺寸（设计像素，100px = 1 UI 单位） |
| `designHeight` | `number` |  |

### interface UIRect

UI 矩形（画布局部空间：原点 = 画布中心，y 向上；单位 = UI 单位）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `cx` | `number` | 中心（画布局部） |
| `cy` | `number` |  |
| `w` | `number` | 宽高（UI 单位） |
| `h` | `number` |  |

### interface UIPoint

二维坐标（画布局部空间：原点 = 画布中心，y 向上；单位 = UI 单位）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |

### interface UIApi

UI 运行期控制（画布叠加序读写 + 按钮点击订阅 + 布局/坐标查询；按实体寻址）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, property, UICanvasNode, UITextNode, engine } from "tve";

export default class UiRuntime extends Component {
  @property({ type: UITextNode, label: "提示文本" })
  tip: UITextNode | null = null;

  onStart() {
    if (!this.tip) return;
    // 合并 Widget 设置（子集；运行态生效不回写场景文件）
    engine.ui.set(this.tip, { text: "按 E 交互", color: 0xffcc00, fontSize: 24 });
    // 读取当前设置快照（非 UI 节点 null）
    void engine.ui.get(this.tip);

    // 按钮点击订阅 / 解绑（仅 uiButtonNode 且 interactable）
    // const off = engine.ui.onClick(btn, () => {});
    // engine.ui.offClick(btn, handler);
  }

  onUpdate() {
    if (!this.tip) return;
    // 解析矩形（画布局部：原点在中心，y 向上，UI 单位；布局容器子节点返回槽位矩形）
    const r = engine.ui.rectOf(this.tip);
    // 屏幕度量（随窗口/缩放模式变化，建议每帧读取）
    const m = engine.ui.metricsOf(this.tip);
    // 屏幕像素 → 画布局部 UI 坐标（与 engine.input.pointer 同一像素空间）
    const p = engine.ui.screenToUi(this.tip, engine.input.pointer.x, engine.input.pointer.y);
    if (r && p) {
      const inside = Math.abs(p.x - r.cx) <= r.w / 2 && Math.abs(p.y - r.cy) <= r.h / 2;
      engine.ui.set(this.tip, { color: inside ? 0xffffff : 0x888888 });
    }
    void m;
  }
}
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `set(entity: Entity, patch: Record<string, unknown>)` | `void` | 合并 Widget/画布设置（子集；运行态生效，不回写场景文件） |
| `get(entity: Entity)` | `Record<string, unknown> \| null` | 读取 Widget/画布当前设置快照（非 UI 节点返回 null） |
| `onClick(entity: Entity, cb: () => void)` | `() => void` | 订阅按钮点击（仅 uiButtonNode 且 interactable；返回解绑函数） |
| `offClick(entity: Entity, cb: () => void)` | `void` | 解除按钮点击订阅 |
| `rectOf(entity: Entity)` | `UIRect \| null` | UI 节点的解析矩形（画布局部空间）：锚点/拉伸/布局容器解析后的实际渲染矩形。 沿途经过的布局容器（横/竖/网格排列）子节点返回的是布局槽位矩形。 非 UI 节点、不在画布子树内或首帧布局解析未完成时返回 null。 |
| `metricsOf(entity: Entity)` | `UIScreenMetrics \| null` | 实体所在 UI 画布（沿父链向上）的屏幕度量。 屏幕像素 → UI 单位：ui = (px - width/2) / pxPerUnitX（y 轴取反）； 非 UI 节点返回 null。 |
| `screenToUi(entity: Entity, x: number, y: number)` | `UIPoint \| null` | 屏幕像素坐标 → 画布局部 UI 坐标（x/y 与 engine.input.pointer 同一空间； 结果原点 = 画布中心，y 向上，可直接与 rectOf 结果做包含/距离判定）。 entity 用于定位所在画布；非 UI 节点返回 null。 |

### interface PlayableAdApi

试玩广告宿主契约（playable 渠道产物可用；其他产物/预览全部安全空转）。
用法：在结束卡（EndCard）的下载按钮点击处理里调 {@link PlayableAdApi.cta}，
运行时自动映射到所在广告平台的宿主函数（mraid.open / FbPlayableAd /
ExitApi.exit / window.install），商店跳转由广告宿主接管。

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { engine } from "tve";

// 试玩广告宿主契约（playable 渠道产物激活；其他产物/预览安全空转）
engine.playableAd.host; // => "web"（非广告环境：编辑器预览 / 本机自测导出）
engine.playableAd.isViewable(); // => true

// 结束卡（EndCard）「下载」按钮的点击处理里调用：
// 运行时自动映射所在平台宿主（mraid.open / FbPlayableAd / ExitApi.exit /
// window.install），商店跳转由广告宿主接管；无宿主环境空转并在控制台提示，
// 不抛错
engine.playableAd.cta();

// 订阅广告位可见性变化（mraid 广告位滚出屏幕等；返回解绑函数）
const unbind = engine.playableAd.onViewableChange((viewable) => {
  if (!viewable) engine.tween.pauseAll();
  else engine.tween.resumeAll();
});
unbind();

// 生命周期打点上报（转发平台宿主通道 + 控制台留痕）：
// gameStart 由运行时在宿主落定后自动上报一次；结束/重玩按时机手动调，
// 自定义事件名与附加数据也接受（无宿主环境仅在控制台留痕）
engine.playableAd.report("gameOver", { score: 100 });
engine.playableAd.report("level_complete", { level: 3 });
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `host` | `string` | 探测到的宿主平台："mraid" / "meta" / "google" / "mintegral"；"web" = 非广告环境 |
| `cta()` | `void` | 结束卡「下载/安装」按钮点击：映射到广告宿主的安装跳转；无宿主（web 自测环境）空转并在控制台提示。 |
| `isViewable()` | `boolean` | 广告位当前是否可见（mraid 跟随 viewableChange；其余平台恒 true） |
| `onViewableChange(cb: (viewable: boolean) => void)` | `() => void` | 订阅广告位可见性变化（mraid 广告位滚出屏幕等；返回解绑函数）。 ```ts import { Component, engine } from "tve"; export default class EndCard extends Component { private unbind: (() => void) \| null = null; onStart() { // 广告位被移出屏幕时暂停结束卡上的补间动画 this.unbind = engine.playableAd.onViewableChange((viewable) => { if (!viewable) engine.tween.pauseAll(); else engine.tween.resumeAll(); }); } onDownloadClick() { engine.playableAd.cta();   // 自动映射 mraid.open / FbPlayableAd / ExitApi } onDestroy() { this.unbind?.(); } } ``` |
| `report(event: string, data?: Record<string, unknown>)` | `void` | 生命周期事件打点上报：转发到所在平台宿主的上报通道，并在控制台留痕。 gameStart 在宿主落定后由运行时自动上报一次（无需手动调）；脚本在结束卡 出现时上报 gameOver、重玩时上报 gameRestart；也接受自定义事件名 + 附加 数据（平台映射随适配器：Mintegral 的 gameOver/gameEnd 转发 window.gameEnd， 其余平台当前无游戏事件 API 只留痕）。 |

### interface EngineApi

引擎入口（时间 / 输入 / 场景 / 动画 / 音频 / 粒子 / 物理 / UI / 逻辑 / 补间 / 日志）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { Component, engine, math, tween, MeshNode, CameraNode } from "tve";

export default class EngineTour extends Component {
  onStart() {
    // 时间（只读）
    void engine.time.delta;   // 距上一帧秒数
    void engine.time.elapsed; // 累计秒数
    void engine.time.frame;   // 帧序号（从 1 起）

    // 各系统入口（详见对应专题文档）
    void engine.input;        // 键盘/指针
    void engine.scene;        // 场景查询
    void engine.animation;    // 模型动画
    void engine.audio;        // 音频
    void engine.particles;    // 粒子
    void engine.physics;      // 物理
    void engine.ui;           // UI 运行期
    void engine.logic;        // 状态机/行为树
    void engine.tween;        // 补间（与顶层导出 tween 同一对象）

    // 日志 → 编辑器控制台（预览）/ 浏览器控制台（发布产物）
    engine.log("就绪", engine.time.frame);
    engine.warn("低血量");
    engine.error("异常");

    void math;
    void MeshNode;
    void CameraNode;
  }
}
```

无宿主空转语义（doctest 实测：预览之外的环境安全降级）：

```ts tve
import { engine } from "tve";

// 未注入场景宿主时各查询安全空转，不抛错
engine.scene.root;          // => null
engine.scene.find("任意");   // => null
engine.scene.findAll();     // => []
engine.scene.findAllByTag("x"); // => []
engine.time.frame;          // => 0
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `time` | `TimeState` |  |
| `input` | `InputApi` |  |
| `scene` | `SceneApi` |  |
| `animation` | `AnimationApi` |  |
| `audio` | `AudioApi` |  |
| `particles` | `ParticlesApi` |  |
| `physics` | `PhysicsApi` |  |
| `ui` | `UIApi` |  |
| `logic` | `LogicApi` | 逻辑运行器（状态机/行为树）控制，详见 {@link LogicApi} |
| `playableAd` | `PlayableAdApi` | 试玩广告宿主契约（playable 渠道产物可用），详见 {@link PlayableAdApi} |
| `tween` | `TweenApi` | 补间动画（与顶层导出 tween 同一对象，详见 {@link TweenApi}） |
| `log(...args: unknown[])` | `void` | 输出到编辑器控制台（预览）/ 浏览器控制台（发布产物） |
| `warn(...args: unknown[])` | `void` |  |
| `error(...args: unknown[])` | `void` |  |

### engine

```ts
const engine: EngineApi;
```

引擎全局入口

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { engine, VERSION } from "tve";

// 引擎全局入口：时间 / 输入 / 场景 / 动画 / 音频 / 粒子 / 物理 / UI / 逻辑 / 补间 / 日志
engine.time;      // TimeState（delta/elapsed/frame）
engine.input;     // InputApi
engine.scene;     // SceneApi
engine.animation; // AnimationApi
engine.audio;     // AudioApi
engine.particles; // ParticlesApi
engine.physics;   // PhysicsApi
engine.ui;        // UIApi
engine.logic;     // LogicApi
engine.tween;     // TweenApi（与顶层 tween 同一对象）

VERSION; // => "1.4.0"

// 无宿主安全空转（doctest 实测）
engine.scene.root; // => null
```

### math

```ts
const math: MathApi;
```

向量数学库（纯函数，详见 {@link MathApi}）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { math } from "tve";

// 距离判定用平方（免开方）
math.distanceSq(math.zero, math.v3(3, 4, 0)); // => 25

// 插值与移动
math.lerp(math.zero, math.v3(10, 0, 0), 0.5);        // => {"x":5,"y":0,"z":0}
math.moveTowards(math.zero, math.v3(10, 0, 0), 3);   // => {"x":3,"y":0,"z":0}
math.equals(math.v3(0, 0, 0), math.v3(1e-9, 0, 0));  // => true（缺省 1e-6 容差）

// 标量与角度（度制，与 Entity.rotation 同约定）
math.clamp(15, 0, 10);              // => 10
math.deltaAngle(359, 0);            // => 1（最短方向）
math.moveTowardsAngle(170, 190, 5); // => 175
math.deadZone(0.05, 0.15);          // => 0（死区内归零）
math.degToRad(180);                 // => 3.141592653589793
math.radToDeg(Math.PI / 2);         // => 90

// 矩阵（列主序 16 数组）
math.mat4().length; // => 16
```

在组件里配合帧参数的典型用法：

```ts tve
import { Component, property, math, MeshNode } from "tve";

export default class Follow extends Component {
  @property({ type: MeshNode, label: "跟随目标" })
  target: MeshNode | null = null;

  @property({ label: "速度（米/秒）", min: 0 })
  speed = 3;

  onUpdate(delta: number) {
    if (!this.target) return;
    // 匀速逼近目标（帧率无关）
    this.entity.position = math.moveTowards(
      this.entity.position,
      this.target.position,
      this.speed * delta,
    );
  }
}
```

### VERSION

```ts
const VERSION: string;
```

SDK 版本（与编辑器/播放器同版发布）

**示例**（doctest：随文档测试套件逐块验证）

```ts tve
import { VERSION } from "tve";

// SDK 版本（与编辑器/播放器同版发布）
VERSION; // => "1.4.0"
```
