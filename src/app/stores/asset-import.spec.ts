import { describe, expect, it } from "vitest";
import { getAssetImportStore } from "./asset-import";
import { getModelParseStore } from "./model-parse";

/**
 * 导入进度与模型解析中两个 UI 状态 store 的契约：
 * - asset-import：begin 置遮罩可见并清零计数，finish 收遮罩（成败皆然）；
 * - model-parse：attach 桥接 ModelManager 解析翻转回调，rel 表驱动计数与查询。
 */

describe("assetImportStore（导入遮罩状态）", () => {
  it("begin 置 active 并清零，finish 收遮罩", () => {
    const store = getAssetImportStore();
    store.begin();
    expect(store.state.active).toBe(true);
    expect(store.state.done).toBe(0);
    expect(store.state.total).toBe(0);
    store.finish();
    expect(store.state.active).toBe(false);
  });

  it("重复 begin 幂等重置（上次残留计数不清入本次）", () => {
    const store = getAssetImportStore();
    store.begin();
    store.finish();
    store.begin();
    expect(store.state.active).toBe(true);
    expect(store.state.done).toBe(0);
    store.finish();
    expect(store.state.active).toBe(false);
  });
});

describe("modelParseStore（模型解析中状态）", () => {
  it("attach 后经解析翻转回调维护 rel 表，count/isLoading 随动", () => {
    const store = getModelParseStore();
    const listeners: ((rel: string, loading: boolean) => void)[] = [];
    const stubManager = {
      onLoadingChange(l: (rel: string, loading: boolean) => void): () => void {
        listeners.push(l);
        return () => undefined;
      },
    };
    // attach 幂等：两次挂载只订阅一次
    store.attach(stubManager as never);
    store.attach(stubManager as never);
    expect(listeners.length).toBe(1);

    listeners[0]("a/m.obj", true);
    listeners[0]("b/n.obj", true);
    expect(store.isLoading("a/m.obj")).toBe(true);
    expect(store.count()).toBe(2);

    listeners[0]("a/m.obj", false);
    expect(store.isLoading("a/m.obj")).toBe(false);
    expect(store.count()).toBe(1);

    listeners[0]("b/n.obj", false);
    expect(store.count()).toBe(0);
  });
});
