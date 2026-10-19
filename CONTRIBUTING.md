# 参与贡献（Contributing）

欢迎参与 **TvEHub Community**（可视化 3D 编辑器，[Apache-2.0](LICENSE)）的开发。任何形式的贡献都欢迎：报告缺陷、提交功能请求、修复 bug、补充文档、改进测试。

开始之前，请先阅读 [README.md](README.md)（产品定位与快速开始）与 [architecture/README.md](architecture/README.md)（架构设计），了解项目背景与分层原则。

## 目录

- [环境准备](#环境准备)
- [日常开发](#日常开发)
- [代码规范与硬约束](#代码规范与硬约束)
- [测试与质量门禁](#测试与质量门禁)
- [提交信息与版本发布](#提交信息与版本发布)
- [提交 PR 前的检查清单](#提交-pr-前的检查清单)
- [文档贡献](#文档贡献)
- [许可说明](#许可说明)

## 环境准备

环境要求：

- **Node.js 18+** 与 **pnpm**
- **Rust 工具链**（仅构建桌面端安装包需要；纯前端开发 `pnpm dev` 不需要）

仓库含一个 submodule（`public/repos/` 创意工坊资源仓库），克隆时需一并拉取：

```bash
git clone --recurse-submodules https://github.com/YeLanQ/tvehub-community.git   # 首次克隆
git submodule update --init                                                     # 已克隆过的仓库补拉
```

安装依赖：

```bash
pnpm install
```

> 使用 pnpm（仓库使用 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml`），不要混用 npm/yarn，避免锁文件漂移。

## 日常开发

```bash
pnpm dev              # 浏览器开发模式（单窗口回退）
pnpm tauri dev        # 桌面端开发模式（多会话窗口）
pnpm build            # 前端构建（含运行时打包、类型检查、分层与质量门禁）
pnpm build:portable   # 桌面端安装包构建
pnpm build:linux      # Linux AppImage（需在 Linux x86_64 主机上执行，见 README「Linux 构建」）
```

注意：`dev` / `build` 链首会自动执行 `scripts/sync-version.mjs`，以 `src-tauri/tauri.conf.json` 为版本单一事实源同步 `package.json` 与 `Cargo.toml`。

## 代码规范与硬约束

### 分层守卫（构建与 CI 强制）

- **Tauri IPC**：全仓仅 `src/lib/` 允许直接调用桌面端 IPC（`@tauri-apps/api/core`）。其余代码需要桌面能力时走 `src/lib` 门面。
- **渲染库解耦**：直接 `import three` 只允许 `src/engine/{rhi,rpi}/backends/` 与存量台账 `scripts/layers-three-allowlist.json`（台账只减不增）。新增文件不得直接依赖渲染库——设备操作走 RHI，渲染流程走 RPI。
- **engine 层方向**：`src/engine` 不得依赖 framework / app / runtime / UI 包；层内只准向下（rpi → rhi）。

由 `pnpm check:layers`（`scripts/check-layers.mjs`）门禁强制执行。改动涉及跨层引用前先自查，避免被门禁拦下返工。

### 生成物不手写

以下内容均由生成器产出，**禁止手工编辑**，改动源头后运行对应命令再生成：

| 产物 | 再生命令 |
| --- | --- |
| `CHANGELOG.md` | `pnpm changelog`（从 Conventional Commits 全量再生） |
| `public/docs/sdk/api.md`（SDK API 参考） | `pnpm gen:api-docs`（`tve.d.ts` 变更后执行） |
| `public/engine/`（网页预览运行时） | 由 `runtime/scripts/engine.mjs` 全量再生（构建链内） |
| `public/licenses/`（第三方许可汇总） | `pnpm gen:licenses` / `pnpm license:rust` |
| `src/generated/` | 构建期生成 |

### 行尾与编码

`.gitattributes` 强制所有 `*.md` 使用 **LF** 行尾（历史上 CRLF 曾导致文档校验脚本 frontmatter 正则失配）。Windows 上请确认编辑器不写入 CRLF，避免产生幻影改动。

### 代码风格

- TypeScript 严格模式（`vue-tsc --noEmit` 为门禁步骤，改动后必须通过）。
- 提交涉及产品名称 / 版本展示面时，`pnpm identity:check`（`scripts/check-product-identity.mjs`）会校验一致性（如 `productName`、`mainBinaryName`、`home.html`、窗口标题、README 等需同步）。

## 测试与质量门禁

以 smoke 冒烟脚本做回归测试（Node 直跑，无需 GPU/浏览器），套件集中在 `scripts/smoke/tracker/` 动态发现注册——**新脚本丢进去即被纳入**。为新增子系统补测试时，优先在该目录新增冒烟套件。

常用命令：

```bash
pnpm test                 # 单元/组件测试（vitest）
pnpm test:watch           # 监听模式
pnpm smoke                # 冒烟交互菜单（↑↓ 移动，空格勾选，回车运行）
pnpm smoke --all          # 全量回归
pnpm smoke --list         # 列出全部套件
pnpm smoke --core         # P0 核心回归（提交/PR 前必跑）
pnpm check:layers         # 分层守卫
pnpm check:surface        # 运行时全局消费面漂移守卫
pnpm test:bridge          # 桥接层契约测试
pnpm docs:test            # 内置文档示例 doctest（类型 + 真实执行）
pnpm qr:check             # 二维码编码器自检
pnpm audit:scan           # 质量 + 安全统一扫描（密钥/XSS/穿越/CVE/覆盖率/复杂度/重复）
```

### 一键门禁链

**提交/发版前请运行 `pnpm ci:local`**，任一步失败即停：

```
identity → skills → docs → types → layers → audit → surface → bridge → unit → smoke(core)
```

- `pnpm ci:local --full`：末尾追加全量归档（覆盖率阈值结算 + smoke 全量 + `reports/<日期>/`）。
- `pnpm ci:local --only <步骤名>` / `pnpm ci:local --skip <步骤名>`：只跑/跳过指定步骤；**跳过项必须在 PR 描述中注明**，否则不构成完整门禁结论。
- 已知问题：`tests/ISSUES.md` 记录 P1 已知漂移，新增失败请先对照确认是否已知项。

## 提交信息与版本发布

提交信息遵循 **Conventional Commits**，这是 CHANGELOG 分组与版本递增的唯一依据：

```
feat(scope): 新增功能
fix(scope):  修复缺陷
docs(scope): 文档
refactor(scope): 重构（无行为变化）
chore(scope): 杂项（版本、许可、构建等）
```

scope 参考现有用法：`editor`、`runtime`、`build`、`linux`、`assistant`、`identity`、`license`、`version`、`platform` 等。提交信息建议中英混合均可，但 `feat|fix|chore(scope)` 前缀格式必须正确。

### 版本递增（由维护者执行）

- 版本号单一事实源：`src-tauri/tauri.conf.json`（`scripts/sync-version.mjs` 挂在 dev/build 链首自动同步）。
- `pnpm version:bump auto`：按未发布提交自动递增（`feat`→minor、`fix`→patch、破坏性变更→major），并把新版本段写进 CHANGELOG（标「未发布」）。
- 随后提交 `chore(version): vX.Y.Z` —— **这条提交就是发版锚点**，下次 `pnpm changelog` 会给该段补上日期。

## 提交 PR 前的检查清单

1. 从最新 `base` 分支切出功能分支，改动聚焦单一目标，避免混杂无关修改。
2. 提交信息遵循 Conventional Commits（无前缀或前缀错误的提交会被回退重写）。
3. 本地 `pnpm ci:local` 全绿（跳过项在 PR 描述中注明原因）。
4. 改动涉及生成物（CHANGELOG / API 文档 / 许可证 / 运行时）时，已运行对应生成命令并提交生成结果。
5. 新增子系统/新能力时补充了单测或 smoke 套件（`scripts/smoke/tracker/`，自动发现）。
6. 跨层引用已自查分层守卫（`pnpm check:layers` 可通过）。
7. PR 描述写明：改动内容、测试方式、影响面（是否影响构建产物 / 桌面端 / 已有存档兼容性）。

## 文档贡献

- **内置用户文档** `public/docs/`（编辑器手册、SDK 教程）：内容随库内嵌、随版本同步，基于 **MIT** 许可（见 `public/docs/LICENSE`）。文档中的示例代码会经 `pnpm docs:test` 做类型与真实执行校验，改动示例时请本地跑通。
- **架构设计文档** `architecture/`：Apache-2.0 随本分支发布，描述内置助手、TCP 指令集、权限门、渲染层抽象等设计，与代码变更同步更新。
- 文档一律 LF 行尾，注意 frontmatter 格式（`skills:check` 依赖）。

## 许可说明

本项目基于 [Apache License 2.0](LICENSE) 开源。提交 Pull Request 即表示您同意您的贡献在相同许可（Apache-2.0）下发布；涉及第三方素材/依赖时，请确保许可兼容并在 `public/licenses/` 登记。
