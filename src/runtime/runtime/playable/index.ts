// ---------------------------------------------------------------------------
// 试玩广告接口层安装入口（playable 渠道产物专用）：config.playableAd 为 true
// 才激活（web/wechat 渠道与编辑器预览不写该键 → 零开销跳过）。
// 激活后做四件事：
//   ① 探测宿主（detect.detectHost）并把 CTA 映射落定到统一面；
//   ② 安装 window.__tvePlayableAd 统一面（SDK engine.playableAd 同源单例）；
//   ③ 输出可见性门给 player 帧循环——mraid 广告位不可见时暂停整帧；
//   ④ 宿主落定后自动打点 gameStart（试玩开始上报；gameOver/gameRestart 由脚本调 report）。
// 模块无副作用：一切经 installPlayableAd 显式安装（wechat bundle 因 SDK 引用
// 会带上本模块，未激活即休眠）。
// ---------------------------------------------------------------------------
import { detectHost } from "./detect";
import type { PlayableHost, PlayableHostId } from "./types";

export type { PlayableHost, PlayableHostId } from "./types";

/** 统一面（window.__tvePlayableAd / engine.playableAd 的形态） */
export interface PlayableAdSurface {
  /** 探测到的宿主平台（探测落定前为 "web" 占位，落定后更新） */
  readonly host: PlayableHostId;
  /** 结束卡「下载」按钮：映射到广告宿主；无宿主（web）空转并一次性提示 */
  cta(): void;
  isViewable(): boolean;
  onViewableChange(cb: (viewable: boolean) => void): () => void;
  /**
   * 生命周期事件打点上报：转发到所在平台宿主的上报通道，并在控制台留痕
   * （本机自测可验证埋点）。gameStart 由安装层在宿主落定后自动上报一次；
   * 脚本只需在结束卡出现时 report("gameOver")、重玩时 report("gameRestart")，
   * 也接受自定义事件名 + 附加数据。
   */
  report(event: string, data?: Record<string, unknown>): void;
}

export interface PlayableAdInstall {
  /** 已安装的统一面（engine.playableAd 与 player 帧门共用同一份） */
  readonly surface: PlayableAdSurface;
  /** 宿主探测落定（含 mraid ready 等待/超时；落定后宿主不再变化） */
  ready: Promise<PlayableHostId>;
}

/** 已安装单例（SDK playable-api.ts 经此读同一份；未激活为 null） */
let surface: PlayableAdSurface | null = null;
let install: PlayableAdInstall | null = null;

/** 读已安装面（未激活返回 null——SDK 侧据此安全空转） */
export function playableAdSurface(): PlayableAdSurface | null {
  return surface;
}

/** 产物 config 中与本层相关的键（product_config 写入；此处只读） */
export interface PlayableAdConfig {
  playableAd?: boolean;
  playableTargets?: string[];
}

/** 安装试玩广告接口层：未启用（config 无 playableAd）返回 null；重复调用返回
 *  首次安装（幂等）。激活即同步装面 + 异步探测宿主（mraid ready 等待不阻塞
 *  游戏启动——ready Promise 供 player 探测落定后回读可见性）。 */
export function installPlayableAd(cfg: PlayableAdConfig): PlayableAdInstall | null {
  if (cfg.playableAd !== true) return null;
  if (install) return install;

  const listeners = new Set<(v: boolean) => void>();
  let host: PlayableHost = {
    id: "web",
    cta() {},
    isViewable: () => true,
    onViewableChange: () => () => {},
    report() {},
  };
  let ctaWarned = false;
  surface = {
    get host() {
      return host.id;
    },
    cta() {
      try {
        host.cta();
      } catch (e) {
        console.warn("[playable] 宿主 CTA 调用失败", e);
      }
      // web 宿主 = 非广告环境（本机自测/编辑器预览）：一次性说明，避免
      // 「点了下载没反应」的常见困惑
      if (host.id === "web" && !ctaWarned) {
        ctaWarned = true;
        console.warn(
          "[playable] 当前无广告宿主（web 自测环境），CTA 空转——上传到广告平台后由宿主接管下载跳转",
        );
      }
    },
    isViewable: () => host.isViewable(),
    onViewableChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    report(event, data) {
      // 留痕恒在（本机自测/编辑器预览可验证埋点）；平台转发随适配器能力
      console.info(`[playable] 事件打点: ${event}${data ? ` ${JSON.stringify(data)}` : ""}`);
      try {
        host.report(event, data);
      } catch (e) {
        console.warn("[playable] 事件上报转发失败", e);
      }
    },
  };
  (window as { __tvePlayableAd?: PlayableAdSurface }).__tvePlayableAd = surface;

  const targets = Array.isArray(cfg.playableTargets) ? cfg.playableTargets.join(",") : "";
  console.info(`[playable] 试玩广告接口层激活（构建目标: ${targets || "未标注"}）`);
  const ready = detectHost().then((h) => {
    host = h;
    // 宿主可见性 → 统一面事件（meta/google 恒可见，事件源实际只有 mraid）
    h.onViewableChange((v) => {
      for (const cb of listeners) cb(v);
    });
    console.info(`[playable] 宿主探测落定: ${h.id}`);
    // gameStart 自动打点（试玩广告通行约定：试玩开始即上报；脚本无需手动调）
    surface?.report("gameStart");
    return h.id;
  });
  install = { surface, ready };
  return install;
}
