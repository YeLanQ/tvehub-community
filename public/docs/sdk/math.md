# 数学库 math

`math` 是向量数学库，全部基于引擎自有类型 `Vec3`（`{x, y, z}` 普通对象），**不暴露任何 three.js / WebGL 类型**。所有函数都是纯函数：**返回新对象，不改写入参**——把返回值赋回去才会生效。

本文全部代码块都是**自包含可运行**的（doctest）：可直接复制进项目，也随文档测试套件逐块验证（`pnpm docs:test`）。

```ts tve
import { math } from "tve";

const self = math.v3(0, 0, 0);
const target = math.v3(10, 0, 0);

// 指向目标的单位方向
math.normalize(math.sub(target, self)); // => {"x":1,"y":0,"z":0}
// 两点距离
math.distance(self, target); // => 10
```

为什么用纯函数而不是链式/可变对象：与编辑器数据模型一致（变换读写都是快照语义），也避免共享可变状态被多组件意外篡改。如果需要保存一个向量稍后再写回，用 `math.clone()` 拷贝一份。

## 坐标与单位约定

全部数学函数与编辑器共用同一套约定，混用不会出现单位错乱：

| 约定 | 值 |
| --- | --- |
| 坐标系 | 右手系，Y 向上 |
| 前向 | **-Z**（`math.forward` = (0,0,-1)，与灯光/相机/粒子发射方向一致） |
| 位置/缩放 | 米（世界单位） |
| 旋转 | **度**制欧拉角 XYZ（不是弧度） |
| 颜色 | 0xRRGGBB 整数（math 不处理颜色，颜色插值见 [tween](tween.md)） |

涉及角度的函数（`deltaAngle` / `moveTowardsAngle` / `degToRad` / `radToDeg`）都以「度」为默认单位；`degToRad` / `radToDeg` 只在与 `Math.sin/cos` 等三角函数配合时才需要（三角函数吃弧度）。

## 构造与常量

| 成员 | 说明 |
| --- | --- |
| `v3(x?, y?, z?)` | 创建向量（缺省 0）：`math.v3()` = (0,0,0)、`math.v3(1)` = (1,0,0) |
| `zero` / `one` | 零向量 / 单位向量 (1,1,1)（冻结，勿改写） |
| `up` / `down` | (0,±1,0) |
| `forward` / `back` | (0,0,∓1)（前向 = -Z） |
| `left` / `right` | (∓1,0,0) |
| `clone(v)` | 快照副本，写入副本不影响原向量 |

```ts tve
import { math } from "tve";

math.v3(1);          // => {"x":1,"y":0,"z":0}（缺省分量补 0）
math.forward;        // => {"x":0,"y":0,"z":-1}

// 常量是冻结对象：直接改写会被忽略（严格模式报错），需要可变量请 clone
const v = math.clone(math.up);
v.y = 5;             // ✓ 改的是副本
v;                   // => {"x":0,"y":5,"z":0}
math.up;             // => {"x":0,"y":1,"z":0}（原常量不受影响）
```

常量对象跨帧复用，不要把 `math.up` 直接存进 `dataCenter` 等共享容器后改写。

## 运算

| 成员 | 说明 |
| --- | --- |
| `add(a, b)` / `sub(a, b)` | 加 / 减（`sub(b.position, a.position)` = 从 a 指向 b 的向量） |
| `scale(v, s)` / `negate(v)` | 数乘 / 逐分量取反 |
| `abs(v)` / `min(a, b)` / `max(a, b)` | 逐分量绝对值 / 最小 / 最大 |
| `dot(a, b)` | 点积（\|a\|\|b\|cosθ）；单位向量点积 = 夹角余弦，常用于「是否在面前」判定 |
| `cross(a, b)` | 叉积（同时垂直于 a、b，右手定则）；两向量张成平面的法线 |
| `length(v)` / `lengthSq(v)` | 模长 / 模长平方（比较距离用平方更快，少一次开方） |
| `distance(a, b)` / `distanceSq(a, b)` | 两点直线距离 / 距离平方 |
| `normalize(v)` | 归一化（模长归 1；零向量返回零向量，**不产生 NaN**） |

