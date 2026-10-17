# engine 入口

`engine` 是脚本的全局系统入口（时间 / 输入 / 场景 / 动画 / 音频 / 粒子 / 物理 / UI / 逻辑 / 补间 / 日志）。全部子系统**按实体（Entity）寻址**：拿到实体句柄（`@property` 节点引用、`engine.scene.find` 等）后传入各 API。

## 时间：engine.time

```ts tve
import { engine } from "tve";

engine.time.delta;    // 距上一帧的秒数（与 onUpdate(delta) 的参数相同）
engine.time.elapsed;  // 运行期累计秒数
engine.time.frame;    // 帧序号（从 1 开始；无宿主时 0）
```

典型用法：把「每 N 秒执行一次」改成基于累计时间的调度，避免 setTimeout 与帧循环脱节：

```ts tve
import { Component, engine } from "tve";

export default class Spawner extends Component {
  private next = 0;

  onUpdate() {
    if (engine.time.elapsed >= this.next) {
      this.next += 2;        // 每 2 秒
      this.spawn();
    }
  }

  spawn() { /* ... */ }
}
```

## 输入：engine.input

按键用 `KeyboardEvent.code`（如 `"KeyW"`、`"Space"`、`"ArrowLeft"`、`"Digit1"`、`"ShiftLeft"`），支持任意多键同时按住。指针支持**多点触控**：每个触点按 `pointerId` 区分（从按下到抬起恒定；鼠标也是触点之一），坐标为**画布内 CSS 像素**（左上角原点），与 `engine.ui.screenToUi` 的入参同一空间。

```ts tve
import { engine, PointerState } from "tve";

// 轮询：按键当前是否按下（多键组合直接连查）
engine.input.isKeyDown("KeyW");   // => false（无宿主环境实测）
engine.input.keys.size;           // => 0（当前按下的全部按键，Set 实时视图）

// 订阅（均返回取消订阅函数；onDisable/onDestroy 中调用以免悬挂）
const off = engine.input.onKeyDown((key: string) => { /* 按下（每键各触发一次） */ });
const off2 = engine.input.onKeyUp((key: string) => {});
off(); off2();

// 主指针（跟随最后活跃触点）与多点触控表
void engine.input.pointer;                 // { x, y, down, pointerId }
void engine.input.pointers;                // Map<pointerId, PointerState>（按下中的触点）
void engine.input.getPointer(0);           // 按 id 查触点（未按下 null）
const onP = (handler: (p: PointerState) => void) => {
  const offP = engine.input.onPointerDown(handler); // 每触点各触发
  return offP;
};
void onP;
// 另有 onPointerUp / onPointerCancel / onPointerMove（参数同 PointerState）
```

订阅函数均返回取消订阅函数；请在 `onDisable`/`onDestroy` 中调用以免悬挂。

```ts tve
import { Component, engine, property } from "tve";

export default class PlayerInput extends Component {
  @property({ label: "速度（米/秒）", min: 0 })
  speed = 4;

  private off?: () => void;
  private prevDist = 0;
  @property({ label: "缩放倍率", min: 0.1 })
  zoom = 1;

  // WASD 轮询移动（每帧查询；多个 isKeyDown 组合即多键输入）
  onUpdate(delta: number) {
    const x = (engine.input.isKeyDown("KeyD") ? 1 : 0) - (engine.input.isKeyDown("KeyA") ? 1 : 0);
    const z = (engine.input.isKeyDown("KeyS") ? 1 : 0) - (engine.input.isKeyDown("KeyW") ? 1 : 0);
    if (x || z) this.entity.translate(x * this.speed * delta, 0, z * this.speed * delta);

    // 双指捏合缩放（pointers 里始终是按下中的触点）
    const ps = engine.input.pointers;
    if (ps.size !== 2) {
      this.prevDist = 0;        // 手指离开后重置，下次捏合从当前距离起算
      return;
    }
    const [a, b] = [...ps.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.prevDist > 0) this.zoom *= dist / this.prevDist;
    this.prevDist = dist;
  }

  // 事件式点击（一次性交互）
  onEnable() { this.off = engine.input.onPointerDown((p) => this.tryPick(p.x, p.y)); }
  onDisable() { this.off?.(); }

  tryPick(x: number, y: number) { void x; void y; }
}
```

