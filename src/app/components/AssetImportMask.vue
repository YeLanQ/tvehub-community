<script setup lang="ts">
// ---------------------------------------------------------------------------
// 资产导入遮罩（App.vue 根级挂载，fixed 盖住整个编辑器窗口）：
// 导入大量资源期间 Rust 逐文件复制，此间目录结构在变动——遮罩既展示逐文件
// 进度（asset-import store，事件驱动），也以 pointer-events 拦截全部指针
// 操作（增删/移动/再导入都会与复制目标撞写）。z-index 低于装载蒙版。
// ---------------------------------------------------------------------------
import { computed } from "vue";
import { getAssetImportStore } from "../stores/asset-import";
import "../../styles/components/asset-import-mask.scss";

const imp = getAssetImportStore();

const visible = computed(() => imp.state.active);

/** 总数已知才显示分母（目录预计数失败时 total=0，退化为不确定态） */
const percent = computed(() =>
  imp.state.total > 0 ? Math.round((imp.state.done / imp.state.total) * 100) : null,
);
</script>

<template>
  <Transition name="asset-import-mask">
    <div v-if="visible" class="asset-import-mask" @contextmenu.prevent @click.stop @mousedown.stop>
      <div class="import-card">
        <svg class="spin" viewBox="0 0 16 16" width="20" height="20">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.6" />
          <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <div class="import-title">正在导入资源</div>
        <div v-if="imp.state.total > 0" class="import-count">{{ imp.state.done }} / {{ imp.state.total }}</div>
        <div class="import-bar">
          <div
            v-if="percent !== null"
            class="import-bar-fill"
            :style="{ width: percent + '%' }"
          ></div>
          <div v-else class="import-bar-indeterminate"></div>
        </div>
        <div class="import-name" :title="imp.state.name">{{ imp.state.name }}</div>
        <div class="import-hint">导入期间暂不能操作项目</div>
      </div>
    </div>
  </Transition>
</template>
