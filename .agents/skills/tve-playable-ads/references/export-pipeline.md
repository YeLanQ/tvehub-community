# 单元：构建导出链（playable 渠道）

## 契约

**三层注册**（新渠道协议实例，与 web/wechat 同构）：

| 层 | 位置 | 内容 |
|---|---|---|
| 前端 adapter | `src/app/lib/build/channels.ts` `PLAYABLE_CHANNEL` | runtimeOptions 同 web；ipc.applies：title/gzip 生效、**singlePage/cdn 不适用**（false） |
| manifest 扫描 | `runtime/scripts/manifest.mjs` `scanPlayable()` | 复用 scanWeb 文件集（playable = web 运行时 + 契约层），仅 id 不同 |
| Rust 工厂 | `src-tauri/src/build/pipeline.rs` `channel_pipeline("playable")` | → `channels/playable/` PlayablePipeline |

**目标注册表**（改一处必改另一处，双侧 spec/单测同题锚定）：
- TS：`src/app/lib/build/playable-targets.ts`（id/label/desc/form/available）
- Rust：`src-tauri/src/build/channels/playable/targets.rs`
- 形态语义：single → `<目标>/index.html` 全内联直传；multi → `<目标>/` 普通
  静态站点（**强制不产 assets.gzip**——那是 web 托管格式）+ **自动打包上传 zip**
  `<目标>.zip`（内层命名约定 `<目标>/` + 入口改名 `<目标>.html`，见 Rust
  zip_package.rs；目录本身保留供本地预览）；both → `<目标>/single/` +
  `<目标>/multi/`（机制就绪，注册表暂无 both 目标）。

**选项与 IPC**：`BuildOptions.playableTargets?: string[]`（仅可用项进 IPC
`playableTargets`）+ `playableTemplates?: {single, multi}`（与 web 渠道
templates 分开持久化——playable 允许两形态并存）；产物约束在 Rust resolve/
build 强制：CDN 恒关（试玩禁外链）、multi 恒非 gzip、gzip 只作用单页内联。

**双入口模板注入**（`src/app/lib/build/playable-artifacts.ts`）：
`files["index.html"]` = 单页模板（{{BUILD_DATA}} 占位）；`files["index-multi.html"]`
= 多文件模板（命中既有 index-* 入口页分类器，零分类器改动）。多文件形态产物
的入口由 Rust 取 index-multi.html 写为目标目录 index.html，两个入口键都不泄漏
进产物。

**Rust 管线**（`channels/playable/mod.rs`）：preflight（目标空集/未知/未支持/
缺入口模板全拦截）→ `build_content` 场景资产**只收集一次** → release 压缩一次
→ 形态去重组装 ≤2 份（单页走 `forms::assemble_single_page`，多文件走
`forms::assemble_multi_file`——共享形态机在 `src-tauri/src/build/forms/`，原
web 渠道私有提升而来）→ 逐目标 `scene_pack::write_export_dir` 原子落盘，multi
形态再跑 `zip_package::write_target_zip` 打包 `<目标>.zip`（deflate，zip crate
仅 deflate-flate2 特性）。
config 仅此渠道插 `playableAd:true` + `playableTargets:[ids]`（运行时契约层
激活键）。`BuildResult.targets` 逐目标回带 `{id, form, out_rel, html_bytes,
zip_rel?}`（zip_rel 仅 multi 形态）。

## 使用例

一次导出的调用链：BuildPanel（doBuild）→ `run.ts runBuild` →
`collectExportFiles("playable")` → `applyPlayableExportArtifacts`（双入口注入）
→ `buildIpcArgs`（extraIpc 收敛 targets）→ `api.buildExport` → Rust
`run_build` → PlayablePipeline。前端 UI 在 `BuildPlayableSettings.vue`
（目标勾选列表 + 形态徽标 + 模板两槽），配置持久化 build.config.json
（prefs.ts）。

## 测试例

- Rust：`src-tauri/src/build/tests/playable_e2e.rs`（多目标×gzip 双形态/真实
  目标混形态 ironsource(single)+mintegral(multi) 目录布局/config 激活键/
  preflight 拦截矩阵/CDN 强制关）+ `channels/playable/mod.rs` 内 build_form
  单测（锁 multi 组装细节：入口改键/附带货/场景落盘）+ targets.rs 注册表锚测。
- 前端 vitest：`playable-targets.spec.ts` / `playable-artifacts.spec.ts` /
  `channels.spec.ts`。
- 运行 `cargo test --lib` + `pnpm ci:local` 全链。

## 排查

| 症状 | 定位 |
|---|---|
| 构建报「请至少勾选一个广告渠道目标」 | 渠道设置目标列表为空（canBuild 也应已拦——双保险） |
| 报「未知目标 / 尚未支持」 | playableTargets 里有占位 id（旧 prefs 残留）或注册表双侧不同步 |
| 报「缺少单页/多文件入口模板」 | playable-artifacts 注入链断（模板列表空/形态计算错） |
| multi 目标 zip 未生成 / 平台拒收包结构 | zip 由 Rust 落盘后打包（`zip_package.rs`），失败会中断构建报错；平台拒收先核对内层命名约定（`<目标>.zip > <目标>/ > <目标>.html`，Luna 转述的官方要求）——如后台实际要 index.html，改 write_target_zip 的 entry_html 一处即可 |
| CTA 点了没反应 | 控制台看 `[playable]` 日志：web 宿主 = 空转属预期；宿主探测落定日志缺失 = 产物 config 无 playableAd 键 |
| 打点缺失 | report 链未激活（surface null）或脚本没调——控制台应恒有 `[playable] 事件打点` 留痕 |
| 产物体积超预算 | 结果区黄色提示（>5MB）；开发布模式压缩 / 检查资产体积 |