按 `pointerId` 做逐指追踪时，`onPointerUp` 与 `onPointerCancel` 都要订阅（cancel 后不会再有 up），用 `pointer` 参数里的 `pointerId` 匹配自己按住的那根手指。

## 场景：engine.scene

详见[实体与查询](entity.md)：`root` / `find` / `findAll` / `findByTag` / `findAllByTag` / `findComponent` / `findComponents`。

## 模型动画：engine.animation

按实体寻址；仅模型网格节点（模型内嵌动画）有效。

```ts tve
import { Component, engine, property, MeshNode } from "tve";

export default class AnimRunner extends Component {
  @property({ type: MeshNode, label: "角色（模型网格）" })
  actor: MeshNode | null = null;

  onStart() {
    if (!this.actor) return;
    engine.animation.play(this.actor, "Run"); // 单剪辑模式 clip = 剪辑名（缺省取首个）；
                                              // 动画图模式 clip = 目标状态名
    // engine.animation.stop(this.actor);     // 停止并回初始姿势
    // engine.animation.pause(this.actor);    // 暂停（保留进度）
    // engine.animation.resume(this.actor);   // 继续
  }
}
```

更细的控制（进度、倍速、循环模式、动画图参数、蒙皮/IK）见[内置组件门面](components.md)的 `SkeletalAnimation`；关键帧 `.anim` 剪辑用 `AnimationClip` 门面（两者互不相关）。

## 音频：engine.audio

按实体寻址；音源节点与挂「音源」组件的节点有效，实体上多个音源时寻址首个（需要精确控制某个音源用 `getComponent(AudioSource)`）。

```ts tve
import { Component, engine, property, MeshNode } from "tve";

export default class BgmControl extends Component {
  @property({ type: MeshNode, label: "音源节点" })
  source: MeshNode | null = null;

  onStart() {
    if (!this.source) return;
    engine.audio.play(this.source);            // 暂停态续播；停止/播完态从头播
    engine.audio.setVolume(this.source, 0.5);  // 运行时音量 0~1（不落盘）
    // engine.audio.stop(this.source);
    // engine.audio.pause(this.source);
    // engine.audio.resume(this.source);
  }
}
```

## 粒子：engine.particles

按实体寻址；仅粒子系统节点有效。拿到 `ParticleSystemNode` 实体时也可直接调用其同名方法/属性（见 [实体与查询](entity.md)）。

```ts tve
import { Component, engine, property, ParticleSystemNode } from "tve";

export default class FxRunner extends Component {
  @property({ type: ParticleSystemNode, label: "烟尘" })
  fx: ParticleSystemNode | null = null;

  onStart() {
    if (!this.fx) return;
    engine.particles.play(this.fx);       // 暂停态续播；停止/播完态从头开始
    // engine.particles.pause(this.fx);
    // engine.particles.stop(this.fx);    // 停止发射，存活粒子自然消亡
    // engine.particles.restart(this.fx); // 清空并从头开始
    // engine.particles.clear(this.fx);   // 立即清空

    void engine.particles.stateOf(this.fx); // { playing, paused, finished, alive, time } | null

    // 运行态合并发射设置（子集；不落盘）
    engine.particles.setSettings(this.fx, { emissionRate: 50, startColor: 0x66ccff });
  }
}
```

`stateOf` 的 `finished` 在「非循环系统发射完毕且粒子全部消亡」时为 true，配合 `restart()` 可做「播完一轮再来一轮」的节奏控制。

## 物理：engine.physics

按实体寻址；仅挂了「刚体」组件的节点有效（需要项目设置启用物理）。

