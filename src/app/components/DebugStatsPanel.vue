<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getEditorStore } from "../stores/editor";
import type { RenderStats } from "../../framework/engine/modules/RendererManager";
import { capability } from "../lib/platform-capabilities";
import "../../styles/components/debug-stats-panel.scss";

const { engine } = getEditorStore();
const stats = ref<RenderStats>({
  fps: 0,
  idle: false,
  renderScale: 1,
  drawCalls: 0,
  triangles: 0,
  lines: 0,
  points: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  meshes: 0,
  vertices: 0,
  backend: "webgl",
  transparency: "sorted",
  gpuVendor: "",
  gpuRenderer: "",
  software: null,
});

let timer = 0;

/** Linux 无 DRM 渲染节点 = 确定软件渲染（比 WebGL 渲染器字符串更可靠） */
const gpuCap = computed(() => capability("gpuAcceleration"));
const gpuLabel = computed(() => {
  if (!gpuCap.value.available) return "软件";
  if (stats.value.software === true) return "软件";
  if (stats.value.software === false) return "硬件";
  return "未知";
});
const gpuTitle = computed(() => {
  const detail = `${stats.value.gpuVendor || "厂商未知"} / ${stats.value.gpuRenderer || "渲染器未知"}`;
  return gpuCap.value.available ? detail : `${detail}（${gpuCap.value.reason}）`;
});

onMounted(() => {
  timer = window.setInterval(() => {
    stats.value = engine.renderer.getStats();
  }, 200);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
</script>

<template>
  <div class="debug-stats-panel mono">
    <div class="stat-row">
      <span class="stat-label">FPS</span>
      <!-- 空闲降档（视口静止省电策略）单列灰色标注：12fps 是设计行为不是掉帧 -->
      <span
        class="stat-value"
        :class="stats.idle ? 'idle' : { low: stats.fps < 30, mid: stats.fps >= 30 && stats.fps < 50 }"
      >{{ stats.fps }}{{ stats.idle ? " · 空闲" : "" }}</span>
    </div>
    <!-- 自适应渲染精度：DRS 介入（<100%）才显示——降采样保帧率的可见性 -->
    <div v-if="stats.renderScale < 1" class="stat-row">
      <span class="stat-label">渲染精度</span>
      <span class="stat-value">{{ Math.round(stats.renderScale * 100) }}%</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">DrawCalls</span>
      <span class="stat-value">{{ stats.drawCalls }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label" title="实际生效的渲染后端（可能与项目设置不同：WebGPU 不可用时回退 WebGL）">后端</span>
      <span class="stat-value">{{ stats.backend === "webgpu" ? "WebGPU" : "WebGL" }}</span>
    </div>
    <div class="stat-row">
      <span
        class="stat-label"
        title="GPU 硬件/软件判定：llvmpipe / SwiftShader 等为软件光栅化；WebKitGTK 为防指纹可能屏蔽渲染器字符串，此时显示未知"
      >GPU</span>
      <span
        class="stat-value"
        :title="gpuTitle"
      >{{ gpuLabel }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label" title="实际生效的透明渲染策略：排序混合 / 顺序无关透明（OIT，需 WebGPU；项目设置 → 显示与运行 → 透明渲染）">透明</span>
      <span class="stat-value">{{ stats.transparency === "oit" ? "OIT" : "排序" }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">网格</span>
      <span class="stat-value">{{ stats.meshes }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">顶点</span>
      <span class="stat-value">{{ fmt(stats.vertices) }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">三角面</span>
      <span class="stat-value">{{ fmt(stats.triangles) }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">几何体</span>
      <span class="stat-value">{{ stats.geometries }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">纹理</span>
      <span class="stat-value">{{ stats.textures }}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">着色器</span>
      <span class="stat-value">{{ stats.programs }}</span>
    </div>
  </div>
</template>