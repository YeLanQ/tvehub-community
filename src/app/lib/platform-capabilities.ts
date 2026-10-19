// ---------------------------------------------------------------------------
// 平台能力（前端单一入口）：Rust `platform_capabilities` 下发，模块内缓存一份。
// 用法：组件里 `capability("trash")` 直接读（同步），拿不到就按可用处理（fail-open），
// 避免一次 IPC 抖动把桌面功能错误置灰。浏览器直开 devUrl 时全部按不可用处理。
// ---------------------------------------------------------------------------

import { reactive } from "vue";
import { api, type PlatformCapability } from "../../lib/api";
import { isTauri } from "../../lib/tauri-env";

export type CapabilityId =
  | "trash"
  | "selfUpdate"
  | "selfUpdateApply"
  | "lanMultiNic"
  | "mcpBridge";

const ALL_IDS: CapabilityId[] = [
  "trash",
  "selfUpdate",
  "selfUpdateApply",
  "lanMultiNic",
  "mcpBridge",
];

/** 浏览器直开（无桌面后端）时的统一原因 */
export const DESKTOP_ONLY_REASON = "仅桌面应用内可用";

interface PlatformState {
  ready: boolean;
  /** Rust std::env::consts::OS：windows / linux / macos / … */
  os: string;
  arch: string;
  build: string;
  features: Record<string, PlatformCapability>;
}

function emptyState(): PlatformState {
  return { ready: false, os: "unknown", arch: "", build: "", features: {} };
}

let state = reactive<PlatformState>(emptyState());
let loading: Promise<void> | null = null;

// HMR 防分裂：模块重评估后仍指向同一份能力状态（与其它 store 同法；测试环境无 data）
if (import.meta.hot?.data) {
  const hot = import.meta.hot;
  hot.data.__tvePlatformState ??= null;
  const persisted = hot.data.__tvePlatformState as PlatformState | null;
  if (persisted) state = reactive(persisted);
  hot.dispose((data) => {
    data.__tvePlatformState = state;
  });
}

function markAllUnavailable(reason: string): void {
  for (const id of ALL_IDS) {
    state.features[id] = { available: false, reason };
  }
}

function apply(caps: {
  os: string;
  arch: string;
  build: string;
  features: Record<string, PlatformCapability>;
}): void {
  state.os = caps.os;
  state.arch = caps.arch;
  state.build = caps.build;
  state.features = caps.features;
}

/**
 * 拉取平台能力（幂等；多窗口各自进程内拉一次）。
 * 非 Tauri：全部不可用（仅桌面应用内可用）；
 * IPC 失败：保持空表（fail-open，读取端按可用处理）。
 */
export function ensurePlatformCapabilities(): Promise<void> {
  if (loading) return loading;
  if (!isTauri()) {
    markAllUnavailable(DESKTOP_ONLY_REASON);
    state.ready = true;
    loading = Promise.resolve();
    return loading;
  }
  loading = api
    .platformCapabilities()
    .then((caps) => {
      apply(caps);
    })
    .catch((e) => {
      console.error("读取平台能力失败（按可用处理）:", e);
    })
    .finally(() => {
      state.ready = true;
    });
  return loading;
}

export function getPlatformState(): PlatformState {
  return state;
}

/** 单条能力（未加载/未知 id 一律按可用处理，避免误禁用） */
export function capability(id: CapabilityId): PlatformCapability {
  return state.features[id] ?? { available: true };
}

/** 当前操作系统（Rust 口径；未加载为 "unknown"） */
export function platformOs(): string {
  return state.os;
}

export function isWindowsPlatform(): boolean {
  if (state.os !== "unknown") return state.os === "windows";
  // 能力表尚未返回时的兜底：路径大小写/分隔符语义必须立刻正确（最近项目比较键），
  // 不能等一次 IPC。Rust 返回后以 os 为准。
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

/** 测试用：重置模块单例 */
export function __resetPlatformCapabilitiesForTests(): void {
  state = reactive<PlatformState>(emptyState());
  loading = null;
}
