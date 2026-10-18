# TvEHub Community

可视化3D编辑器。覆盖完整创作闭环，编辑器与导出产物运行同一套网页运行时，语义零漂移。

> 当前版本 **r1.1.0**（开源社区版，[Apache-2.0](LICENSE)）。

桌面端为**多会话窗口架构**：首页窗口（TvEHub Community）负责项目管理、模板、创意工坊、白板与共享，每个项目一个独立编辑器窗口（TvE Editor）；窗口与会话生命周期由后端统一管理，浏览器环境回退单窗口视图切换。脚本 SDK 的命名空间为 `tve`。

## 产品哲学

> **人的有限时间不能耗费在无限的工具学习中。**

v1.0.0 把作品送出编辑器：微信小游戏一键直出，真机实测跑通——创作闭环从「构建出包」走到「玩家手机上真的能玩」。

## v1.0.0 更新内容

### 微信小游戏导出渠道

- **一键直出**：构建面板选微信小游戏渠道，预构建运行时 + 资产全量打包，产物直接导入微信开发者工具预览与上传；
- **分包加载**：资产按体积分包（pkg-N），小游戏启动前并行预加载，规避主包体积限制；
- **多线程加速（可选）**：物理与动画进 Worker，主线程不掉帧；考虑设备适配性缺省关闭，构建面板勾选启用（模拟器实测生效，真机暂回落主线程）；
- **Draco 网格压缩**：按项目配置随包（不启用不占包体），wasm 解码；
- **真机诊断**：构建面板勾选（调试模式出现），触控/渲染/物理/音频链路读数真机屏上可见，模拟器不复现的问题不再盲猜。

### 真机适配修复

- 真机首帧黑屏/转圈与画面拉伸：resize 握手、视口尺寸取值等模拟器不复现类问题，按真机读数逐一实证修复；
- 音频无声：2D 音源切微信原生 InnerAudioContext（真机验证通过）；
- 摇杆不动角色：构建产物混淆破坏脚本类名解析的根因修复（编译期注入原始类名锚点）；
- 随包 Worker 预检误杀：改运行期能力探测 + 多路回退全日志；真机回读确认回落生效——真机 Worker 暂不可用（推测官方平台适配未完善），自动回落主线程保证可玩。

### 编辑器与渲染

- 编辑视口与资产 3D 预览锁 60fps，资产预览滚出视口即暂停，高刷屏不再空转；
- 相机画中画：选中相机后编辑视口右下角按该相机实时取景；
- 数据化网格与渲染优化：阴影按需重画、几何共享缓存、大地形自适应分块；
- 数字地形支持 DEM 高程数据导入（asc/hgt/pgm/xyz），真实起伏上限放宽到 10000，碰撞自动贴合地形网格；
- UI Widget 新增不透明度；主题颜色自定义生效（对齐设计令牌）；
- Mesh 基元 size 逐轴编辑；新建节点落世界原点，添加节点不再链式嵌套（隐式父级只认容器型）。

### 修复

- 属性面板快速连改数值不再回弹/跳变/被覆盖；
- 场景保存后预览不再被自动重载拽回场景视图；
- 场景缺 id 节点自动补生成，不再保存/导出丢节点。

## 功能特性

### 编辑器

- **多会话窗口架构**：首页窗口（项目管理、工程模板、创意工坊、白板、局域网共享、开发者服务）+ 每项目独立编辑器窗口，场景图 / 白板 / AI 助手 / 文档窗口按需动态开启；浏览器环境回退单窗口视图切换；
- **停靠面板系统**：层级 / 属性（检查器）/ 控制台 / 资产 / 动画五种面板，拖拽停靠、浮动窗口、合并标签页、布局持久化（编辑器与场景图窗口共享同一套停靠工厂）；
- **四种视图模式**：场景（3D 编辑视口）/ 布局（UI 画布）/ 预览（内嵌网页运行）/ 脚本（代码工作台）；
- **检查器与组件**：变换、网格、灯光、相机、物理（刚体/碰撞体）、音源、粒子、脚本组件等卡片式编辑；
- **撤销/保存**：命令式撤销栈，未保存标记，快捷键与工具切换（W/E/R）、快捷键 F 快速聚焦选中对象。

### 场景与渲染

