// 宿主探测链：mraid（异步等 ready）→ meta → google，首个命中者胜出；全部落空
// = 普通 web 宿主（非广告环境：编辑器预览/本机自测导出，CTA 空转并一次性提示）。
// 探测只读全局对象形状（window.mraid 等广告宿主在 playable 加载前注入），
// 不产生任何副作用。
import type { PlayableHost } from "./types";
import { detectMraid } from "./adapters/mraid";
import { detectMeta } from "./adapters/meta";
import { detectGoogle } from "./adapters/google";

/** 普通 web 回退宿主：无广告宿主环境（window.__tvePlayableAd.cta 空转） */
function webHost(): PlayableHost {
  return {
    id: "web",
    cta() {},
    isViewable: () => true,
    onViewableChange: () => () => {},
    // 留痕由安装层统一做（console 打点日志），此处只做平台转发位
    report() {},
  };
}

/** 按序探测宿主；探测完成即落定（后续不再变化） */
export async function detectHost(): Promise<PlayableHost> {
  const mraid = await detectMraid();
  if (mraid) return mraid;
  return detectMeta() ?? detectGoogle() ?? webHost();
}
