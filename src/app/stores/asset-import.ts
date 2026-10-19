// 资产导入进度 store（导入遮罩的数据源）：
// 导入大量资源时 Rust 侧逐文件复制并经 asset-import-progress 事件汇报进度，
// 遮罩期间整窗禁止指针操作（复制中目录结构在变动，此时增删/移动资产会撞写）。
// 生命周期：begin()（前端发起导入时）→ Rust 逐文件事件推进 → finish()（导入返回）。
import { reactive, readonly } from "vue";
import { listen } from "@tauri-apps/api/event";

interface AssetImportState {
  /** 导入进行中（遮罩可见 + 指针禁操） */
  active: boolean;
  done: number;
  total: number;
  /** 当前复制的文件名 */
  name: string;
}

export type AssetImportStore = {
  readonly state: Readonly<AssetImportState>;
  begin(): void;
  finish(): void;
};

let singleton: AssetImportStore | null = null;

export function getAssetImportStore(): AssetImportStore {
  if (singleton) return singleton;

  const state = reactive<AssetImportState>({ active: false, done: 0, total: 0, name: "" });
  let bound = false;
  /** 进度事件监听只布一次（事件晚于 finish 到达时只改数字，不影响遮罩显隐）；
   *  非 Tauri 上下文（单测/SSR 预算）listen 不可用——静默跳过，进度退化为不确定态 */
  function ensureListener(): void {
    if (bound) return;
    bound = true;
    try {
      void listen<{ done: number; total: number; name: string }>("asset-import-progress", (e) => {
        state.done = e.payload.done;
        state.total = e.payload.total;
        state.name = e.payload.name;
      }).catch(() => undefined);
    } catch {
      // 非 Tauri 环境：无进度事件，遮罩走不确定态
    }
  }

  singleton = {
    state: readonly(state),
    begin(): void {
      ensureListener();
      state.active = true;
      state.done = 0;
      state.total = 0;
      state.name = "";
    },
    /** 导入返回（成败皆然）：收遮罩 */
    finish(): void {
      state.active = false;
    },
  };
  return singleton;
}