- 场景层级、节点多选、拖拽排序、预制体实例化、节点类型图标；
- 粒子系统、阴影（按需重画）、雾效、天空、LOD、静态批处理，WebGL / WebGPU 双渲染后端（不可用时自动回退）；
- **UI 系统**：UI 画布 + Widget（文本/图片/按钮/布局容器）、锚点布局、缩放适配、内置布局配方，可与 3D 场景混合编排；
- **动画编辑器**：关键帧剪辑、曲线编辑、录制、动画图、骨骼动画（混合/加法层、IK、形态键、骨骼调试）；
- **着色器**：`.shader` 效果着色器资产（Properties 参数 + Hook 钩子）挂载到材质卡片，创意工坊内置 15 个效果示例（边缘光 / 扫描线 / 全息投影 / 溶解消失 / UV 流光 / 顶点波动 / 海水等）。

单位约定：位置/缩放 = 米，旋转 = 度，UI = 100 设计像素，y 向上，前向 = -Z。

### 逻辑与脚本

- **脚本系统**：代码工作台编写 TypeScript（编译、绑定节点、编辑器内智能提示与错误定位），`tve` SDK 提供 `@property` 装饰器声明脚本属性（类型推断/节点引用/组件引用/自动挂载）、`@nodeType` 脚本节点、`engine` 入口（时间、输入（含多点触控）、场景查询、动画、音频、粒子、物理、UI、补间、日志）、`math` 向量/角度工具、`tween` 链式补间（序列/并行、31 种缓动）、`utils`（Delegate/Pool/DataCenter）；
- **逻辑资产**：`.fsm` 状态机 / `.bt` 行为树可视化编辑（节点画布、连线、黑板参数、事件）+ 运行时引擎，层级节点挂运行器，检查器提供 Live 状态视图（运行控制、事件、强制切换、黑板实时查看）；
- **场景图**：场景即图、对象即原型——帧驱动器 + 逻辑卡（执行链 + 数据流）+ 状态机/行为树逻辑容器，不改代码扩展原型行为，预览与构建产物中真实执行；
- **AI 助手**：内置助手以自然语言驱动编辑器，能力收敛为原子命令、执行权收归本地后端、边界受权限门约束；同一能力面经 TCP 通道向外部 Agent（Claude、Cursor、自动化脚本）开放；
- 编辑器与播放器共用同一套求值器，预览/导出语义一致。

### 地形 / 导航 / 物理

- **地形笔刷**：高度雕刻（抬升/压低/压平/平滑）+ splatmap 权重绘制（多层混合材质），绘制实时预览、增量重烤；数字地形支持 DEM 高程数据导入（asc/hgt/pgm/xyz）；
- **导航系统**：地形/任意网格烘焙可行走场 + SDF 寻路 + 导航代理（单点/顺序巡回/最近可达三种目标模式），预览与构建真实运行；
- **物理**：刚体与碰撞体组件，rapier / jolt / ammo 三后端，模拟在独立线程运行，不阻塞编辑与渲染主循环。

### 资产与构建

- **资产系统**：资产面板（导入、重命名、复制路径、按类型筛选），模型导入支持 glTF（含 Draco 压缩）、内嵌材质自动提取、按材质槽位覆盖；项目 `internal/` 提供内置只读资产；
- **创意工坊**：脚本原型（`.ts`）与效果着色器原型（`.shader`）仓库，资产面板右键按原型直接新建项目资产；
- **网页预览**：一键在真实运行时预览（控制台与错误实时回传编辑器，支持系统浏览器打开调试），设备仿真内置常见手机/平板机型（横竖屏、自定义分辨率与 DPR、缩放适配）；
- **构建导出（Web）**：多场景构建（指定主场景入口）、发布模式（资源重命名 + 引用重写 + JSON 压缩）、资产 gzip 归档、CDN 模式；产物为纯静态文件，可直接部署任意静态服务器或对象存储 + CDN；
- **微信小游戏直出**：一键出包导入微信开发者工具，分包加载、可选多线程、Draco 压缩、真机诊断（详见上方 v1.0.0 更新内容）。

## 历史版本

