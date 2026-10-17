# 06 · 渲染层抽象：RHI / RPI 与双轨消费

> **TL;DR**
> 渲染栈分两层抽象：**RHI**（Render Hardware Interface）管设备——创建、配置、
> 渲染一帧、离屏目标、统计、销毁；**RPI**（Render Pipeline Interface）管管线——
> 清除、视图渲染、叠加、离屏回贴、分层多 pass。引擎内只有 `backends/` 允许直接
> import three（存量台账例外只减不增）；编辑器与导出运行时消费同一份 RHI/RPI
> 源码。Agent 看到的预览、截图和最终构建产物，走的是同一套渲染语义。

---

## 1. 为什么一个“给 Agent 用的编辑器”要在意渲染抽象

如果只做演示，渲染层可以随便写：编辑器里能看见就行，导出时再另写一套播放器。
但一旦 Agent 要“自己验证结果”，就会出现三个问题：

1. **编辑器与产物不一致。** Agent 截图看到的是编辑器视口，用户拿到的是导出页面；
   两套渲染路径的 tone mapping、清除标志、分层、阴影策略稍有差异，就会出现
   “编辑器里对、build 出来不对”。
2. **后端不可替换。** 代码里到处 `new THREE.WebGLRenderer()`，想加 WebGPU 或换
   渲染库要改几十处；Agent 也无法通过一个稳定接口询问“当前用的什么后端”。
3. **策略与能力混在一起。** 空闲降帧、阴影按需重画、画中画、自适应分辨率是
   **编辑器策略**；创建 WebGPU 设备、分层多 pass 是**渲染能力**。混在一个类里，
   运行时（播放器）想复用时会把编辑器策略一起拖进去。

RHI/RPI 就是把“能力”和“策略”拆开：能力沉到 `src/engine`，策略留在消费方
（编辑器 `RendererManager` / 运行时 `stage.ts` + `player.mjs`）。

---

## 2. 分层结构

```text
┌─────────────────────────────────────────────────────────────┐
│ App 层        src/app        编辑器应用（Vue/面板/命令）       │
│ Runtime 层    src/runtime    播放运行时组合根                  │
├─────────────────────────────────────────────────────────────┤
│ Framework 层  src/framework  引擎功能与编辑器策略              │
│   RendererManager            空闲降帧/阴影按需/画中画/DRS      │
│   scene/ prototype/ …        数据模型（零渲染库依赖）          │
├─────────────────────────────────────────────────────────────┤
│ RPI 层        src/engine/rpi 渲染管线标准接口                  │
│   types.ts                   RPIViewDesc / RPIPipeline        │
│   layerSet.ts                分层多 pass 纯逻辑                │
│   backends/three/pipeline    清除/分层/离屏/回贴               │
├─────────────────────────────────────────────────────────────┤
│ RHI 层        src/engine/rhi 渲染硬件抽象                      │
│   types.ts                   RHIDevice（零渲染库类型）         │
│   registry.ts                后端工厂注册 + auto 回退          │
│   backends/three/            WebGL / WebGPU 设备实现           │
│                              （唯一直接 import three 的位置）  │
├─────────────────────────────────────────────────────────────┤
│ 共用基础      src/platform_abstraction  eventBus/id/logger     │
└─────────────────────────────────────────────────────────────┘
```

依赖规则由 `pnpm check:layers` 强制：

1. **Tauri IPC** 只允许 `src/lib/`（门面）。
2. **渲染库解耦**：直接 import three 只允许 `src/engine/{rhi,rpi}/backends/`
   与存量台账 `scripts/layers-three-allowlist.json`；台账只减不增。
3. **engine 层方向**：`src/engine` 不依赖 framework/app/runtime/UI；层内只准
   向下（rpi → rhi，禁止反向）。

没有这三条，抽象很快会退化：某个“临时”的 `import * as THREE` 会从上层漏下来，
半年后就没法换后端了。门禁比文档更可靠。

---

## 3. RHI：设备抽象

`src/engine/rhi/types.ts` 定义 `RHIDevice`。它只有原生类型与不透明载荷
（`object` / `unknown`），不出现 three 的类型。

### 3.1 核心面

```ts
interface RHIDevice {
  readonly kind: "webgl" | "webgpu";
  readonly domElement: HTMLCanvasElement;
  readonly native: unknown;          // 遗留逃生口，新代码不得依赖

  configureDisplay(config: RHIDisplayConfig): void;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;

  render(scene: object, camera: object): void;
  warmupShaders(scene: object, camera: object): unknown | Promise<unknown>;

  setAutoClear(color: boolean, depth: boolean): void;
  setShadowMapEnabled(enabled: boolean): void;
  setShadowMapOnDemand(needsUpdate: boolean): void;

  createRenderTarget(desc: RHIRenderTargetDesc): RHIRenderTarget;
  setRenderTarget(target: RHIRenderTarget | null): void;

  setViewport(rect: RHIRect): void;
  setScissor(rect: RHIRect): void;
  setScissorTest(test: boolean): void;

  getStats(): RHIRenderStats;
  dispose(): void;
}
```

