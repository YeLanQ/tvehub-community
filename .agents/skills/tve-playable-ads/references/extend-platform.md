# 单元：新增广告平台适配配方（checklist）

按序逐条执行；**全部走内置契约，不新建协议/全局/第二套探测**。示例语境：接入
postMessage 族（ironSource/Mintegral/TikTok-Pangle）——它们的注册表条目已占位。

## 配方

1. **目标注册表解锁**（双侧镜像，同一次提交）：
   - `src/app/lib/build/playable-targets.ts`：对应条目 `available: true`，
     核对 `form`（ironSource=multi ZIP 上传 / pangle=single；需要两形态并存
     的平台用 `both`——组装层已支持，产物自动分 `<id>/single|multi/`）；
   - `src-tauri/src/build/channels/playable/targets.rs` 同步同条目；
   - 两侧同题测试（playable-targets.spec.ts 的形状锚 / targets.rs
     registry_shape）断言随之更新——这是镜像对齐的守护位。
2. **适配器**：`src/runtime/runtime/playable/adapters/<id>.ts` 实现
   `PlayableHost` 五成员（id/cta/isViewable/onViewableChange/report）：
   - 宿主全局用 cast 式访问（`(window as {...}).xxx`），不进 bridge、不加
     新引擎全局；
   - `report` 是**打点接线点**：postMessage 族在此映射平台协议
     （`window.parent.postMessage(JSON.stringify({name: ...}), "*")` 或桥对象
     方法）。事件名逐家以**官方当前 spec 为准**（历史资料可能过期；ironSource
     已并入 Unity LevelPlay，文档在 Unity Grow 侧）——核不到官方页不动笔；
   - CTA 语义注意：部分平台（ironSource 类）结束卡/下载由宿主 SDK 渲染，
     `cta()` 可能是 no-op 而 `report("gameOver")` 才是触发器——按平台文档定。
3. **探测链挂载**：`detect.ts` 按插入位置调 `detect<Platform>()`。顺序即
   优先级——mraid 永远最先（IAB 标准优先）；新平台放 meta/google 前后按
   全局名冲突可能性决定（互斥全局不冲突时顺序不敏感）。
4. **smoke 用例**：`scripts/smoke/tracker/smoke-playable-ad.mjs` 加一个
   `loadModule("<tag>")` 块（查询串隔离模块单例）——注入假宿主全局 → 断言
   探测落定 / CTA 映射 / report 转发（console 捕获手法见套件 [6] 块）。
5. **e2e 形态**：该平台形态若是 multi/both，`playable_e2e.rs` 补对应目标的
   目录布局断言（build_form 机制已有单测兜底）；single 平台零 Rust 改动。
6. **SDK 文档**（仅当统一面 API 变了才需要；纯新适配器不动 tve.d.ts）：
   改 `src/framework/scripting/tve.d.ts` → `pnpm gen:api-docs` +
   `pnpm docs:test` → tve-sdk-scripting 模板同步。
7. **验证链**：`node runtime/scripts/engine.mjs` → `pnpm smoke playable-ad` →
   `cargo test --lib` → `pnpm ci:local` 全链 → 技能文档同步（本技能
   SKILL.md 契约速览的目标可用性行、export-pipeline 注册表描述）。

## 上架前置（代码之外）

平台账号 / 素材后台上传验证是**人工步骤**：单页直传 or ZIP 打包（multi 产物
目录自行 zip）、平台审核规格（体积/时长/首帧要求）逐家核对。产物侧已保证：
单文件全内联、无外链（CDN 强制关）、无 assets.gzip。

## 禁止事项（重申）

- 不在适配器之外探测宿主全局；不让用户脚本感知平台差异（`engine.playableAd.host`
  只读诊断用，分支逻辑写进适配器）；
- 不为单个平台加「平台 if 分支」到 player.mjs / 引擎核心——差异收敛在适配器；
- 不绕过注册表直接往 detect 塞无注册表条目的平台（preflight 会拒，
  构建面板也不可勾）。
