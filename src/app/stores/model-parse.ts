// 模型解析中状态 store（资产面板/检查器/预览的"解析中"提示数据源）：
// 大 GLB 解析耗时数秒，此前点击资产后检查器信息区整块空白（metaFor 未就绪）。
// 桥接 framework ModelManager 的解析状态翻转回调到 Vue 响应式表，
// attach 幂等（多个组件挂载时只订阅一次）。
import { reactive, readonly } from "vue";
import type { ModelManager } from "../../framework/mesh/ModelManager";

export type ModelParseStore = {
  /** 正在解析的模型 rel 表（键存在 = 解析中；readonly 视图供模板响应） */
  readonly state: Readonly<{ rels: Record<string, true> }>;
  attach(models: ModelManager): void;
  isLoading(rel: string): boolean;
  count(): number;
};

let singleton: ModelParseStore | null = null;

export function getModelParseStore(): ModelParseStore {
  if (singleton) return singleton;

  const state = reactive<{ rels: Record<string, true> }>({ rels: {} });
  let bound = false;

  singleton = {
    state: readonly(state),
    attach(models: ModelManager): void {
      if (bound) return;
      bound = true;
      models.onLoadingChange((rel, loading) => {
        if (loading) state.rels[rel] = true;
        else delete state.rels[rel];
      });
    },
    isLoading(rel: string): boolean {
      return state.rels[rel] === true;
    },
    count(): number {
      return Object.keys(state.rels).length;
    },
  };
  return singleton;
}
