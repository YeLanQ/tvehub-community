import { describe, expect, it } from "vitest";
import { RenderScaleController } from "./renderScale";

// 自适应渲染精度决策器：连续超预算降档 / 连续健康升档 / 观察窗防横跳 /
// 档位边界钳制。全逻辑纯时间序列驱动，无时钟依赖。
describe("RenderScaleController", () => {
  it("正常：连续 8 个超预算 tick 降一档（瞬时/加载尖峰不动档）", () => {
    const c = new RenderScaleController();
    for (let i = 0; i < 7; i++) expect(c.tick(true)).toBe(1);
    expect(c.tick(true)).toBe(0.85);
    // 瞬时尖峰：7 个超预算后回健康 → 计数清零不动档
    for (let i = 0; i < 7; i++) c.tick(true);
    expect(c.tick(false)).toBe(0.85);
    expect(c.tick(false)).toBe(0.85);
  });

  it("持续超预算逐档降到下限 0.5 后钳制（40 连超跨观察窗降两档）", () => {
    const c = new RenderScaleController();
    // 每轮 40 个超预算 tick：第 8 tick 降档、第 38 tick（观察窗 30 满）再降
    const drive = (): number => {
      let s = 1;
      for (let i = 0; i < 40; i++) s = c.tick(true);
      return s;
    };
    expect(drive()).toBe(0.7);
    expect(drive()).toBe(0.6);
    expect(drive()).toBe(0.5);
    expect(drive()).toBe(0.5); // 已到下限不再降
  });

  it("恢复：连续健康 tick 达 180 后升档还原清晰度（中间超预算清零）", () => {
    const c = new RenderScaleController();
    for (let i = 0; i < 8; i++) c.tick(true); // 降到 0.85
    // 健康计数需连续达 180：中间插超预算会清零
    for (let i = 0; i < 100; i++) c.tick(false);
    c.tick(true);
    for (let i = 0; i < 100; i++) c.tick(false);
    expect(c.scale).toBe(0.85);
    for (let i = 0; i < 80; i++) c.tick(false);
    expect(c.scale).toBe(1);
  });

  it("观察窗：换档后 30 tick 内即使持续超预算也不再连降", () => {
    const c = new RenderScaleController();
    let s = 1;
    for (let i = 0; i < 8; i++) s = c.tick(true); // 第 8 个超预算 tick 降档
    expect(s).toBe(0.85);
    // 换档后 29 tick 内：即使一直超预算也保持（稳定观察窗）
    for (let i = 0; i < 29; i++) s = c.tick(true);
    expect(s).toBe(0.85);
    // 观察窗一过（第 30 tick）且超预算计数已达 → 允许再降
    s = c.tick(true);
    expect(s).toBe(0.7);
  });
});
