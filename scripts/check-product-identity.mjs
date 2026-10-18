// 产品名称与版本同步门禁（社区版）：名称/版本只在事实源改，其余展示面必须跟随。
//
// 事实源：
//   - 名称 = src-tauri/tauri.conf.json 的 productName（mainBinaryName 与之相同，
//     exe 文件名/窗口标题/首页标题都取它）；
//   - 版本 = 同文件的 version（semver，exe 版本资源来源），package.json 与
//     Cargo.toml 由 scripts/sync-version.mjs 传播。
// 对外版本标签 = `r` + version（构建号 `+N` 显示为 `.N`）：1.0.0 → r1.0.0。
//
// 检查面：mainBinaryName / 首页 HTML 标题与启动页 / Rust 首页窗口标题 /
// HomeView 标题栏 / package.json / Cargo.toml / README 当前版本行 / 架构文档
// 适用版本行。任一不一致即退出码 1（build 链与 ci:local 第一步挂载）。
//
// 用法：pnpm identity:check（或 node scripts/check-product-identity.mjs）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:\+([0-9A-Za-z.-]+))?$/;

const failures = [];
const oks = [];
function check(ok, label, detail = "") {
  if (ok) oks.push(label);
  else failures.push(detail ? `${label}：${detail}` : label);
}

let conf;
try {
  conf = JSON.parse(read("src-tauri/tauri.conf.json"));
} catch (e) {
  console.error(`✗ 读取 src-tauri/tauri.conf.json 失败：${e.message}`);
  process.exit(1);
}

const name = String(conf.productName ?? "").trim();
const version = String(conf.version ?? "").trim();
const label = `r${version.replace(/\+([0-9A-Za-z.-]+)$/, ".$1")}`;

check(name.length > 0, "productName 非空");
check(conf.mainBinaryName === name, "mainBinaryName 与 productName 一致", `mainBinaryName=${conf.mainBinaryName}`);
check(SEMVER_RE.test(version), "version 为 semver（major.minor.patch[+构建号]）", version);

// 名称展示面
const homeHtml = read("home.html");
const htmlTitle = /<title>([^<]*)<\/title>/.exec(homeHtml)?.[1]?.trim();
const bootLabel = /class="boot-label">([^<]*)</.exec(homeHtml)?.[1]?.trim();
check(htmlTitle === name, "home.html 页面标题与 productName 一致", `实际 ${htmlTitle}`);
check(bootLabel === name, "home.html 启动页文案与 productName 一致", `实际 ${bootLabel}`);
check(
  read("src-tauri/src/lib.rs").includes(`.title("${name}")`),
  "Rust 首页窗口标题与 productName 一致",
  `缺少 .title("${name}")`,
);
check(
  read("src/app/components/HomeView.vue").includes(`TitleBar title="${name}"`),
  "首页标题栏与 productName 一致",
  `缺少 TitleBar title="${name}"`,
);
check(
  read("src-tauri/Cargo.toml").includes(`description = "${name} `),
  "Cargo.toml 应用描述以 productName 开头",
);

// 版本同步面
const pkg = JSON.parse(read("package.json"));
check(pkg.version === version, "package.json 版本与事实源一致", `实际 ${pkg.version}`);
const cargo = read("src-tauri/Cargo.toml");
const cargoSection = cargo.slice(cargo.indexOf("[package]"));
const cargoVersion = /^version\s*=\s*"([^"]*)"/m.exec(cargoSection)?.[1];
check(cargoVersion === version, "Cargo.toml [package] 版本与事实源一致", `实际 ${cargoVersion}`);

const readme = read("README.md");
const readmeLabel = /^>\s*当前版本\s+\*\*([^*]+)\*\*/m.exec(readme)?.[1]?.trim();
check(readmeLabel === label, "README 当前版本行与对外标签一致", `实际 ${readmeLabel ?? "未找到"}，期望 ${label}`);
const readmeTitle = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim();
check(readmeTitle === name, "README 标题与 productName 一致", `实际 ${readmeTitle}`);

const arch = read("architecture/README.md");
check(arch.includes(`对应 ${label}`), "架构文档适用版本行与对外标签一致", `缺少「对应 ${label}」`);

for (const line of oks) console.log(`✓ ${line}`);
for (const line of failures) console.error(`✗ ${line}`);
if (failures.length) {
  console.error(`\n产品身份门禁失败：${failures.length} 项不一致（事实源 = src-tauri/tauri.conf.json）。`);
  process.exit(1);
}
console.log(`\n产品身份一致：${name} · ${version}（显示 ${label}）`);
