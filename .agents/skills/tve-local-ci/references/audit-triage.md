# 单元：audit 分诊与修复配方（质量/漏洞/性能/UI 检测出项怎么处置）

audit 步的完整发现清单在 `reports/audit/audit-report.md`（机读版同目录 .json）。
门禁只拦 Blocker/Critical/未接受 High（口径见 SKILL.md），Major/Minor 是**跟踪债**，
本单元定义每类发现的真伪甄别、修法与"设计内保留"条件。单跑：`pnpm audit:scan`；
接受设计内项：`node scripts/audit/scan.mjs --accept <token> --reason "理由"`（入 tests/AUDIT-LEDGER.json）。

## 分诊总表（按 rule）

| rule | 真伪甄别 | 修法 | 设计内保留条件 |
|---|---|---|---|
| `panic.unwrap` | **先切掉文件内 `#[cfg(test)]` 模块再统计**——扫描器只排除独立 tests/benches 文件（scripts/audit/rules/security-rust.mjs:21），内联测试全被计入 | 只有"外部输入可达且 Option/Result 真可能为 None/Err"的才改 `ok_or/?/expect(不变量说明)` | 锁 unwrap（投毒即应用级不可续）、带不变量说明的 expect（"刚确保存在"类）、`serde_json::to_string` 型近不可失败 |
| `quality.empty-catch` | 扫描器把**仅注释的 catch 也算空**（政策性），跨行 `.catch((e) => log(...))` 会误报 | 裸 `/* ignore */` 必须补精确原因注释（抑制变决策）；IO/解析路径的真静默补统一日志 | 显式发后即忘 `.catch(() => {})`（窗口 show/close/遥测）；带精确注释的降级（"缺失按默认"类）——注释不算清，属接受噪音 |
| `perf.serial-await` | 有误报：`for/while` 后 25 行内出现 `await` 即报（scripts/audit/rules/quality-code.mjs 的启发式），`Promise.all` 行会被误计 | 并行化前**逐一核实**：① 缓存是否在途安全（先存 promise 再 await，如 `loadImageTex`/`loadModule`）；② 是否共享 store 状态变更；③ 是否进度蒙版逐项语义 | 进度蒙版逐项装载（AudioSystem.preload）、首匹配探测循环（早退）、LLM 对话轮次、共享 store 的 saveAll/delete |
| `perf.clone-roundtrip` | 无误报 | 换 `structuredClone`；**语义前提=纯 JSON 数据**：JSON 往返静默剥函数，structuredClone 遇函数抛 DataCloneError | 数据可能含函数/Proxy 的兜底链保留 JSON（范例 src/runtime/core/tve/data-center.ts:57） |
| `quality.file-xl` / `file-long` | 无误报，但并非都要拆 | 按 P0-P2 排期拆（见下"模块化"） | `tve.d.ts`（SDK 契约面）、`src/generated/**`（生成物）、smoke 跟踪器（测试场景文件） |
| `quality.complexity` / `fn-xl` | 启发式（花括号深度边界） | 分支收敛/提前返回/抽子函数；牵动引擎骨架时列排期不盲改 | —— |
| `cve.*` | 查是否 dev 依赖（不参与分发） | 升级（黄灯需确认）或 `--accept` 入台账说明 | dev 依赖暂不升级可入台账 |
| `conf.csp-null` | 真实硬化缺口 | 专项任务：收紧 CSP 并全窗口回归（黄灯，改公共配置） | 台账跟踪 |
| `xss.v-html` / `exec.*` / `trav.*` | 逐个核对内容来源 | 用户本机文档渲染等设计内 → 入台账写明理由+复核日期 | —— |

## 性能修复形态（并行装载的标准写法）

- 批量预取：`Promise.all(rels.map(async ...))` + **在途去重表**（`loading` Map 先
  set promise 再 await），范例 src/framework/material/MaterialManager.ts:97。