```ts tve
import { Component, engine } from "tve";

export default class PhysRunner extends Component {
  onFixedUpdate() {
    const e = this.entity;
    // 施力/速度写入放固定步长（1/60s，与物理步进同频）
    engine.physics.applyImpulse(e, 0, 5, 0);      // 冲量（世界空间，N·s；动力学体）
    engine.physics.applyForce(e, 0, -9.8, 0);     // 持续力（N；每帧调用才持续生效）
    engine.physics.setLinearVelocity(e, 0, 0, 5); // 线速度（m/s）
    engine.physics.setAngularVelocity(e, 0, 3, 0);// 角速度（rad/s）
    void engine.physics.getLinearVelocity(e);     // Vec3 | null
    void engine.physics.bodyInfo(e);              // { mode, gravityScale, colliderCount } | null
    engine.physics.setGravityScale(e, 0);         // 重力缩放（0 = 不受重力）
    engine.physics.wakeUp(e);                     // 修改参数后唤醒睡眠体
    engine.physics.setGravity(0, -9.81, 0);       // 世界重力（影响全部动力学体）
  }
}
```

| 方法 | 典型场景 |
| --- | --- |
| `applyImpulse` | 跳跃、爆炸击飞（一次性冲量，质量越大效果越弱） |
| `applyForce` | 推力/浮力/风力（**每帧调用**才持续生效） |
| `setLinearVelocity` | 直接控制速度（平台跳跃的空中控制、传送带） |
| `setGravityScale` | 局部失重/下落加速（0 = 悬浮） |
| `wakeUp` | 物理引擎会休眠静止的体；脚本改完参数/落点后调一次确保响应 |
| `castRay` | 射线拾取/视线检测/武器命中（返回命中节点 id + 世界坐标 + 法线 + 距离） |

`RigidBody` 门面上有绑定本实体的同名接口（`setLinearVelocity` / `applyImpulse` / `setGravityScale` / `wakeUp` 等），见[内置组件门面](components.md)。

### 射线投射

`castRay` 是世界级查询（不按实体寻址），对物理世界中所有碰撞体做射线检测，返回按距离升序排列的命中列表。三后端（Rapier / Jolt / Ammo.js）同一 API、同一返回结构。

```ts tve
import { Component, engine, PhysicsRayHit } from "tve";

export default class RayDemo extends Component {
  fire() {
    const hits = engine.physics.castRay({
      origin: { x: 0, y: 10, z: 0 },            // 起点（世界空间）
      direction: { x: 0, y: -1, z: 0 },         // 方向（无需归一化）
      maxDistance: 20,                           // 最大距离（缺省 Infinity）
      excludeNodeIds: [this.entity.id],         // 排除自身（如从角色眼睛发射时排除角色体）
    }) as PhysicsRayHit[];                       // Worker 模式返回 Promise，主线程同步数组
    if (hits.length > 0) {
      const hit = hits[0];                       // 最近命中（列表按距离升序）
      engine.log("命中节点", hit.nodeId, "距离", hit.distance);
      // hit.point  — 命中点世界坐标 { x, y, z }
      // hit.normal — 命中面法线（世界空间，归一化）
    }
  }
}
```

典型用法——鼠标点击拾取物理体（从相机发射射线）：

```ts tve
import { Component, engine, property, CameraNode, Entity } from "tve";

export default class ClickPick extends Component {
  @property({ type: CameraNode, label: "相机" })
  cam: CameraNode | null = null;

  private off?: () => void;

  onEnable() {
    // 事件订阅放 onEnable（onUpdate 内重复订阅会越积越多——常见错误）
    this.off = engine.input.onPointerDown((p) => this.pick(p.x, p.y));
  }

  onDisable() { this.off?.(); }

  pick(x: number, y: number) {
    if (!this.cam) return;
    const ray = this.cam.screenToRay(x, y);   // 屏幕像素 → 世界射线
    if (!ray) return;
    const hits = engine.physics.castRay({
      origin: ray.origin,
      direction: ray.direction,
      maxDistance: 100,
    }) as { nodeId: string }[];
    if (hits.length > 0) {
      const target = engine.scene.find(hits[0].nodeId); // find 名称未命中按节点 id 回退
      if (target) this.select(target);
    }
  }

  select(target: Entity) { void target; }
}
```

