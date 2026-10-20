// ---------------------------------------------------------------------------
// 渲染后端变更的会话重启交接：渲染后端不可运行期切换（模块级单例与渲染器
// 实例历史无法跨会话彻底复位），项目设置保存检测到后端变化时写 sessionStorage
// 交接标记并整页刷新（等同 F5）——JS 上下文全新，一切从零装配；窗口启动时
// 读标记自动重开原项目（pending 交付通道在重载后已消费，不能复用）。
// sessionStorage 按窗口隔离、刷新后保留、关窗即弃，正是这个交接要的语义。
// ---------------------------------------------------------------------------

const KEY = "tve:editor:autoreopen";

export interface SessionRestartPayload {
  /** 项目根目录（绝对路径） */
  root: string;
  /** 重开的场景 rel */
  rel: string;
}

/** 标记「刷新后重开此项目」（写入失败时刷新仍执行，退化为手动重开） */
export function markSessionRestart(payload: SessionRestartPayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage 不可用（隐私模式等）：忽略，刷新照常
  }
}

/** 取走重启标记（读后即清；无标记/损坏返回 null） */
export function takeSessionRestart(): SessionRestartPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<SessionRestartPayload>;
    if (typeof parsed.root !== "string" || typeof parsed.rel !== "string") return null;
    return { root: parsed.root, rel: parsed.rel };
  } catch {
    return null;
  }
}
