<script setup lang="ts">
/**
 * 构建面板 · 试玩广告渠道设置区：广告渠道目标勾选列表（含产物形态徽标与
 * 「即将支持」置灰位）、单页/多文件导出模板两槽（按勾选目标所需形态显示）、
 * gzip（作用于单页内联）、页面标题、发布/调试模式。全部状态经 defineModel
 * 双向绑定到面板（BuildPanel），本组件除勾选收敛外无自有状态。
 */
import { computed } from "vue";
import {
  PLAYABLE_TARGETS,
  neededForms,
  type ExportTemplateInfo,
} from "../../lib/build-export";

const playableTargets = defineModel<string[]>("playableTargets", { required: true });
const exportTemplates = defineModel<ExportTemplateInfo[]>("exportTemplates", { required: true });
const playableTemplateSingle = defineModel<string>("playableTemplateSingle", { required: true });
const playableTemplateMulti = defineModel<string>("playableTemplateMulti", { required: true });
const gzip = defineModel<boolean>("gzip", { required: true });
const title = defineModel<string>("title", { required: true });
const release = defineModel<boolean>("release", { required: true });
const debug = defineModel<boolean>("debug", { required: true });

/** 勾选目标所需的产物形态（both 展开为两种） */
const forms = computed(() => neededForms(playableTargets.value));
const singlePool = computed(() => exportTemplates.value.filter((t) => t.mode === "single"));
const multiPool = computed(() => exportTemplates.value.filter((t) => t.mode === "multi"));

/** 勾选/取消广告渠道目标（不可用项 UI 置灰不可点） */
function toggleTarget(id: string, checked: boolean): void {
  const set = new Set(playableTargets.value);
  if (checked) set.add(id);
  else set.delete(id);
  // 顺序按注册表收敛（产物目录与 config.playableTargets 口径稳定）
  playableTargets.value = PLAYABLE_TARGETS.filter((t) => set.has(t.id)).map((t) => t.id);
}
</script>

<template>
  <div class="bp-field col">
    <label>
      广告渠道目标
      <span class="bp-label-hint">可多选，按目标逐一产出 build/playable/&lt;目标&gt;/</span>
    </label>
    <div class="bp-tpl-list">
      <label
        v-for="t in PLAYABLE_TARGETS"
        :key="t.id"
        class="bp-tpl"
        :class="{ active: playableTargets.includes(t.id), disabled: !t.available }"
        :title="t.desc"
      >
        <input
          type="checkbox"
          :disabled="!t.available"
          :checked="playableTargets.includes(t.id)"
          @change="toggleTarget(t.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="bp-tpl-name">{{ t.label }}</span>
        <span class="bp-mode" :class="t.form">
          {{ t.form === "single" ? "单页" : t.form === "multi" ? "多文件" : "两者" }}
        </span>
        <span v-if="!t.available" class="bp-tpl-user">即将支持</span>
      </label>
    </div>
    <p class="bp-note">
      单页 = 场景、资产与运行时代码全内联的单文件 index.html（Meta / Google /
      MRAID 全族直传）；多文件 = 普通静态站点（要求 zip 上传的平台自行打包目录）。
    </p>
  </div>
  <div v-if="forms.has('single')" class="bp-field col">
    <label for="bp-playable-tpl-single">
      单页导出模板
      <span class="bp-label-hint">服务单页形态目标</span>
    </label>
    <select id="bp-playable-tpl-single" v-model="playableTemplateSingle">
      <option v-for="t in singlePool" :key="t.id" :value="t.id">{{ t.name }}</option>
    </select>
  </div>
  <div v-if="forms.has('multi')" class="bp-field col">
    <label for="bp-playable-tpl-multi">
      多文件导出模板
      <span class="bp-label-hint">服务多文件形态目标</span>
    </label>
    <select id="bp-playable-tpl-multi" v-model="playableTemplateMulti">
      <option v-for="t in multiPool" :key="t.id" :value="t.id">{{ t.name }}</option>
    </select>
  </div>
  <div v-if="forms.has('single')" class="bp-field">
    <label for="bp-playable-gzip">Gzip 压缩</label>
    <label class="bp-check">
      <input id="bp-playable-gzip" v-model="gzip" type="checkbox" />
      <span>单页形态：资产与运行时代码 gzip 归档后内联（体积更小，利于平台体积预算）</span>
    </label>
  </div>
  <div class="bp-field">
    <label for="bp-playable-title">页面标题</label>
    <input id="bp-playable-title" v-model="title" placeholder="项目名" />
  </div>
  <div class="bp-field">
    <label for="bp-playable-release">发布模式</label>
    <label class="bp-check">
      <input id="bp-playable-release" v-model="release" type="checkbox" />
      <span>使用uuid，压缩 JSON 与脚本库（与调试模式互斥；试玩广告建议开启，压缩后体积更小）</span>
    </label>
  </div>
  <div class="bp-field">
    <label for="bp-playable-debug">调试模式</label>
    <label class="bp-check">
      <input id="bp-playable-debug" v-model="debug" type="checkbox" />
      <span>保留运行日志转发（与发布模式互斥）</span>
    </label>
  </div>
  <p class="bp-note">
    试玩广告产物运行在广告平台 SDK WebView 内：CDN 模式不可用（禁止外链，three.js
    恒内嵌）；脚本在结束卡「下载」按钮的点击处理里调 <code>engine.playableAd.cta()</code>
    即对接宿主安装跳转。
  </p>
</template>
