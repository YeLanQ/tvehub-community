# 单元：播放运行时模块与帧循环（`src/runtime/` → player.mjs）

## 契约

**模块清单**（源 → 产物映射：`src/runtime/` 下 `core/X.ts` 编译为 `public/engine/core/` 下同名 `.mjs`，`runtime/X.ts` 同理进 `public/engine/runtime/`）：

- core/：tve.ts（SDK）、scripts.ts（脚本宿主）、tween.ts、log.ts（postLog）、
  utils.ts、particles.ts（GLSL 粒子材质）、particleNodeMaterial.ts + nodeMaterialHooks.ts
  + glslToTsl.ts（WebGPU/TSL，与 framework/material/tsl 词法器镜像）、lights.ts
- runtime/：stage（createRenderer/createStage——**经 RHI 创建设备 + RPI 组装
  管线**，`src/engine` 源码构建时内联进 stage.mjs）、nodes（buildSceneTree 场景树重建）、
  camera、shadow（refitShadowCameras）、mesh、model（GLTF/FBX 实例化）、material、
  textures、sky、fog/heightFog、terrain、particles、animation(+worker)/animclip、
  audio、physics(+worker)、nav、logic、ui、batching（静态批处理：基元/数据实例化+
  合并、GLB 模型叶子实例化——同 GLB 共享模板几何/材质成组；烘焙按 owner 挂
  batchBinding，tve entity 位姿/可见性写入同步到实例副本，`runtimeDynamic` 节点
  整体豁免）、layerpass
  （Culling Mask 分 pass——已被 engine/rpi/layerSet 取代，产物保留无消费方）、
  lod、shader(+Hooks)、graph-kernel/runtime/behaviors、
  pak/asset-bundle/resource（打包资产 shim）、loaders/compressed

**player.mjs 只做装配**（源即产物手写维护）：main() 流程 =
并行读 config.json / scene.json / `<场景>.manifest.json`（导出清单，逐条带真实
加载类型；到达即 `resourceLoader.preloadAll` 预取 boot 阶段资产——arrayBuffer
优先于 blob，网络等待与建树重叠）→ createRenderer → loadModels/loadMaterialParams
→ buildSceneTree → 并发段（天空盒 / 网格·地形·UI 贴图 / 动画 Worker / 清单预取，
各自 catch 不互相阻断）→ **单一资源汇合屏障**（`Promise.all` 后再装配天空面、
贴合阴影、`warmupShaders`）→ createStage → createPhysicsWorker → createUI
→ createLogic → createScripts → createGraphBehaviors → createNavRuntime →
createClipAnimations → createParticles/createAudios → requestAnimationFrame(frame)。
`ResourceLoader.preload/preloadAll` 走 6 路并发闸（`parallel.ts`），清单只是把
原本分散在各阶段的 fetch 提前并发发起，正式加载点吃缓存；资产清单缺失（老产物/
gzip 单包）时静默跳过，行为退回按阶段加载。

**预热上限**：`warmupShaders` 经 `warmupWithDeadline` 包络——渲染预热 4s，超时只
告警并先出首帧（剩余管线在首次绘制时惰性编译）。驱动/软件适配器上 `compileAsync`
可能数十秒，不设上限会让入口页看门狗（15s）先报「启动超时」。WebGPU 适配器不可用/
仅软件适配器/three 内部回退兼容层时 RHI 直接回退经典 WebGL（见 editor-engine 的
「WebGPU 后端门控」）。社区版不设计算预热阶段。

**启动分段打点**：`main()` 全程记录 `device-ready / shaders-ready / pipelines-ready /
first-submit / first-visible`（`globalThis.__tveBootTiming.marks`）；首帧可见时汇总输出
一行 `[boot] 设备协商 a+b ms | 着色器模块 N个/Tms | 渲染管线 N个/Tms | 计算管线 N个/Tms |
预热完成 | 首帧提交 | 首帧可见 | DrawCalls`（postLog + console.info），结构化详情在
`__tveBootTiming.report`（含 `__tveGpuTiming` 的适配器/init/模块字节数与管线异步数）。
首帧统计必须在渲染后立即抓取——渲染管线结束后会 reset `info.render`。
**release 构建（`debug:false`）零采集零输出**：不建 `__tveBootTiming`、不抓首帧统计、不排
额外 rAF，RHI 侧以 `RHIDeviceOptions.traceStartup=false` 跳过 GPU 方法包装与
`__tveGpuTiming`；预览/编辑器（debug 缺省）保持开启。

**帧循环固定顺序**（frame() 本体；动顺序前先读懂注释链）：

```
tickShaderTime → scripts.fixedUpdate(dt)      // 1/60 固定步长，0..n 次
→ scripts.update(dt) → nav.update → logicApi.update → graphBehaviors.update
→ animations.update → physicsApi.update → clipAnims.update → audiosApi.update
→ particlesApi.update                          // 位姿更新后再发射（world 出生点跟上）
→ scripts.lateUpdate(dt) → syncPose()          // 相机节点位姿回填渲染相机
→ refitShadowCameras(scene)                    // 每 20 帧节拍（静态冻结场景跳过）
→ uiApi.update(cam) → applyClearFlags             // 解析为清除描述 frameClear
→ uiApi.beginRender → pipeline.renderView({scene, camera: cam, clear: frameClear})
                                                 // RPI：分层多 pass 在管线内拆
→ uiApi.endRender（叠加渲染走 pipeline.renderOverlay）
```

**帧调度层（功耗，frame() 之外包一层 scheduleFrame）**：目标帧率
`performance.frameRate`（config.json 与场景 settings.performance 通用键；缺省 60，
0 = 不限）——高刷屏锁 60 降 CPU/GPU 功耗；页面隐藏（document.hidden）或容器
不可见（IntersectionObserver）时暂停整个循环，恢复后丢弃暂停期间的巨大帧间隔。
`performance.powerPreference`（"high-performance" / "low-power"，缺省 "default"）
控制 GPU 偏好——缺省不再强制独显（原 high-performance 使混合 GPU 设备功耗数倍）。
静态场景（无脚本/剪辑/物理/UI 画布/导航）且无投影灯时还会整体关闭阴影管线
（`renderer.setShadowMapEnabled(false)`——renderer 即 RHI 设备；有脚本时不推断
——tve Light 组件可运行时开 castShadow）。

## 使用例

新增"每帧推进"的系统：照 audios/particles 的装配方式在 player.mjs 挂进循环
（顺序有语义：晚于位姿更新、早于 lateUpdate），同步改 `src/generated/
web-preview-files.ts` 清单（自动生成，见 build-assets.md）。

## 测试例

真实测试例：`scripts/smoke/tracker/smoke-runtime-modules.mjs`（P0）——
全模块**链接检查 + 导出面断言**（如 particles.mjs 必须导出
`createGlslParticleMaterial`/`FADE_OUT_FRACTION`）；`smoke-script-hooks.mjs`
断言 fixedUpdate 步长与三段更新时序。改帧循环顺序/模块导出后必跑
`pnpm test:regression:core`。