> **Worker 模式**：物理模拟在独立线程运行时，`castRay` 返回 `Promise`（射线查询异步转发到 Worker 执行）；主线程模式同步返回数组。两种模式参数与返回结构一致。

## UI：engine.ui

按实体寻址；画布与 Widget（图片/文本/按钮/布局容器）设置 + 按钮点击订阅。节点类字段与示例详见 [UI](ui.md)。

```ts tve
import { Component, engine, property, UITextNode, UIButtonNode } from "tve";

export default class UiRunner extends Component {
  @property({ type: UITextNode, label: "提示文本" })
  tip: UITextNode | null = null;

  @property({ type: UIButtonNode, label: "按钮" })
  btn: UIButtonNode | null = null;

  onStart() {
    if (!this.tip) return;
    engine.ui.set(this.tip, { text: "New", color: 0x66ccff }); // 合并设置（子集；运行态，不落盘）
    void engine.ui.get(this.tip);              // 当前设置快照（非 UI 节点 null）
    void engine.ui.rectOf(this.tip);           // 解析矩形（画布局部；布局子节点返回槽位矩形）
    void engine.ui.metricsOf(this.tip);        // 所在画布屏幕度量（px ↔ UI 单位换算）
    void engine.ui.screenToUi(this.tip, 100, 100); // 屏幕像素 → 画布局部 UI 坐标

    // 点击订阅（仅 uiButtonNode 且 interactable；返回解绑函数）
    if (this.btn) {
      const off = engine.ui.onClick(this.btn, () => { /* 按钮被点击 */ });
      void off;
      // engine.ui.offClick(this.btn, handler); // 解除订阅
    }
  }
}
```

## 逻辑：engine.logic

按实体寻址；**状态机/行为树运行器节点**（层级「逻辑」分组的 FSM Runner / BT Runner，编辑器里绑定 `.fsm` / `.bt` 资产）的脚本控制入口。运行态（当前状态/黑板）不落盘；状态切换与动作行为全部由脚本消费。

状态机：过渡触发器（事件 / 定时 / 参数条件）在编辑器的 `.fsm` 图里定义，脚本负责喂事件、写参数、响应状态：

```ts tve
import { Component, engine, property, FsmRunnerNode, Entity } from "tve";

export default class FsmDriver extends Component {
  @property({ type: FsmRunnerNode, label: "状态机" })
  fsm: FsmRunnerNode | null = null;

  onStart() {
    const e = (this.fsm ?? this.entity) as Entity;
    // 状态进入时播动画（经典 Idle/Walk/Attack 驱动）
    engine.logic.onFsmEnter(e, "Attack", () => engine.animation.play(e, "attack"));
    engine.logic.onFsmExit(e, "", () => engine.animation.stop(e)); // 空 match = 任意状态

    engine.logic.fire(e, "hit");               // 发射事件（事件过渡的触发器）
    engine.logic.setFsmParam(e, "hp", 20);     // 写参数（条件过渡的黑板）
    void engine.logic.getFsmParam(e, "hp");
    void engine.logic.fsmState(e);             // { id, name, time } | null
    engine.logic.forceFsmState(e, "Walk");     // 强制切换（状态 id 或显示名）
  }
}
```

行为树：条件叶子读黑板，动作叶子经 `onAction` 注册行为；返回三值状态（缺省成功）：

