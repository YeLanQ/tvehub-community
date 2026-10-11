// Mintegral 适配器：官方要求试玩页接两个全局函数 API（Unity Playworks 官方
// 适配文档与 Mindworks 指南一致）——App store click = window.install()（结束卡
// 「下载」点击调用），GameEnded = window.gameEnd()（游戏结束上报调用）。
// 无可见性 API——恒可见，页面级隐藏由 player 的 document.hidden 帧门覆盖。
import type { PlayableHost } from "../types";

export function detectMintegral(): PlayableHost | null {
  const w = window as { install?: () => void; gameEnd?: () => void };
  if (typeof w.install !== "function" && typeof w.gameEnd !== "function") return null;
  return {
    id: "mintegral",
    cta: () => w.install?.(),
    isViewable: () => true,
    onViewableChange: () => () => {},
    // 官方 GameEnded API：游戏结束事件（gameOver/gameEnd）转发 window.gameEnd；
    // gameStart 无对应 API（官方仅要求 App store click + GameEnded 两个）
    report(event) {
      if (event === "gameOver" || event === "gameEnd") w.gameEnd?.();
    },
  };
}
