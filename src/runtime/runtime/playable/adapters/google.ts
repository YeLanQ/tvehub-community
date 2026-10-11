// Google AdMob 适配器：CTA = ExitApi.exit()（Google 试玩广告 Exit API 规范，
// 结束卡下载按钮必须调用，跳转由宿主接管）。无广告位可见性 API——恒可见。
import type { PlayableHost } from "../types";

export function detectGoogle(): PlayableHost | null {
  const api = (window as { ExitApi?: { exit?: () => void } }).ExitApi;
  if (!api || typeof api.exit !== "function") return null;
  return {
    id: "google",
    cta() {
      try {
        api.exit?.();
      } catch (e) {
        console.warn("[playable] ExitApi.exit 调用失败", e);
      }
    },
    isViewable: () => true,
    onViewableChange: () => () => {},
    // Google AdMob 无游戏事件上报 API（Exit API 之外）——留痕在安装层
    report() {},
  };
}
