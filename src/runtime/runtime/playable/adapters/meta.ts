// Meta（Facebook）适配器：CTA = FbPlayableAd.onCTAClick()（新版全局对象）或
// FBPlayableOnCTAClick()（旧版全局函数）。Meta 无广告位可见性 API——恒可见，
// 页面级隐藏由 player 的 document.hidden 帧门覆盖。
import type { PlayableHost } from "../types";

export function detectMeta(): PlayableHost | null {
  const w = window as {
    FbPlayableAd?: { onCTAClick?: () => void };
    FBPlayableOnCTAClick?: () => void;
  };
  let cta: (() => void) | null = null;
  if (typeof w.FbPlayableAd?.onCTAClick === "function") {
    cta = () => w.FbPlayableAd?.onCTAClick?.();
  } else if (typeof w.FBPlayableOnCTAClick === "function") {
    cta = () => w.FBPlayableOnCTAClick?.();
  }
  if (!cta) return null;
  return {
    id: "meta",
    cta,
    isViewable: () => true,
    onViewableChange: () => () => {},
    // Meta 平台无游戏事件上报 API（互动指标由 SDK 自测）——留痕在安装层
    report() {},
  };
}
