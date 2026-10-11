// mraid 适配器（IAB MRAID 规范；Unity Ads / AppLovin / Vungle / Liftoff 等
// 全族共用）：宿主在 playable 加载前注入 window.mraid，mraid 自身有
// loading → ready 生命周期——探测阶段等 ready（超时按当前态放行，坏宿主不卡
// 启动）。CTA = mraid.open()（商店跳转由宿主托管）；可见性 = isViewable +
// viewableChange 事件。
import type { PlayableHost } from "../types";

/** mraid ready 等待上限（ms）：正常宿主毫秒级就绪，超时 = 坏宿主按现状放行 */
const READY_TIMEOUT_MS = 3000;

/** 用到的 mraid 成员（MRAID 2.0+；全部可选——残缺宿主逐项降级） */
interface MraidLike {
  getState?(): string;
  isViewable?(): boolean;
  addEventListener?(event: string, cb: (viewable?: boolean) => void): void;
  open?(url?: string): void;
}

function mraidNow(): MraidLike | null {
  const m = (window as { mraid?: MraidLike }).mraid;
  return m && typeof m.addEventListener === "function" ? m : null;
}

/** 等待 mraid 就绪：已过 loading 立即落定；否则等 ready 事件（超时放行） */
function whenReady(mraid: MraidLike): Promise<MraidLike> {
  return new Promise((resolve) => {
    const state = typeof mraid.getState === "function" ? mraid.getState() : "";
    if (state && state !== "loading") return resolve(mraid);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(mraid);
    };
    const timer = setTimeout(finish, READY_TIMEOUT_MS);
    try {
      mraid.addEventListener?.("ready", finish);
    } catch {
      finish();
    }
  });
}

/** 探测：window.mraid 存在即命中（异步等待 ready 后装配宿主） */
export function detectMraid(): Promise<PlayableHost | null> {
  const mraid = mraidNow();
  if (!mraid) return Promise.resolve(null);
  return whenReady(mraid).then((m) => {
    const listeners = new Set<(v: boolean) => void>();
    const viewable = () => (typeof m.isViewable === "function" ? m.isViewable() === true : true);
    const onChange = (v?: boolean) => {
      const next = typeof v === "boolean" ? v : viewable();
      for (const cb of listeners) cb(next);
    };
    try {
      m.addEventListener?.("viewableChange", onChange);
    } catch {
      /* 坏宿主按恒可见降级（isViewable 缺席时本就恒 true） */
    }
    return {
      id: "mraid" as const,
      cta() {
        try {
          m.open?.();
        } catch (e) {
          console.warn("[playable] mraid.open 调用失败", e);
        }
      },
      isViewable: viewable,
      onViewableChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      // MRAID 规范无游戏事件上报通道（viewableChange 之外）——安装层留痕即可
      report() {},
    };
  });
}
