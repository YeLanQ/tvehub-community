// ---------------------------------------------------------------------------
// 把 three 的运行时构建与模型加载器 vendor 进网页预览运行时（public/engine）：
// - three 构建 → public/engine/core/（three.module.min.js = WebGL 渲染器 +
//   three.core.min.js 共享核心；three.webgpu.min.js = WebGPU 渲染器，同样依赖
//   three.core.min.js，故两套渲染器共享同一份核心类，场景对象可互用）；
// - 模型加载器 → public/engine/runtime/loaders/（离线可用）。加载器清单持续瘦身：
//   DRACOLoader 已改由 runtime/scripts/engine.mjs 从 npm 源打包进生成的
//   compressed.mjs（顶层 new URL 补丁在构建期做），不再 vendor；
// - Draco JS 解码器 → loaders/draco/（压缩 glTF 预览/导出必需；见
//   DRACO_DECODER_FILES 注释说明为何不用 wasm 版）。
//
// public/engine 为纯构建产物目录（不入库）：本步骤已并入 engine.mjs 的
// 统一入口（buildRuntime() 先调 vendorPreviewLoaders()），dev 启动与 build 链
// 自动补齐；所有写入均做变更检测（内容一致不落盘），重复执行幂等、不触发 watcher 抖动。
// 也可单独运行：node runtime/scripts/vendor-preview-loaders.mjs（如升级 three 后主动同步）。
// 若上游出现新的未知 import 会直接报错退出，避免静默产出缺依赖的文件。
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { writeIfChanged } from "./lib/fs.mjs";
import { ENGINE_DIR, ROOT } from "./lib/paths.mjs";

const threeDir = join(ROOT, "node_modules", "three");
const outDir = join(ENGINE_DIR, "runtime", "loaders");
const coreDir = join(ENGINE_DIR, "core");

/** three 运行时构建（public/engine/core/）：THREE_BUILD_PATCHES 锚点补丁外与 npm 包字节一致 */
const THREE_BUILDS = ["three.core.min.js", "three.module.min.js", "three.webgpu.min.js"];

// 源路径（相对 examples/jsm）→ 目标文件名 + 相对 import 重写规则
const FILES = [
  { src: "loaders/GLTFLoader.js", rewrites: { "../utils/BufferGeometryUtils.js": "./BufferGeometryUtils.js", "../utils/SkeletonUtils.js": "./SkeletonUtils.js" } },
  { src: "loaders/FBXLoader.js", rewrites: { "../libs/fflate.module.js": "./fflate.module.js", "../curves/NURBSCurve.js": "./NURBSCurve.js" } },
  { src: "loaders/OBJLoader.js", rewrites: {} },
  { src: "libs/meshopt_decoder.module.js", rewrites: {} },
  { src: "utils/SkeletonUtils.js", rewrites: {} },
  { src: "utils/BufferGeometryUtils.js", rewrites: {} },
  { src: "libs/fflate.module.js", rewrites: {} },
  { src: "curves/NURBSCurve.js", rewrites: { "../curves/NURBSUtils.js": "./NURBSUtils.js" } },
  { src: "curves/NURBSUtils.js", rewrites: {} },
  { src: "animation/CCDIKSolver.js", rewrites: {} },
];

/** Draco 解码器（examples/jsm/libs/draco/gltf/ → loaders/draco/，字节复制）。
 *  固定 JS 版：运行时文件经「文本 IPC」通道分发（预览/导出/远程预览共用），
 *  二进制 wasm 无法安全通过（UTF-8 往返损坏）；JS 解码慢约一倍，属加载期
 *  一次性成本（编辑器视口走 wasm 快路径，不受影响）。 */
const DRACO_DECODER_FILES = ["draco_decoder.js"];

/** three 上游缺陷的构建期补丁（锚点失配显式失败——three 升级后须按新文本更新）：
 *  1. three.core.min.js ImageBitmapLoader 成功链缺 return——缓存 promise 的解析值
 *     为 undefined，同 URL 并发加载命中在途分支时 onLoad(undefined) →
 *     new Texture(undefined) → 渲染期逐帧 "no image data found"（proto=undefined）。
 *     注意 esbuild 会把 `;return s` 压成 `,s}` 逗号表达式——验证产物含补丁不能搜 `;return`。
 *  2. three.module.min.js setTexture2D 空图守卫 `null===e` 放过了 undefined
 *     （undefined !== null 会坠入 image.complete 抛 TypeError）——放宽为 null==e
 *     并在告警里带 name/uuid/proto 身份（proto=undefined ⟺ image 为 undefined）。
 *  3. GLTFLoader 纹理 onLoad 空图拒绝：异常图像不再建残缺纹理（材质回退基础色），
 *     loadTexture 的 .catch(()=>null) 保证单贴图失败不炸整个模型。 */
const THREE_BUILD_PATCHES = [
  {
    file: "three.core.min.js",
    name: "ImageBitmapLoader 并发缓存返回值",
    anchor: "`image-bitmap:${t}`,s),e&&e(s),r.manager.itemEnd(t)})",
    replacement: "`image-bitmap:${t}`,s),e&&e(s),r.manager.itemEnd(t);return s})",
  },
  {
    file: "three.module.min.js",
    name: "setTexture2D 空图守卫放宽 + 身份日志",
    anchor: '{const e=t.image;if(null===e)v("WebGLRenderer: Texture marked for update but no image data found.");',
    replacement:
      '{const e=t.image;if(null==e)v("WebGLRenderer: Texture marked for update but no image data found. name="+(t&&t.name)+" uuid="+(t&&t.uuid)+" proto="+((e&&e.constructor&&e.constructor.name)||typeof e));',
  },
];