- **v0.1.4（2026-09 下旬）**：智能助手成熟——思考可见、任务真实落地、大脑语义单元化、文件操作格式锁定与关联保护；图窗口缓动曲线/追击最小距离/导航恢复续走/状态机切换事件；
- **v0.1.3（2026-09）**：白板（绘制/图层/富文本/幻灯片放映）、局域网共享、创意工坊、真机触摸、第三方许可管理；
- **v0.1.2.x（2026-09 中旬）**：着色器资产与材质分离、物理系统（rapier/jolt/ammo 三后端）、预制体、骨骼动画完全控制（混合/加法层/IK/形态键）、ui-kit 组件库；
- **v0.1 ~ v0.1-forge（kp-1 / kp-2 时代）**：kp-1 建立「搭场景到构建导出」最小闭环；kp-2 带来场景图系统（原型/实体集/双通道连线/逻辑容器）、多会话窗口架构、状态机与行为树进预览构建、导航区域与代理。

逐版本明细见 [CHANGELOG.md](CHANGELOG.md)（由提交记录自动生成）。

## 快速开始

环境要求：Node.js 18+、pnpm、Rust 工具链（构建桌面端安装包需要）。

仓库含一个 submodule（`public/repos/` 创意工坊资源仓库），克隆时需一并拉取（内置文档已随库内嵌，无需额外拉取）：

```bash
git clone --recurse-submodules https://github.com/YeLanQ/tvehub-community.git   # 首次克隆
git submodule update --init                                                     # 已克隆过的仓库补拉
```

```bash
pnpm install

pnpm dev              # 浏览器开发模式（单窗口回退）
pnpm tauri dev        # 桌面端开发模式（多会话窗口）
pnpm build            # 前端构建（含运行时打包、类型检查、分层与质量门禁）
pnpm build:portable   # 桌面端安装包构建
```

## 项目结构

新建项目自动生成标准结构：

```
<项目根>/
├─ project.config.json   项目设置（版本、主场景、显示、物理、标签与层）
├─ build.config.json     构建配置（构建面板保存后生成）
├─ assets/               场景、模型、纹理、音频、材质、着色器、动画、预制体
├─ graph/                场景图（与场景绑定的行为图，随场景自动保存）
├─ src/                  TS 脚本（只能放脚本）
├─ internal/             内置只读资产（只可引用不可修改）
└─ build/                构建产物（web/、wechat/ 等渠道，构建后生成）
```

## 仓库结构

```
src/
  framework/          # 编辑器引擎（场景/动画/物理/逻辑/导航/地形/脚本/图注册表……各子系统）
  runtime/            # 播放器网页运行时（预览与构建产物使用，编辑器共用；含场景图内核）
  engine/             # 渲染抽象层（RHI/RPI，WebGL/WebGPU 双后端共用）
  app/                # 首页与编辑器窗口应用壳
  graph-window/       # 场景图编辑窗口（节点图画布）
  whiteboard-window/  # 白板窗口
  assistant-window/   # AI 助手窗口
  docs-window/        # 内置文档窗口
  docks/              # 编辑器/图窗口共享停靠面板系统
  components/         # 通用业务组件
  ui-kit/             # 编辑器 UI 组件库
  lib/                # 数据层门面（唯一允许直接调用桌面端 IPC 的位置）
public/docs/          # 内置文档（随库内嵌、随版本同步）：编辑器手册 + SDK 教程与 API 参考
public/repos/         # 创意工坊资源仓库 submodule（TvEHub-Repos，MIT）：一个子目录一个分类
public/engine/        # 网页预览运行时 = 纯构建产物目录（不入库），由 runtime/scripts/engine.mjs 全量再生
src-tauri/            # 桌面端后端（Rust：项目/资产管理、预览构建、窗口会话、助手大脑、TCP 指令服务）
scripts/              # 构建/生成/门禁脚本与 smoke 冒烟测试
architecture/         # 架构文档库（Apache-2.0 随本分支发布，见下方「架构设计」）
```

分层守卫：全仓仅 `src/lib/` 允许直接调用桌面端 IPC，构建前由 `scripts/check-layers.mjs` 检查。

## 质量与回归

以 smoke 冒烟脚本做回归测试（Node 直跑，无需 GPU/浏览器），覆盖网格、物理、组件、着色器、粒子、阴影、地形、状态机、逻辑引擎/运行时、场景图运行时、批处理、导航、输入、补间、脚本钩子等子系统；套件集中在 `scripts/smoke/tracker/`，动态发现注册——新脚本丢进去即被纳入：

