---
name: tve-playable-ads
description: TvE Hub 试玩广告渠道（playable）全量接口设计：构建渠道（目标注册表/单页多文件形态导出/双入口模板）、运行时宿主契约层（engine.playableAd 统一面 = CTA/可见性暂停/打点上报）、平台适配扩展配方（meta/google/mraid/ironsource/mintegral 已落地，pangle 占位待官方 spec）。凡要加广告平台适配、写结束卡/CTA/打点脚本、动 build/playable 导出链、排查试玩产物问题，一律先用本技能——宿主对接禁止绕开内置契约另写一套。
---

# 试玩广告渠道（playable）

## 硬规则（动手前必须知道——本技能存在的意义）

1. **宿主对接只有一套**：CTA / 可见性 / 打点全部经统一面
   `engine.playableAd`（实现 `src/runtime/runtime/playable/`，安装为
   `window.__tvePlayableAd`，SDK 面与 window 面同源单例）。
   - **禁止**在用户脚本里直接探测/调用 `window.mraid`、`FBPlayableOnCTAClick`、
     `ExitApi` 等宿主全局——探测与映射是适配器层（adapters/）的职责，脚本只调
     统一面；
   - **禁止**新增非 `__tve` 前缀的引擎全局（check-surface 拦截）；广告宿主全局
     （mraid 等）**不得**加进 runtime/bridge 垫片——bridge 是微信环境垫片层，
     广告宿主是 web 侧真实环境，方向相反；
   - **新平台 = 目标注册表条目 + adapters/ 一个适配器 + detect 链挂探测**，
     按 references/extend-platform.md 配方走，不新建第二套协议/第二套全局。
2. **测试口径分裂**：`src/runtime` 下**不能放 vitest spec**（engine.mjs
   collectInputs 会把 .spec.ts 编译进产物）——运行时契约层走 smoke
   （`scripts/smoke/tracker/smoke-playable-ad.mjs`，import 查询串隔离模块单例）；
   前端构建链（src/app/lib/build/）才用同目录 `*.spec.ts`。
3. **web/wechat 产物零扰动是契约**：config 的 `playableAd/playableTargets` 键
   仅 playable 渠道写入（沿 gzipBase「仅启用才插」先例）；契约层在
   `config.playableAd !== true` 时零开销休眠。改契约层必须保持这一点，
   存量 web/wechat e2e 就是回归网。
4. **构建渠道三层协议**（与 web/wechat 同规）：前端 channels.ts 一个 adapter +
   manifest.mjs 一个扫描函数 + Rust 工厂一处注册；渠道互不可见（共享机制在
   forms/kernel 公共层，渠道只编排）。

## 路由表

| 要做的事 | 读 |
|---|---|
| 写结束卡/CTA/打点脚本（engine.playableAd 消费侧） | references/contract-layer.md 契约节；完整模板在 tve-sdk-scripting references/ui-audio-fx.md |
| 加一个广告平台适配（解锁占位目标） | references/extend-platform.md（逐条 checklist + 已核平台结论表） |
| 动构建导出链（目标注册表/形态/模板/产物布局/IPC） | references/export-pipeline.md |
| 排查 playable 产物问题（构建失败/CTA 无反应/打点缺失/白屏） | references/export-pipeline.md 排查节 |

## 契约速览（细节在 references/）

- **SDK 面**：`engine.playableAd.{host, cta(), isViewable(), onViewableChange(cb), report(event, data?)}`；
  `host` ∈ "mraid" | "meta" | "google" | "mintegral" | "web"（web = 非广告环境，
  全部空转+留痕；ironsource 目标官方=MRAID 3.0，探测落 "mraid"）。
- **探测链**（detect.ts，首个命中胜出）：mraid（loading→ready 等待 3s 超时）→
  meta（FbPlayableAd 新 / FBPlayableOnCTAClick 旧）→ google（ExitApi）→
  mintegral（window.install / gameEnd）→ web 回退。
- **打点**：gameStart 宿主落定后**自动上报一次**；gameOver/gameRestart/自定义
  事件由脚本按时机 `report()`；转发平台通道（mintegral gameOver→window.gameEnd）
  + 控制台恒留痕。
- **目标注册表**（TS/Rust 双侧镜像）：meta/google/mraid/ironsource 可用（均
  single 单页）、mintegral 可用（multi 多文件 zip 路线）；pangle（single）占位
  「官方 spec 登录墙内未核实」。逐家官方 spec 结论见 references/extend-platform.md
  已核平台结论表。
- **产物**：`build/playable/<目标>/index.html`（single）或 `<目标>/`（multi
  静态站点，**自动附上传包 `<目标>.zip`**，内层 `<目标>/<目标>.html` 命名约定）；
  both 目标分 `<目标>/single/` + `<目标>/multi/`。

## 姊妹技能

**脚本模板**（EndCard 完整可抄代码）：tve-sdk-scripting references/ui-audio-fx.md；
**引擎/构建管线全局视角**：tve-engine-interfaces（build-assets.md /
player-runtime.md）；**测试规范**：tve-unit-testing；**文档同步义务**：
tve-self-evolution（drift-map.md 有 playable 专属行）。