/** GLTFLoader 文本补丁（vendored 前按上游原文应用；tab 缩进） */
const LOADER_TEXT_PATCHES = [
  {
    file: "loaders/GLTFLoader.js",
    name: "纹理 onLoad 空图拒绝",
    anchor:
      "\t\t\t\t\tonLoad = function ( imageBitmap ) {\n\n\t\t\t\t\t\tconst texture = new Texture( imageBitmap );",
    replacement:
      "\t\t\t\t\tonLoad = function ( imageBitmap ) {\n\n\t\t\t\t\t\tif ( imageBitmap === undefined || imageBitmap === null ) {\n\n\t\t\t\t\t\t\treject( new Error( 'THREE.GLTFLoader: texture onLoad 收到空图像（上游缓存缺陷兜底），材质回退基础色' ) );\n\n\t\t\t\t\t\t\treturn;\n\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tconst texture = new Texture( imageBitmap );",
  },
];

/** 锚点式文本补丁应用（失配即抛——静默漂移比构建失败更危险） */
function applyTextPatches(fileName, text, patches) {
  let out = text;
  for (const p of patches.filter((x) => x.file === fileName)) {
    if (!out.includes(p.anchor)) {
      throw new Error(`${fileName} 补丁锚点失配（${p.name}）——three 升级后请按新文本更新 vendor-preview-loaders.mjs`);
    }
    out = out.replace(p.anchor, p.replacement);
  }
  return out;
}

export function vendorPreviewLoaders(why = "") {
  const threeVersion = JSON.parse(readFileSync(join(threeDir, "package.json"), "utf8")).version;
  const header = (src) =>
    `// Vendored from three@${threeVersion} examples/jsm/${src}\n` +
    `// 由 runtime/scripts/vendor-preview-loaders.mjs 生成（import 已重写指向预览运行时本地文件），请勿手改。\n`;

  let written = 0;
  mkdirSync(outDir, { recursive: true });
  const rewritten = [];
  for (const { src, rewrites } of FILES) {
    const from = join(threeDir, "examples", "jsm", src);
    let text = readFileSync(from, "utf8");
    // 上游缺陷补丁（按上游原文锚定，先于 import 重写）
    text = applyTextPatches(src, text, LOADER_TEXT_PATCHES);
    // three 裸导入（含多行 import 块结尾的 "} from 'three';"）→ 本地 three 运行时
    text = text.replace(/from\s+'three';/g, "from '../../core/three.module.min.js';");
    for (const [fromRel, toRel] of Object.entries(rewrites)) {
      text = text.split(`from '${fromRel}'`).join(`from '${toRel}'`);
    }
    // 残留未知相对/裸 import（上游结构变化）→ 显式失败，避免产出缺依赖文件。
    // "three/…" 只出现在 JSDoc 的 @three_import 文档行里，不是真实 import，放行。
    const unknown = [...text.matchAll(/from\s+'([^']+)';/g)]
      .map((m) => m[1])
      .filter((s) => s !== "../../core/three.module.min.js" && !s.startsWith("./") && !s.startsWith("three/"));
    if (unknown.length) {
      throw new Error(`${src} 存在未处理的 import: ${unknown.join(", ")}（请更新 vendor 脚本的 rewrites）`);
    }
    // 单页导出会把运行时模块内联为 blob（import.meta.url 相对解析抛 Invalid URL）：
    // loaders 目录不得残留 import.meta.url（DRACOLoader 已补丁改写为字符串占位）
    if (text.includes("import.meta.url")) {
      throw new Error(`${src} 残留 import.meta.url（单页内联 blob 下会抛 Invalid URL，请加 patches）`);
    }
    const name = src.split("/").pop();
    if (writeIfChanged(join(outDir, name), header(src) + text)) written++;
    rewritten.push(name);
  }
  console.log(`[vendor-loaders] ${rewritten.length} 个加载器同步至 public/engine/runtime/loaders/（three@${threeVersion}${why ? `，${why}` : ""}）`);

  // Draco wasm 解码器：字节复制到 loaders/draco/（compressed.mjs 经 import.meta.url 定位）
  const dracoDir = join(outDir, "draco");
  mkdirSync(dracoDir, { recursive: true });
  for (const name of DRACO_DECODER_FILES) {
    const buf = readFileSync(join(threeDir, "examples", "jsm", "libs", "draco", "gltf", name));
    if (writeIfChanged(join(dracoDir, name), buf)) written++;
  }

  // three 运行时构建：按补丁表改写后写入（上游缺陷见 THREE_BUILD_PATCHES 注释），
  // 含 WebGPU 构建供预览/导出的 WebGPU 后端使用
  mkdirSync(coreDir, { recursive: true });
  for (const name of THREE_BUILDS) {
    let text = readFileSync(join(threeDir, "build", name), "utf8");
    text = applyTextPatches(name, text, THREE_BUILD_PATCHES);
    if (writeIfChanged(join(coreDir, name), text)) written++;
    // 依赖校验：构建只允许依赖同目录的 three.core.min.js（无裸导入，浏览器可直接加载）
    const deps = [...text.matchAll(/from\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((s) => s !== "./three.core.min.js");
    if (deps.length) {
      throw new Error(`${name} 存在未预期的依赖: ${deps.join(", ")}（预览运行时无打包器，不能有裸导入）`);
    }
  }
  if (written) console.log(`[vendor-loaders] 写入 ${written} 个文件（其余内容一致跳过）`);
  return { threeVersion, written };
}

// 直接执行（node runtime/scripts/vendor-preview-loaders.mjs）时运行
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    vendorPreviewLoaders("手动");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