```ts tve
import { math } from "tve";

// 是否在角色面前 120° 视野内（视野半角 60°）：单位向量点积 = 夹角余弦
const facing = math.forward;                            // 角色朝向（演示值）
const toTarget = math.normalize(math.v3(1, 0, -1));     // 指向目标的方向
const visible = math.dot(facing, toTarget) > Math.cos((60 * Math.PI) / 180);
visible; // => true

// 两点是否进入交互半径（平方距离，免开方）
const a = math.v3(0, 0, 0);
const b = math.v3(3, 0, 4);
math.distanceSq(a, b);   // => 25
math.distance(a, b);     // => 5

// 叉积求两向量张成平面的法线（右手定则）
math.cross(math.right, math.up); // => {"x":0,"y":0,"z":1}

// 归一化：零向量安全返回零向量，不产生 NaN
math.normalize(math.zero); // => {"x":0,"y":0,"z":0}
```

> `normalize` 对零向量返回零向量是刻意的容错：跟随逻辑里目标与自己重合时不会突然得到 NaN 把整个位置写坏。

## 插值与移动

| 成员 | 说明 |
| --- | --- |
| `lerp(a, b, t)` | 线性插值 t∈[0,1]（t=0 返回 a 克隆，t=1 返回 b 克隆；t 超界外推） |
| `moveTowards(a, b, maxDelta)` | 由 a 向 b 移动最多 maxDelta（不超过直线距离；**匀速移动**用） |
| `equals(a, b, eps?)` | 近似相等（逐分量误差 ≤ eps，缺省 1e-6） |

`lerp` 与 `moveTowards` 的区别：`lerp(a, b, k * delta)` 是**比例逼近**（先快后慢、永不精确到达，k 越大跟随越紧），`moveTowards(a, b, speed * delta)` 是**恒速逼近**（帧率无关、精确到达）。跟随相机用 lerp，角色移动用 moveTowards 是常见搭配。

```ts tve
import { math } from "tve";

const pos = math.v3(0, 0, 0);
const goal = math.v3(10, 0, 0);

// lerp 是比例逼近：每帧靠近剩余距离的一部分
math.lerp(pos, goal, 0.5); // => {"x":5,"y":0,"z":0}

// moveTowards 是恒速逼近：一帧内最多走 speed * delta，到达即停
const speed = 6;
const delta = 1 / 60;
const next = math.moveTowards(pos, goal, speed * delta);
next;                            // => {"x":0.1,"y":0,"z":0}
math.equals(next, goal, 0.01);   // => false（还没到）
math.moveTowards(goal, goal, 1); // => {"x":10,"y":0,"z":0}（已到达则不动）
```

## 标量与角度

| 成员 | 说明 |
| --- | --- |
| `clamp(v, min, max)` | 标量钳制（结果落在 [min, max]） |
| `projectXZ(v)` | XZ 平面投影（返回 y = 0 的副本；把方向约束到水平面） |
| `deltaAngle(current, target)` | 角度差（度）= target − current 的最短有符号差（结果 ∈ [-180, 180]；多圈自动归一化） |
| `moveTowardsAngle(current, target, maxDelta)` | 角度移近（度）：沿最短路径向 target 移动最多 maxDelta（Infinity = 立即到达） |
| `deadZone(v, deadZone)` | 模拟输入死区（线性重映射）：\|v\| ≤ deadZone 归零，其余按符号缩放回 0..1 满量程 |
| `degToRad(degrees)` | 度 → 弧度 |
| `radToDeg(radians)` | 弧度 → 度 |