- 读-改-写共享索引：改**一次批量读改写**，不是并行逐个（并行会互相覆盖），
  范例 `ensureWhiteboardMetas`（src/whiteboard-window/whiteboard-meta.ts:46）。
- 实例化保序：模块**并发预载 + 顺序实例化**（构造副作用顺序不变），
  范例 src/runtime/core/scripts.ts 的 instantiate。

## UI 质量专项（令牌单一事实源，详见 tve-self-evolution 的主题记忆）

1. 裸色扫描面：`.vue` 的 `<style>` 段 + 全部 `.scss`（TS 里的 three.js 颜色是 3D 内容不算 UI）。
2. 三类违规：① 纯裸 hex（无 `var(`）；② `var(--token, #hex)` 失效兜底——令牌都在
   `:root` 定义、兜底永不生效，且是令牌改值后的过时谎言（曾清理 313 处，含 84 处
   `var(--accent, #4a9eff)` 旧蓝值）；③ 自造变量名（`:root` 没有的 `--x`）。
3. **合法豁免**：模板/JS 注入的动态变量（`:style` 绑定 `--gcard-color`、`setProperty`
   注入 `--sv-*`）、Monaco 语法配色、渠道身份色、`#fff` 选中白、`#e81123` Windows
   关闭钮红、`#000` 预览黑底、透明棋盘格。
4. 令牌可用的前提：该窗口入口 import 了 `src/styles/global.scss`（五个窗口全走此链）。
5. 修完必须 `pnpm exec vite build`——ci:local 不编译 SCSS。
6. 图标按钮规则：固定尺寸（≤44px）小按钮块内必须 `padding: 0`（全局 button 有 4px 11px）。

## 耦合分析（import 图，audit 不覆盖、自行跑脚本）

- 口径：**值导入环才算环**——必须先整句剥 `import type ...`（子句 `type {X}` 会骗过
  naive 正则，导致把类型环误报成 13 节点大环）；`export {...} from` 是值转发。
- 已核实基线（2026-10-11）：分层零反向（framework/runtime/lib/ui-kit 不 import app 层）；
  真实值导入环 4 个，全在 app 层 store/service 懒访问互引（Pinia 常规，运行时安全）——
  报告不重构。
- 扇入 Top 是门面属健康（src/lib/api.ts 72）；扇出 Top 是组合根（InspectorPanel）
  与引擎门面（EditorEngine），关注增速不追单一数字。

## 模块化拆分优先级（file-xl 债务）

P0：`src/runtime/runtime/physics.ts`（按主线程胶水/Worker 协议/碰撞缓存切）、
`src/framework/engine/modules/SceneSynchronizer.ts`。P1：animation/ui/graph-core-modules
（后者兼有复杂度超标）。P2：三个巨型组件（AssistantChat/WhiteboardStage/GraphCanvas）
抽子组件或 composable。拆分手感遵循"脚本按区间切、切完重跑模块验证脚本"的仓库约定。

## 修复后的验证（门禁清单）

1. `pnpm ci:local`（最低整链；快速迭代 `--only types,audit,unit` 但输出会注明不完整）。
2. 改了 `.scss`/`<style>` → 加跑 `pnpm exec vite build`（SCSS 编译只有这里验）。
3. 复扫对比 `reports/audit/audit-report.md` 的分级统计：修复类别必须下降、
   **不得出现新 rule 类别**（token 级新增/已修复差分是内容哈希置换，看类别计数）。
4. 并行化改动追加：相关 smoke 套件（`pnpm smoke <id>`）+ 关联影响自查
   （错误语义从"首个失败早退"变"全部完成后聚合"是否影响调用方）。

## 测试例

- 本单元的可执行校验：`pnpm audit:scan` 出报告 + `pnpm ci:local --only audit`。
- 分诊手法自检：对 `panic.unwrap` 计数前先剥 `#[cfg(test)]`，剥完 preview.rs/devtools.rs
  的生产面应只剩锁 unwrap 与带说明 expect（2026-10-11 实测 0 外部输入 panic 源）。