```ts tve
import { Component, engine, property, BtRunnerNode } from "tve";

export default class BtDriver extends Component {
  @property({ type: BtRunnerNode, label: "行为树" })
  bt: BtRunnerNode | null = null;

  private lastSeq = -1;
  private step = 0;

  onStart() {
    if (!this.bt) return;
    engine.logic.setBtParam(this.bt, "ready", 1);    // 写黑板（条件叶子的求值对象）
    void engine.logic.btStatus(this.bt);             // "success" | "failure" | "running" | null

    engine.logic.onAction(this.bt, "walkTo", (leaf, session) => {
      if (session.seq !== this.lastSeq) {            // 全新开始（首次/完成后再入/被中断）→ 复位
        this.lastSeq = session.seq;
        this.step = 0;
      }
      void leaf.id;
      return ++this.step >= 10 ? "success" : "running"; // running = 续行（下一帧再调）
    });
  }
}
```

通用控制：`setRunning(entity, false)` 暂停 / `restart(entity)` 重启（状态回入口、黑板回默认）。订阅与 `onAction` 都返回解绑函数。

**多个运行器：如何拿到实体**。场景里可以有任意多个状态机/行为树，`engine.logic` 全部按实体寻址，实体来源有四种：

```ts tve
import { Component, property, engine, FsmRunnerNode, Transform } from "tve";

export default class RunnerRefs extends Component {
  // ① @property 节点引用（推荐）：检查器下拉按类型过滤，只列 fsmRunnerNode/btRunnerNode；
  //    同一脚本可声明多个字段分别绑定不同运行器，多个脚本也可引用同一个运行器
  @property({ type: FsmRunnerNode, label: "移动状态机" })
  move: FsmRunnerNode | null = null;

  // ② 按名字 / 标签查找
  findRunners() {
    const fsm = engine.scene.find("EnemyFSM");
    const agent = engine.scene.findByTag("enemy");
    void fsm; void agent;

    // ④ 枚举全部运行器（如全局监听所有敌人的状态）
    for (const e of engine.scene.findAll()) {
      if (e instanceof FsmRunnerNode) {
        engine.logic.onFsmEnter(e, "Die", () => this.refreshCount());
      }
    }
  }

  // ③ 脚本就挂在运行器节点自身：this.entity 即该运行器
  hitSelf() {
    engine.logic.fire(this.entity, "hit");
  }

  refreshCount() { /* ... */ }

  onStart() {
    this.findRunners();
    this.hitSelf();
    void (this.move as Transform | null);
  }
}
```

引用字段保存的是节点 id，运行期解析为对应实体（`instanceof FsmRunnerNode` / `BtRunnerNode` 可判别），预览与构建产物行为一致。

## 补间动画：engine.tween

与顶层导出 `tween` 是同一对象：创建即自动播放的补间动画（实体变换、UI 字段、数值/颜色插值、序列/并行组）。详见[补间动画](tween.md)。

```ts tve
import { Component, tween } from "tve";

export default class Slide extends Component {
  onStart() {
    // 与顶层导出 tween 是同一对象
    tween.position(this.entity, { x: 5 }, 1).easing("quadOut");
  }
}
```

## 日志：engine.log / warn / error

```ts tve
import { engine } from "tve";

const score = 10;
engine.log("得分", score);   // 输出到编辑器控制台（预览）/ 浏览器控制台（发布产物）
engine.warn("低血量");
engine.error("非法状态");
```

- 预览运行时日志转发到编辑器控制台（`[预览]` 前缀）；发布产物转发到浏览器控制台（调试模式构建保留转发）；
- 参数原样透传（多参数以空格拼接显示），对象/实体按可读形式打印；
- 每帧高频 `log` 会刷屏（控制台上限 500 行，超出丢弃最旧），调试完记得移除。

## 其他导出

| 导出 | 说明 |
| --- | --- |
| `math` | 向量数学库，见 [math](math.md) |
| `tween` / `easing` / `Tween` | 补间动画系统，见 [tween](tween.md) |
| `Delegate` / `Pool` / `DataCenter` / `dataCenter` | 脚本通用设施，见 [通用设施](utils.md) |
| `VERSION` | SDK 版本字符串 |
| `Component` / `Entity` / 各节点类与门面类 | 见前述章节 |
