// ---------------------------------------------------------------------------
// 防闪烁的延迟显示标志（纯组合函数）：
// 短任务（布尔源瞬时亮灭）不显示，避免出现又立刻消失的"闪一下"；
// 长任务亮起后至少保持 minVisibleMs，避免刚显示就被下一拍收起造成闪烁。
// 资产面板的模型解析进度条用它：点选模型会触发解析，快模型解析仅几十毫秒，
// 进度条原来的"插入布局 → 撤走"会让整个列表跳一下、像面板刷新。
// ---------------------------------------------------------------------------

import { onScopeDispose, readonly, ref, watch, type Ref } from "vue";

export interface DelayedFlagOptions {
  /** 源信号持续亮起多久才显示（毫秒） */
  showDelayMs?: number;
  /** 显示后至少保持可见多久（毫秒） */
  minVisibleMs?: number;
}

export function useDelayedFlag(source: Ref<boolean>, options: DelayedFlagOptions = {}) {
  const showDelayMs = options.showDelayMs ?? 250;
  const minVisibleMs = options.minVisibleMs ?? 350;
  const visible = ref(false);
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownAt = 0;

  const cancelShow = (): void => {
    if (showTimer != null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };
  const cancelHide = (): void => {
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  // sync：源信号多是异步任务状态翻转，延迟窗按翻转当刻计时，避免批处理微任务
  // 让短任务被误判为长任务（也让单测的假定时器语义确定）
  watch(source, (on) => {
    if (on) {
      // 显示中或待显示：撤销待执行的收起（任务紧接着又开始了）
      cancelHide();
      if (visible.value || showTimer != null) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        visible.value = true;
        shownAt = Date.now();
      }, showDelayMs);
      return;
    }
    // 源熄灭：还在显示延迟窗内 → 视为短任务，从未出现
    cancelShow();
    if (!visible.value || hideTimer != null) return;
    const remain = Math.max(0, minVisibleMs - (Date.now() - shownAt));
    hideTimer = setTimeout(() => {
      hideTimer = null;
      visible.value = false;
    }, remain);
  }, { flush: "sync" });

  onScopeDispose(() => {
    cancelShow();
    cancelHide();
  });

  return { visible: readonly(visible) as Readonly<Ref<boolean>> };
}
