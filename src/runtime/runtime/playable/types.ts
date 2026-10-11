// ---------------------------------------------------------------------------
// 试玩广告宿主契约（统一面）：广告平台 SDK WebView（宿主）各自暴露不同的
// CTA / 生命周期接口（mraid / Meta / Google AdMob…），本目录把它们收敛为
// 一组最小统一接口；探测链与逐平台映射见 detect.ts 与 adapters/。
//
// 激活开关 = 产物 config.playableAd（playable 渠道导出写入；web/wechat 渠道
// 与编辑器预览不写该键 → installPlayableAd 直接跳过，模块零开销休眠）。
// ---------------------------------------------------------------------------

/** 宿主平台 id（engine.playableAd.host / window.__tvePlayableAd.host 的取值）。
 *  注：导出目标 ironsource（Unity Grow）官方 spec=MRAID 3.0，运行时探测落
 *  "mraid"——目标是构建侧概念，宿主 id 只按运行时真实契约落名 */
export type PlayableHostId = "web" | "mraid" | "meta" | "google" | "mintegral";

/** 统一宿主适配器：一个广告平台（族）一份实现（adapters/） */
export interface PlayableHost {
  readonly id: PlayableHostId;
  /** 结束卡「下载/安装」按钮点击：映射到平台宿主函数（商店跳转由宿主接管）；
   *  无宿主（web）由安装层告警空转 */
  cta(): void;
  /** 广告位当前是否可见（mraid 跟随 viewableChange；meta/google 无该 API 恒
   *  true——页面级不可见由 player 的 document.hidden 帧门覆盖） */
  isViewable(): boolean;
  /** 可见性变化订阅（返回解绑函数；无该能力的平台返回空解绑） */
  onViewableChange(cb: (viewable: boolean) => void): () => void;
  /**
   * 生命周期事件打点：转发到平台宿主的上报通道。内置事件名 gameStart /
   * gameOver / gameRestart（也接受自定义事件名 + 附加数据）。meta/google/
   * mraid 平台无游戏事件 API——no-op（留痕在安装层统一做）；mintegral 在此
   * 映射官方 GameEnded API（report("gameOver"/"gameEnd") → window.gameEnd）。
   */
  report(event: string, data?: Record<string, unknown>): void;
}