```bash
pnpm smoke            # 交互菜单（↑↓ 移动，空格勾选，回车运行）
pnpm smoke --all      # 全量回归
pnpm smoke --list     # 列出全部套件
pnpm check:layers     # 分层守卫检查
pnpm qr:check         # 二维码编码器自检
pnpm docs:test        # 内置文档示例 doctest
pnpm ci:local         # 提交前一键门禁链（文档校验→类型检查→分层→质量/安全扫描→单测→P0 核心回归）
```

## 版本与变更

版本号单一事实源是 `src-tauri/tauri.conf.json`，`scripts/sync-version.mjs` 挂在 dev/build 链首自动同步 package.json 与 Cargo.toml。变更日志与 API 参考均为生成物，**不手写**：

```bash
pnpm changelog              # 从 Conventional Commits 全量再生 CHANGELOG.md
pnpm version:bump auto      # 按未发布提交自动递增版本（feat→minor、fix→patch、破坏性→major）
pnpm gen:api-docs           # tve.d.ts 变更后再生 public/docs/sdk/api.md（全量 SDK API 参考）
```

发布流程：`pnpm version:bump auto`（自动改版本 + 把新版本段写进 CHANGELOG，标「未发布」）→ 提交 `chore(version): vX.Y.Z`（这条提交就是发版锚点，下次 `pnpm changelog` 会给该段补上日期）。提交信息请遵循 Conventional Commits（`feat(scope): …` / `fix(scope): …`），CHANGELOG 的分组与版本递增都靠它。

## 文档

内置用户文档位于 `public/docs/`（首页「开发者服务」或文档窗口可直接查看），含编辑器手册、SDK 教程与**自动生成的全量 API 参考**（`public/docs/sdk/api.md`）；站内支持 `Ctrl+K` 搜索文档章节与 API。

- **编辑器**：[总览](public/docs/editor/overview.md) · [项目管理](public/docs/editor/projects.md) · [场景编辑](public/docs/editor/scene.md) · [场景图](public/docs/editor/graph.md) · [UI 系统](public/docs/editor/ui.md) · [检查器与组件](public/docs/editor/inspector.md) · [资产系统](public/docs/editor/assets.md) · [地形](public/docs/editor/terrain.md) · [着色器](public/docs/editor/shaders.md) · [动画编辑器](public/docs/editor/animation.md) · [脚本工作台](public/docs/editor/scripting.md) · [预览与构建](public/docs/editor/preview-build.md) · [AI 助手](public/docs/editor/assistant.md) · [白板](public/docs/editor/whiteboard.md)
- **SDK（脚本 API）**：[总览](public/docs/sdk/overview.md) · [装饰器](public/docs/sdk/decorators.md) · [实体与查询](public/docs/sdk/entity.md) · [engine 入口](public/docs/sdk/engine.md) · [逻辑（状态机/行为树）](public/docs/sdk/logic.md) · [UI](public/docs/sdk/ui.md) · [内置组件门面](public/docs/sdk/components.md) · [math](public/docs/sdk/math.md) · [tween](public/docs/sdk/tween.md) · [utils](public/docs/sdk/utils.md) · [API 参考（自动生成）](public/docs/sdk/api.md)

## 架构设计

架构设计文档（开源社区分支）见 [architecture/README.md](architecture/README.md)：内置助手、TCP 指令集、双协议、原子命令中心、权限门、渲染层抽象，以及与市面方案的差异与创新。

## 许可

本项目基于 [Apache License 2.0](LICENSE) 开源发布。

创意工坊资源仓库 `public/repos/` 是 submodule（独立 MIT 开源仓库 [TvEHub-Repos](https://gitcode.com/YeLanQ/TvEHub-Repos)，许可文件见其仓库根目录）；内置文档 `public/docs/` 已随本库内嵌发布，同样基于 **MIT**（见 [public/docs/LICENSE](public/docs/LICENSE)）。

第三方依赖的许可证副本与声明汇总在 [`public/licenses/`](public/licenses/)：npm 依赖逐包登记，Rust 依赖由 cargo-about 汇总为 [`rust-crates/NOTICES.html`](public/licenses/rust-crates/NOTICES.html)（`pnpm license:rust` 再生）。应用内「偏好设置 → 关于 → 开源许可」可直接查看。
