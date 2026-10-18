// ---------------------------------------------------------------------------
// @priority P0
// 产物归档 fetch 垫片路径归一冒烟（Node 直接运行，不经打包）：
// assetKeyCandidates 把资源 URL 归一成归档条目键，覆盖三种部署形态——
//   ① 服务器根部署：整段 pathname；
//   ② 子路径部署：入口页目录之后的相对路径；
//   ③ file:// 双击打开：入口页目录是完整磁盘路径。
// 回归重点（曾致产物白模）：入口路径含中文/空格时 location.pathname 是百分号
// 编码、资源 pathname 解码后是原字符——两侧不都解码则 base 前缀永不匹配，
// 贴图 fetch 落到原生请求 file://… 404，模型只剩基础色。
// 运行：pnpm smoke pak-shim
// ---------------------------------------------------------------------------
import { createSuite, runtimeURL as runtime } from "../harness.mjs";

const { ok, finish } = createSuite();

const { assetKeyCandidates } = await import(runtime("pak.mjs"));

console.log("[1] 服务器根部署：整段 pathname 命中");
{
  const keys = assetKeyCandidates(
    "http://127.0.0.1:8123/assets/Models/Textures/a.png",
    "http://127.0.0.1:8123/index.html",
  );
  ok(keys.includes("assets/Models/Textures/a.png"), "条目键 = 去掉前导斜杠的 pathname");
}

console.log("[2] 子路径部署：入口页目录相对路径命中");
{
  const keys = assetKeyCandidates("assets/x.glb", "http://127.0.0.1:8123/app/index.html");
  ok(keys.includes("app/assets/x.glb"), "整段 pathname 候选");
  ok(keys.includes("assets/x.glb"), "入口目录相对路径候选");
}

console.log("[3] file:// 双击打开：含中文/空格目录（百分号编码）仍命中");
{
  const page =
    "file:///C:/Users/X/My%20Game/%E5%B4%87%E4%B8%BD%E9%98%81/build/web/index.html";
  const keys = assetKeyCandidates("./assets/Models/Textures/a.png", page);
  ok(keys.includes("assets/Models/Textures/a.png"), "解码两侧后相对路径命中（白模回归）");
  ok(
    keys.some((k) => k.startsWith("C:/Users/X/My Game/")),
    "完整磁盘路径候选仍保留（根目录部署兜底）",
  );
}

console.log("[4] 跨源与非法 URL：不接管");
{
  ok(
    assetKeyCandidates("https://cdn.example.com/a.png", "http://127.0.0.1:8123/index.html")
      .length === 0,
    "跨源地址返回空候选（透传原生 fetch）",
  );
  ok(assetKeyCandidates("http://[", "http://127.0.0.1:8123/").length === 0, "非法 URL 返回空候选");
}

finish();
