// ---------------------------------------------------------------------------
// engine.playableAd：试玩广告宿主契约的 SDK 面（与 window.__tvePlayableAd
// 同源单例，见 runtime/playable/index.ts）。用于结束卡（EndCard）脚本：按钮
// 点击处理里调 cta()，运行时自动映射到所在广告平台的宿主函数。
// 未激活（非 playable 渠道产物/编辑器预览）时全部安全空转。
// ---------------------------------------------------------------------------
import { playableAdSurface } from "../../runtime/playable/index";

const playableAdApi = {
  /** 探测到的宿主平台："mraid" / "meta" / "google"；"web" = 非广告环境 */
  get host(): string {
    return playableAdSurface()?.host ?? "web";
  },
  /** 结束卡「下载/安装」按钮点击（映射到宿主；无宿主空转并提示） */
  cta(): void {
    playableAdSurface()?.cta();
  },
  /** 广告位当前是否可见（mraid 跟随 viewableChange；其余恒 true） */
  isViewable(): boolean {
    return playableAdSurface()?.isViewable() ?? true;
  },
  /** 可见性变化订阅（返回解绑函数；未激活返回空解绑） */
  onViewableChange(cb: (viewable: boolean) => void): () => void {
    return playableAdSurface()?.onViewableChange(cb) ?? (() => {});
  },
  /** 生命周期事件打点上报（gameStart 自动上报；gameOver/gameRestart/自定义
   *  事件由脚本按时机调用；转发平台宿主通道 + 控制台留痕） */
  report(event: string, data?: Record<string, unknown>): void {
    playableAdSurface()?.report(event, data);
  },
};

export { playableAdApi };
