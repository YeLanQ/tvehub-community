// Rust 侧第三方声明生成：
//   cargo about（本地 registry 缓存，离线）汇总 src-tauri 依赖的许可与版权 →
//   public/licenses/rust-crates/NOTICES.html（声明正文，关于页「查看全文」按需
//   加载）→ meta.json（单条登记项，随清单进「关于」）。
//   计数取 cargo-about 实际收录的 crate（按构建目标 cfg 筛选：与随包分发面
//   一致），不用 Cargo.lock 全量——lock 含其他平台/工具链的包，写进声明计数
//   会虚高。
// 重生成时机：依赖变更 / 发版前。用法：pnpm license:rust
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = "public/licenses/rust-crates";

fs.mkdirSync(`${ROOT}/${OUT_DIR}`, { recursive: true });

// 第一趟：JSON 版只用于统计实际收录 crate（同一次生成结果，两趟成本可接受）
const tmpJson = path.join(os.tmpdir(), `tve-rust-notices-${process.pid}.json`);
execSync(
  "cargo about generate --format json --manifest-path src-tauri/Cargo.toml --locked " +
    `-o "${tmpJson}"`,
  { cwd: ROOT, stdio: "inherit" },
);
const data = JSON.parse(fs.readFileSync(tmpJson, "utf8"));
fs.rmSync(tmpJson, { force: true });
const crateKeys = new Set();
for (const license of data.licenses ?? []) {
  for (const used of license.used_by ?? []) {
    crateKeys.add(`${used.crate.name} ${used.crate.version}`);
  }
}
const crateCount = crateKeys.size;

// 第二趟：渲染声明正文（自有 crate 由 Cargo.toml 的 publish=false + private.ignore 排除）
execSync(
  "cargo about generate --manifest-path src-tauri/Cargo.toml --locked " +
    '-o "public/licenses/rust-crates/NOTICES.html" scripts/rust-notices.hbs',
  { cwd: ROOT, stdio: "inherit" },
);

const meta = {
  id: "rust-crates",
  name: "Rust 依赖第三方声明（cargo-about 汇总）",
  version: "—",
  license: "多许可（见声明正文）",
  homepage: "https://github.com/YeLanQ/tvehub",
  note: `桌面端 Rust 依赖（${crateCount} crate，按构建目标筛选）的许可与版权声明汇总，由 cargo-about 从本地依赖缓存生成；重新生成：pnpm license:rust`,
  source: `src-tauri/Cargo.lock（cargo-about 按构建目标筛选后 ${crateCount} crate）`,
  generatedBy: "scripts/gen-rust-notices.mjs",
};
fs.writeFileSync(`${ROOT}/${OUT_DIR}/meta.json`, JSON.stringify(meta, null, 2) + "\n");
console.log(`[gen-rust-notices] OK: ${OUT_DIR}/NOTICES.html + meta.json (${crateCount} crate)`);
