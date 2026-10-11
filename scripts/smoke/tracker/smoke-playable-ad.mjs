// ---------------------------------------------------------------------------
// @priority P0
// 试玩广告接口层冒烟（Node 直接运行 public/engine 产物）：探测链与统一面契约——
//   ① 未启用（config 无 playableAd）→ 不安装、面为 null；
//   ② 探测链按序命中：mraid（含 loading→ready 等待与 viewableChange 转发）→
//      meta（FbPlayableAd / FBPlayableOnCTAClick 两代桥）→ google（ExitApi）；
//   ③ 全部落空 = web 宿主（CTA 空转不抛错）；
//   ④ 重复安装幂等；window.__tvePlayableAd 与 SDK 面同源；
//   ⑤ 事件打点：宿主落定自动 gameStart、手动 report 留痕转发、未激活空转。
// 用例间以 import 查询串隔离模块单例（ESM 按 URL 缓存）。
// 运行：pnpm smoke playable-ad
// ---------------------------------------------------------------------------
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, createSuite, installDomShim } from "../harness.mjs";

const { ok, finish } = createSuite();
installDomShim();

const MODULE_URL = pathToFileURL(join(ROOT, "public/engine/runtime/playable/index.mjs")).href;
/** 每用例独立模块实例（单例状态隔离） */
const loadModule = async (tag) => import(`${MODULE_URL}?case=${tag}`);

/** 清理用例注入的广告宿主全局 */
function clearHosts() {
  for (const k of ["mraid", "FbPlayableAd", "FBPlayableOnCTAClick", "ExitApi", "__tvePlayableAd"]) {
    delete globalThis[k];
  }
}

// [1] 未启用：config 无 playableAd → 返回 null、不装面
{
  clearHosts();
  const mod = await loadModule("off");
  ok(mod.installPlayableAd({}) === null, "未启用返回 null");
  ok(mod.playableAdSurface() === null, "未启用统一面为 null");
  ok(globalThis.__tvePlayableAd === undefined, "未启用不安装 window 面");
}

// [2] meta：两代桥都命中（新 FbPlayableAd.onCTAClick 优先）
{
  clearHosts();
  const mod = await loadModule("meta-new");
  let ctaCalls = 0;
  globalThis.FbPlayableAd = { onCTAClick: () => ctaCalls++ };
  const install = mod.installPlayableAd({ playableAd: true, playableTargets: ["meta"] });
  ok(install !== null, "启用后返回安装句柄");
  const host = await install.ready;
  ok(host === "meta", `探测落定 meta（实得 ${host}）`);
  install.surface.cta();
  ok(ctaCalls === 1, "CTA 映射 FbPlayableAd.onCTAClick");
  ok(globalThis.__tvePlayableAd === install.surface, "window 面与安装句柄同源");
  // 重复安装幂等
  ok(mod.installPlayableAd({ playableAd: true }) === install, "重复安装返回首次句柄");
  // 旧代桥回退
  clearHosts();
  const mod2 = await loadModule("meta-old");
  let oldCalls = 0;
  globalThis.FBPlayableOnCTAClick = () => oldCalls++;
  const install2 = mod2.installPlayableAd({ playableAd: true });
  ok((await install2.ready) === "meta", "旧代函数桥也命中 meta");
  install2.surface.cta();
  ok(oldCalls === 1, "CTA 映射 FBPlayableOnCTAClick");
}

// [3] google：ExitApi.exit
{
  clearHosts();
  const mod = await loadModule("google");
  let exits = 0;
  globalThis.ExitApi = { exit: () => exits++ };
  const install = mod.installPlayableAd({ playableAd: true });
  ok((await install.ready) === "google", "探测落定 google");
  install.surface.cta();
  ok(exits === 1, "CTA 映射 ExitApi.exit");
  ok(install.surface.isViewable() === true, "google 无可见性 API，恒可见");
}

// [4] mraid：ready 等待 + viewableChange 转发 + open
{
  clearHosts();
  const mod = await loadModule("mraid");
  let opens = 0;
  let viewableChangeCb = null;
  globalThis.mraid = {
    getState: () => "loading",
    isViewable: () => false,
    addEventListener: (event, cb) => {
      if (event === "ready") queueMicrotask(cb);
      if (event === "viewableChange") viewableChangeCb = cb;
    },
    open: () => opens++,
  };
  const install = mod.installPlayableAd({ playableAd: true });
  const host = await install.ready;
  ok(host === "mraid", "探测等待 mraid ready 后落定 mraid");
  ok(install.surface.isViewable() === false, "isViewable 透传 mraid");
  // viewableChange → 统一面订阅者
  let seen = null;
  const unbind = install.surface.onViewableChange((v) => (seen = v));
  viewableChangeCb(true);
  ok(seen === true, "viewableChange(true) 转发给订阅者");
  unbind();
  viewableChangeCb(false);
  ok(seen === true, "解绑后不再收到事件");
  install.surface.cta();
  ok(opens === 1, "CTA 映射 mraid.open");
}

// [5] web 回退：无宿主环境 CTA 空转不抛错
{
  clearHosts();
  const mod = await loadModule("web");
  const install = mod.installPlayableAd({ playableAd: true, playableTargets: ["meta"] });
  ok((await install.ready) === "web", "无宿主落定 web");
  let threw = false;
  try {
    install.surface.cta();
  } catch {
    threw = true;
  }
  ok(!threw, "web 宿主 CTA 空转不抛错");
  ok(install.surface.isViewable() === true, "web 宿主恒可见");
}

// [6] 事件打点：宿主落定后自动 gameStart + 手动 report 转发留痕
{
  clearHosts();
  const mod = await loadModule("report");
  const infos = [];
  const origInfo = console.info;
  console.info = (...a) => infos.push(a.map(String).join(" "));
  try {
    const install = mod.installPlayableAd({ playableAd: true });
    await install.ready;
    install.surface.report("gameOver", { score: 100 });
  } finally {
    console.info = origInfo;
  }
  ok(infos.some((l) => l.includes("事件打点: gameStart")), "宿主落定后自动上报 gameStart");
  ok(
    infos.some((l) => l.includes("事件打点: gameOver") && l.includes("score")),
    "手动 report 转发并携带附加数据留痕",
  );
  // 未激活：surface 为 null，report 链安全空转
  clearHosts();
  const mod2 = await loadModule("report-off");
  let threw = false;
  try {
    mod2.playableAdSurface()?.report("gameOver");
  } catch {
    threw = true;
  }
  ok(!threw, "未激活 report 空转不抛错");
}

finish();