几个设计点：

- **scene/camera 是不透明载荷。** 场景图怎么组织、材质怎么解释，是 RPI/Framework
  的事；RHI 只负责把它们交给后端绘制。替换后端时，上层场景代码不动。
- **`native` 是逃生口，不是入口。** 遗留 WebGL 专属路径（KTX2 格式探测、Nishita
  天空 LUT 等）需要具体渲染器时用它；新代码不得依赖。台账会记录这些例外。
- **设备选项包含平台差异。** `canvas` 注入用于微信等平台：首画布归首渲染器，
  重建设备时若不传旧画布，后端自建画布会落到平台离屏链（渲染到屏外 = 黑屏）。
- **显示配置是“任意子集”。** `pixelRatio / toneMapping / shadowMapEnabled /
  shadowFilter` 可以只改一项；缺省项不动。编辑器与运行时各自决定策略。

### 3.2 后端注册与回退

`src/engine/rhi/registry.ts`：

```text
registerRHIDevice("webgl", factory)
registerRHIDevice("webgpu", factory)

createRHIDevice("auto" | "webgpu" | "webgl", options):
  prefer = auto ? "webgpu" : kind
  若 prefer == webgpu：
     尝试 webgpu 工厂
       成功 → 返回
       失败 → warn，回退 webgl
  返回 webgl 工厂（缺失则抛错）
```

`auto` 的策略是“优先 WebGPU，失败回退 WebGL”。这个回退在编辑器与运行时一致；
回退只影响设备本身，因为两套 three 构建共享 `three.core`，场景对象（材质/几何/
灯光）可以互用。

`registry` 本身不 import 任何后端；具体实现由消费方显式
`registerThreeRHIBackends()`。这样测试可以注入桩工厂，未来接自研后端也不需要改
registry。

---

## 4. RPI：管线抽象

`src/engine/rpi/types.ts` 定义“一帧怎么渲”。

### 4.1 视图描述

```ts
interface RPIClearDesc {
  color: boolean;
  depth: boolean;
  background?: unknown; // undefined=不改背景；null=无背景；其他=场景层背景载荷
}

interface RPIViewDesc {
  scene: object;
  camera: object;
  clear?: RPIClearDesc;
}
```

清除状态是**每帧输入**，不是设备全局状态。这样同一台设备可以渲染主视图、
画中画、离屏预览，各自有不同的清屏/背景策略，不会互相污染。

### 4.2 管线方法

```ts
interface RPIPipeline {
  readonly device: RHIDevice;

  renderView(view: RPIViewDesc): void;      // 主视图/离屏视图，应用清除
  renderOverlay(view: RPIViewDesc): void;   // 不清屏/不画背景，叠加
  renderToTarget(target, view): void;       // 渲染到离屏目标
  acquireTarget(w, h): RHIRenderTarget;     // 惰性创建/复用
  blitTarget(target, rect, viewW, viewH): void; // 回贴主画布
  dispose(): void;
}
```

### 4.3 分层多 pass

`layerSet.ts` 是纯逻辑（零渲染库依赖）：相机掩码全开或只用一个层时单 pass，零
额外开销；相机收窄了 Culling Mask 且场景占用多个掩码内层时，按层拆 pass，每 pass
只渲染该层对象，灯光收集按 `light.layers vs 相机层` 决定，保证“每盏灯只照亮其
掩码内的层”的语义。

这是“抽象不牺牲能力”的例子：抽象层没有把多 pass 变成黑盒，而是把“怎么拆层”
做成可测试的纯逻辑，后端只负责执行。

---

## 5. 双轨消费：编辑器与运行时用同一份源码

### 5.1 编辑器轨

```text
src/app
  → EditorEngine.mount
  → RendererManager.mount
      registerThreeRHIBackends()
      createRHIDevice(backend, {antialias, preserveDrawingBuffer, onShaderError})
      createRPIPipeline(device)
      configureDisplay({toneMapping, pixelRatio, shadowMapEnabled, shadowFilter})
      loop: pipeline.renderView({scene, camera, clear})
```

`RendererManager` 只做**编辑器策略**：

- 活动期锁 60fps（Bresenham 数帧），空闲 800ms 后降到 12fps；
- 静态场景阴影按需重画（内容变化/动画/粒子/物理才重画）；
- 自适应渲染精度（DRS）：帧距超预算时降像素比，有余量自动还原；
- 画中画：离屏渲染到 RT，再以全屏三角形回贴右下角；
- UI 布局视图独占渲染：隐藏非画布子树后再渲染；
- 尺寸变化只记录目标尺寸，在渲染循环里与下一帧同帧应用，避免黑闪；
- 暂停/恢复：中央区域被 iframe/面板接管时暂停后台空转。

它不创建 three 渲染器，也不实现多 pass——那些在 RHI/RPI 里。

### 5.2 运行时轨