角度函数解决的是「欧拉角绕圈」问题：直接 `target - current` 会在 359° → 0° 处算出 -359°，`deltaAngle` 永远给出最短方向；`moveTowardsAngle` 在此基础上限速，就是帧率无关的平滑转身。`deadZone` 配合 `engine.input.pointer` 自制虚拟摇杆时滤掉中心抖动。

```ts tve
import { math } from "tve";

math.clamp(12, 0, 10);              // => 10（越界钳回）
math.projectXZ(math.v3(1, 9, -2));  // => {"x":1,"y":0,"z":-2}

// 角度差永远走最短方向：359° → 0° 只差 1°，不是 -359°
math.deltaAngle(359, 0);            // => 1
math.deltaAngle(0, 359);            // => -1

// 平滑转身：每帧最多转 turnSpeed * delta 度
const turnSpeed = 540;
const delta = 1 / 60;
math.moveTowardsAngle(170, 190, turnSpeed * delta); // => 179

// 摇杆死区：中心抖动归零，其余缩放回满量程
math.deadZone(0.05, 0.15);          // => 0
math.deadZone(0.5, 0.15);           // => 0.4117647058823529

// 与 Math 三角函数配合：先转弧度
Math.sin(math.degToRad(90));        // => 1
math.radToDeg(Math.PI);             // => 180
```

角度函数与 `Entity.rotation` 同一约定（度制欧拉角），在组件里的典型用法（完整可复制）：

```ts tve
import { Component, property, math, MeshNode } from "tve";

export default class TurnToTarget extends Component {
  @property({ type: MeshNode, label: "目标" })
  target: MeshNode | null = null;

  @property({ label: "转身速度（度/秒）", min: 0 })
  turnSpeed = 540;

  @property({ label: "模型面向校正（度）" })
  facingOffset = 0;

  onUpdate(delta: number) {
    if (!this.target) return;
    // 朝移动方向转身（facingOffset 校正模型自身面向）
    const to = math.sub(this.target.position, this.entity.position);
    const yaw = (Math.atan2(to.x, to.z) * 180) / Math.PI + this.facingOffset;
    const r = this.entity.rotation;
    this.entity.rotation = {
      x: r.x,
      y: math.moveTowardsAngle(r.y, yaw, this.turnSpeed * delta),
      z: r.z,
    };
  }
}
```

## 矩阵（Mat4）

| 成员 | 说明 |
| --- | --- |
| `mat4()` | 创建 4×4 单位矩阵（列主序，长度 16 数组；与 Three.js/WebGPU 同布局） |
| `mat4Multiply(a, b)` | 矩阵乘法（结果 = 先 b 变换再 a 变换） |
| `mat4Invert(m)` | 求逆（不可逆返回单位矩阵，不产生 NaN） |
| `unproject(ndcX, ndcY, ndcZ, invVP)` | 屏幕坐标 → 世界坐标（逆投影；配合 `CameraNode.screenToRay` 更常用） |

```ts tve
import { math } from "tve";

const m = math.mat4();
m.length;               // => 16
m[0];                   // => 1（列主序单位矩阵）
m[5];                   // => 1
m[15];                  // => 1
// 单位矩阵的逆仍是单位矩阵
math.mat4Invert(m)[0];  // => 1
```

## 常见配方速查

| 需求 | 写法 |
| --- | --- |
| 指向目标的单位方向 | `math.normalize(math.sub(b.position, a.position))` |
| 匀速追踪 | `math.moveTowards(pos, goal, speed * delta)` |
| 平滑跟随 | `math.lerp(pos, goal, 1 - Math.pow(k, delta))` |
| 距离判定（快） | `math.distanceSq(a, b) < r * r` |
| 水平朝向（只转 Y） | `math.projectXZ(dir)` + `math.moveTowardsAngle` |
| 镜面对称向量 | `math.scale(dir, -1)` 或 `math.negate(dir)` |
| 摇杆输入滤抖 | `math.deadZone(raw, 0.15)` |
| 与 `Math` 三角函数配合 | 先 `math.degToRad()` 转弧度 |
