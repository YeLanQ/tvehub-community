// material.get 输出形态：颜色统一为 "#rrggbb" 字符串（与 material.set 入参一致，
// 避免「set 收字符串、get 回整数、磁盘存小写 hex」三种形态并存）。

import { type MaterialParams, colorToHexString } from "../../framework/material";
import { isMaterialColorKey } from "./materialSet";

/** 输出参数对象（深拷贝 props；颜色字段转 #rrggbb） */
export function materialParamsForOutput(params: MaterialParams): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params, props: { ...params.props } };
  for (const key of Object.keys(out)) {
    if (isMaterialColorKey(key)) {
      const v = (params as unknown as Record<string, number>)[key];
      out[key] = colorToHexString(typeof v === "number" ? v : 0);
    }
  }
  return out;
}