```text
src/runtime/runtime/stage.ts
  createRenderer(cfg)
      registerThreeRHIBackends()
      createRHIDevice(cfg.renderer, deviceOptions)
      createRPIPipeline(device)
      applyCommon(cfg, device)  // dpr/toneMapping/shadow
  player.mjs
      pipeline.renderView({scene, camera, clear})
      pipeline.renderOverlay({scene, camera})  // UI 叠加
```

运行时也有自己的策略：

- `preserveDrawingBuffer` 只在清除标志需要跨帧保留时开启（移动端 tiled GPU 省带宽）；
- 设备仿真 `?dpr=` 覆盖像素比（1~4）；
- powerPreference 按项目设置，缺省 `default`（混合 GPU 笔记本不强制独显）；
- 微信等平台首画布归首渲染器，重建时注入旧画布。

### 5.3 为什么不会“各画各的”

- 两条轨道 import 同一份 `src/engine/rhi` / `src/engine/rpi` 源码；
- 构建时 `src/engine` 源码内联进 `public/engine/runtime/stage.mjs`，three 外部化
  为 vendored 构建；
- 编辑器与播放器都通过 `RPIPipeline.renderView` / `renderOverlay` 渲染，清除语义
  一致；
- 显示配置（tone mapping、阴影、像素比）各自按项目设置传入同一个
  `configureDisplay`。

“编辑器里看到的”和“导出后看到的”共享渲染语义，差异只来自策略参数，不来自两套
实现。

---

## 6. 这对 Agent 意味着什么

### 6.1 可验证

`preview.screenshot` 截的是编辑器视口的 canvas；`preview.start` 起的是同一套
运行时的产物。Agent 可以用截图确认“画面是否有东西”，再用构建产物确认“交付是否
完整”。它不需要理解渲染后端。

### 6.2 可诊断

`editor.state` 返回 `rendererBackend`（`webgl` / `webgpu`），渲染统计面板能看
draw calls / triangles / programs。Agent 排查“为什么预览是黑的”时，可以区分：

- 设备没创建（后端回退/平台限制）；
- 场景没内容（节点/相机/灯光）；
- 清除/背景配置（相机清除标志、天空盒）；
- 材质/着色器编译失败（`shader:error` 事件）。

### 6.3 可替换

如果未来接入自研渲染器或其他库，只需要在 `backends/` 写新的设备/管线工厂，并在
消费方注册；命令层、协议层、助手层完全不动。Agent 的能力面不会因为渲染后端更换
而改变。

---

## 7. 边界与迁移状态

如实说明当前抽象不是“完全渲染器无关”：

- **场景内容层仍直接使用 three。** 场景同步（对象/材质/灯光构建）、动画骨骼、
  模型 Loader 仍通过不透明载荷穿过 RHI/RPI；替换渲染库时，这些内容构建代码要
  随后端适配一起迁移。见 `scripts/layers-three-allowlist.json` 台账。
- **遗留 WebGL 专属路径存在。** 通过 `device.native` 逃生口访问具体渲染器；
  台账只减不增。新代码不得扩大。
- **物理后端是另一个同模式样板。** `src/framework/physics/backend/` 用
  `IPhysicsWorld` + 工厂注册表，与 RHI 同一思路；其 three 依赖只存在于位姿读写与
  几何采样两个接缝。
- **后端不可在运行时热切换。** 编辑器挂载时选定；改项目设置后需要重新挂载。
  这不是抽象缺陷，而是 GPU 资源生命周期的现实约束。

---

## 8. 事实源

| 内容 | 文件 |
| --- | --- |
| RHI 类型 | `src/engine/rhi/types.ts` |
| RHI 注册/回退 | `src/engine/rhi/registry.ts` |
| three WebGL 设备 | `src/engine/rhi/backends/three/webgl.ts` |
| three WebGPU 设备 | `src/engine/rhi/backends/three/webgpu.ts` |
| 渲染目标 | `src/engine/rhi/backends/three/renderTarget.ts` |
| RPI 类型 | `src/engine/rpi/types.ts` |
| 分层多 pass 纯逻辑 | `src/engine/rpi/layerSet.ts` |
| three 管线 | `src/engine/rpi/backends/three/pipeline.ts` |
| 编辑器渲染策略 | `src/framework/engine/modules/RendererManager.ts` |
| 运行时组合根 | `src/runtime/runtime/stage.ts` |
| 播放器帧循环 | `public/web-preview/player.mjs` |
| 分层依赖门禁 | `scripts/check-layers.mjs`、`scripts/layers-three-allowlist.json` |
| 架构总览（短版） | `ARCHITECTURE.md` |

---

## 9. 结语：抽象是为了让 Agent 看到真实的世界

权限门保证 Agent“只能做该做的事”，命令中心保证“做的事可回滚、可审计”，渲染抽象
保证“看到的世界和交付的世界是同一个”。三者合起来，才是“从指令到产物”的完整
闭环——而不是一个会生成截图的演示。

**延伸阅读：** [07 差异与创新](07-differentiation-and-innovation.md) —— 这套组合
与市面上常见方案的差异，以及哪些断言可以被代码验证。
