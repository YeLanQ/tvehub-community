# 单元：运行时宿主契约层（src/runtime/runtime/playable/）

## 契约

**文件布局**（模块无副作用，一切经 `installPlayableAd(cfg)` 显式安装）：

| 文件 | 职责 |
|---|---|
| `types.ts` | `PlayableHostId`（"web"/"mraid"/"meta"/"google"/"mintegral"）+ `PlayableHost` 统一适配器接口 |
| `detect.ts` | 探测链（mraid → meta → google → mintegral → web 回退），只读全局对象形状、零副作用 |
| `adapters/mraid.ts` | IAB mraid：ready 等待（3s 超时放行）/ viewableChange / `mraid.open()` |
| `adapters/meta.ts` | FbPlayableAd.onCTAClick（新）/ FBPlayableOnCTAClick（旧） |
| `adapters/google.ts` | ExitApi.exit() |
| `adapters/mintegral.ts` | window.install()（CTA）/ window.gameEnd()（gameOver/gameEnd 转发） |
| `index.ts` | 安装入口：统一面单例 + window 面安装 + 可见性监听汇聚 + 自动 gameStart |

**宿主 id ≠ 导出目标 id**：ironsource 目标（Unity Grow）官方 spec=MRAID 3.0，
运行时探测落 `"mraid"`；目标是构建侧概念（决定产物形态/目录），宿主 id 只按
运行时真实契约落名。

**PlayableHost 接口**（一个平台一份实现）：`id` / `cta()` / `isViewable()` /
`onViewableChange(cb) → 解绑函数` / `report(event, data?)`（平台转发位；meta/
google/mraid 无游戏事件 API = no-op；mintegral 把 gameOver/gameEnd 转发
window.gameEnd；其余留痕在安装层统一做）。

**安装门控**：`installPlayableAd(cfg)` 读产物 config——`cfg.playableAd !== true`
返回 null 零开销休眠（web/wechat 渠道与编辑器预览不写该键）；重复调用幂等返回
首次句柄 `{ surface, ready }`。

**统一面**（`window.__tvePlayableAd` 与 SDK `engine.playableAd` 同源单例，
SDK 转发层在 `src/runtime/core/tve/playable-api.ts`）：
`host` / `cta()` / `isViewable()` / `onViewableChange(cb)` /
`report(event, data?)`。行为要点：
- `cta()`：委托宿主适配器；宿主 = web 时空转并一次性 console.warn 说明
  （本机自测常见困惑点）；
- `report()`：控制台**恒留痕**（`[playable] 事件打点: <event> <data>`）+ 委托
  宿主转发；`gameStart` 由安装层在 `ready` 落定后自动上报一次（脚本无需手动调）；
- 宿主全局访问写法：适配器内用 **cast 式** `(window as { mraid?: MraidLike }).mraid`
  ——不构成 check-surface 的未垫消费面（window.`__tve*` 前缀豁免 + cast 不匹配
  `window.X` 扫描形态）；宿主全局永远不进 runtime/bridge 垫片。

**可见性门**（player.mjs 接线，~15 行）：帧门控第 4 布尔 `playableVisible` 并入
`scheduleFrame()`；mraid viewableChange=false → 暂停 + `resumePending=true`
（恢复丢大帧间隔，与 pageHidden 同机制）；`ready` 落定后回读一次初始可见性。
meta/google 无该 API，页面级隐藏由 document.hidden 天然覆盖。

## 使用例

脚本消费侧三点用法（cta / onViewableChange / report）与 EndCard 完整模板见
tve-sdk-scripting references/ui-audio-fx.md；API 契约事实源
`src/framework/scripting/tve.d.ts` 的 `PlayableAdApi`（文档示例
`scripts/api-docs/examples/interfaces/PlayableAdApi.md`，改 tve.d.ts 必跑
`pnpm gen:api-docs` + `pnpm docs:test`）。

## 测试例

`scripts/smoke/tracker/smoke-playable-ad.mjs`（node 直跑 public/engine 产物，
`pnpm smoke playable-ad`）：①未启用零安装 ②探测链逐平台命中与 CTA 映射
③viewableChange 转发/解绑 ④web 回退空转 ⑤重复安装幂等 ⑥打点（自动
gameStart 留痕 / 手动 report 携带数据 / 未激活空转）。
**模块单例隔离手法**：`import(url + "?case=<tag>")`——ESM 按 URL 缓存，查询串
产独立实例；用例前后 `clearHosts()` 清理注入的宿主全局。

改契约层后必跑：`node runtime/scripts/engine.mjs`（重建产物）→
`pnpm smoke playable-ad` → 存量 web e2e（零扰动回归）→ `pnpm ci:local`。
