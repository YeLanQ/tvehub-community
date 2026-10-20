import { describe, expect, it } from "vitest";
import { toTopLeftRect } from "./viewportOrigin";

describe("RHI 视口矩形原点换算（three/webgpu 左上角原点）", () => {
  it("全画布矩形换算后原点仍为 0（回贴结束复原视口）", () => {
    expect(toTopLeftRect({ x: 0, y: 0, width: 1600, height: 900 }, 900)).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    });
  });

  it("右下角画中画矩形换算到视口顶部（距底 12、高 158）", () => {
    expect(toTopLeftRect({ x: 1308, y: 12, width: 280, height: 158 }, 900)).toEqual({
      x: 1308,
      y: 730,
      width: 280,
      height: 158,
    });
  });

  it("只翻转 y，x 与尺寸不变", () => {
    const r = toTopLeftRect({ x: 10, y: 100, width: 200, height: 50 }, 600);
    expect([r.x, r.y, r.width, r.height]).toEqual([10, 450, 200, 50]);
  });
});
