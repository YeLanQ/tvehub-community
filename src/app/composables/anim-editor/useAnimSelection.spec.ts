// useAnimSelection 选中帧数据暴露与底部字段二次编辑（正常/边界/异常/空值四类）。
// 契约：selectedKey 按 (prop, t±1e-4) 实时解析（rev 失效）；时间提交钳进
// [0, 时长] 且 t 升序重排、选中跟随新时刻；值提交直写 v；两提交后 touch +
// 按播放头 previewAt；无选中/帧已消失时提交 no-op。
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { AnimationClipData } from "../../../framework/animation/clip";
import { useAnimSelection } from "./useAnimSelection";
import type { AnimEditorCtx } from "./ctx";

function makeDoc(): AnimationClipData {
  return {
    type: "animclip",
    name: "t",
    duration: 2,
    loops: true,
    curves: [
      {
        prop: "position.x",
        keys: [
          { t: 0, v: 1, i: "linear" },
          { t: 1, v: 2, i: "smooth" },
          { t: 2, v: 4, i: "step" },
        ],
      },
    ],
  };
}

/** 最小 ctx：selection 模块只消费 clip（doc/rev/touch）、preview、playback */
function makeCtx(doc: AnimationClipData | null) {
  const d = ref<AnimationClipData | null>(doc);
  const rev = ref(0);
  const previewAt = vi.fn();
  const time = ref(0);
  const ctx = {
    clip: {
      doc: d,
      rev,
      touch: () => {
        rev.value += 1;
      },
    },
    preview: { previewAt },
    playback: { time },
  } as unknown as AnimEditorCtx;
  return { ctx, d, rev, previewAt, time };
}

describe("useAnimSelection 选中帧数据", () => {
  it("正常：pickKey 后 selectedKey/selectedTime/selectedValue 实时对应该帧", () => {
    const { ctx } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    sel.pickKey("position.x", 1);
    expect(sel.selectedKey.value?.v).toBe(2);
    expect(sel.selectedTime.value).toBe(1);
    expect(sel.selectedValue.value).toBe(2);
    // smooth 且无手动切线 = 虚拟态 "auto"（既有约定）
    expect(sel.selectedInterp.value).toBe("auto");
  });

  it("正常：值提交直写该帧 v 并 touch + 按播放头刷新预览", () => {
    const { ctx, rev, previewAt, time } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    sel.pickKey("position.x", 1);
    time.value = 1;
    const before = rev.value;
    sel.onSelectedValueChange(7.5);
    expect(sel.selectedValue.value).toBe(7.5);
    expect(rev.value).toBe(before + 1);
    expect(previewAt).toHaveBeenCalledWith(1);
  });

  it("正常：时间提交重排 t 升序且选中跟随新时刻", () => {
    const { ctx } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    sel.pickKey("position.x", 0);
    sel.onSelectedTimeChange(1.5);
    const keys = ctx.clip.doc.value!.curves[0].keys;
    expect(keys.map((k) => k.t)).toEqual([1, 1.5, 2]);
    expect(sel.selected.value).toEqual({ prop: "position.x", t: 1.5 });
    expect(sel.selectedTime.value).toBe(1.5);
  });

  it("边界：时间提交钳进 [0, 时长]", () => {
    const { ctx } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    sel.pickKey("position.x", 2);
    sel.onSelectedTimeChange(5);
    expect(sel.selectedTime.value).toBe(2);
    sel.pickKey("position.x", 0);
    sel.onSelectedTimeChange(-1);
    expect(sel.selectedTime.value).toBe(0);
  });
});

describe("useAnimSelection 提交守卫", () => {
  it("异常：选中指向已不存在的帧（stale t）→ selectedKey 为 null 且提交 no-op", () => {
    const { ctx, rev, previewAt } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    sel.selected.value = { prop: "position.x", t: 99 };
    expect(sel.selectedKey.value).toBeNull();
    const before = rev.value;
    sel.onSelectedValueChange(3);
    sel.onSelectedTimeChange(1);
    expect(rev.value).toBe(before);
    expect(previewAt).not.toHaveBeenCalled();
  });

  it("空值：未选中时字段回退 0、提交 no-op", () => {
    const { ctx, rev } = makeCtx(makeDoc());
    const sel = useAnimSelection(ctx);
    expect(sel.selectedKey.value).toBeNull();
    expect(sel.selectedTime.value).toBe(0);
    expect(sel.selectedValue.value).toBe(0);
    const before = rev.value;
    sel.onSelectedValueChange(3);
    sel.onSelectedTimeChange(1);
    expect(rev.value).toBe(before);
  });

  it("空值：无剪辑文档时 selectedKey 为 null 且提交 no-op", () => {
    const { ctx, rev } = makeCtx(null);
    const sel = useAnimSelection(ctx);
    sel.selected.value = { prop: "position.x", t: 0 };
    expect(sel.selectedKey.value).toBeNull();
    const before = rev.value;
    sel.onSelectedValueChange(3);
    sel.onSelectedTimeChange(1);
    expect(rev.value).toBe(before);
  });
});
