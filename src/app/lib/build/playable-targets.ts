// 试玩广告目标注册表（TS 侧单源）：playable 渠道内可勾选导出的广告渠道清单。
// Rust 侧镜像 src-tauri/src/build/channels/playable/targets.rs——两例试图一一
// 对应，改一处必改另一处（playable_e2e 守护行为、本目录 spec 守护形状）。
//
// 形态语义（form）：
//   single → 产物 <target>/index.html（全内联自包含，直接上传平台素材后台）
//   multi  → 产物 <target>/（普通静态站点；平台要求 zip 上传的自行打包）
//   both   → 两者都产：<target>/single/ + <target>/multi/
// 不可用目标（available=false）为注册占位：UI 展示但置灰，适配器随后续版本
// 逐家落地（需逐平台核对官方 spec 并真机验证）。

export type PlayableTargetForm = "single" | "multi" | "both";

export interface PlayableTarget {
  /** 目标 id（勾选项 / 产物目录名 / config.playableTargets 元素） */
  id: string;
  /** UI 显示名 */
  label: string;
  desc: string;
  /** 产物形态 */
  form: PlayableTargetForm;
  /** 适配器是否已落地（false = 注册占位，UI 置灰「即将支持」） */
  available: boolean;
}

export const PLAYABLE_TARGETS: PlayableTarget[] = [
  {
    id: "meta",
    label: "Meta / Facebook",
    desc: "FBPlayableOnCTAClick 桥；单页 HTML 直传",
    form: "single",
    available: true,
  },
  {
    id: "google",
    label: "Google AdMob",
    desc: "ExitApi.exit 桥；单页 HTML 直传",
    form: "single",
    available: true,
  },
  {
    id: "mraid",
    label: "MRAID 通用（Unity / AppLovin / Vungle 等）",
    desc: "IAB mraid.open 桥，全族共用；单页 HTML 直传",
    form: "single",
    available: true,
  },
  {
    id: "ironsource",
    label: "Unity Grow（原 ironSource）",
    // 官方当前 spec（docs.unity.com Grow / Playable asset specifications）：
    // 单 HTML 全内联 ≤5MB + MRAID 3.0——历史的 DAPI postMessage 事件无公开
    // 官方文档，运行时契约与 mraid 目标同族（探测落 mraid）
    desc: "MRAID 3.0 契约（官方 spec 单 HTML 直传）",
    form: "single",
    available: true,
  },
  {
    id: "mintegral",
    label: "Mintegral",
    // 官方双 API（Unity Playworks 适配文档 + Mindworks 指南）：CTA=window.install、
    // 结束上报=window.gameEnd；单 HTML 或 zip 均收——此处走多文件 zip 路线
    desc: "window.install / gameEnd 桥；多文件打包 zip 上传",
    form: "multi",
    available: true,
  },
  {
    id: "pangle",
    label: "TikTok / 穿山甲 Pangle",
    // 官方开发者 spec 在 Pangle Partner Center 登录墙内，公开渠道核不到——
    // 按 tve-playable-ads/extend-platform 规则「核不到官方页不动笔」保持占位
    desc: "官方 spec 登录墙内未核实，核到再解锁",
    form: "single",
    available: false,
  },
];

/** 按 id 取目标（未知返回 null） */
export function playableTargetById(id: string): PlayableTarget | null {
  return PLAYABLE_TARGETS.find((t) => t.id === id) ?? null;
}

/** 目标 id 集需要的产物形态集合（both 展开为两种形态；纯注册表映射，不管
 *  available——可用性过滤是 extraIpc/preflight 的职责，本函数只回答形态） */
export function neededForms(targetIds: string[]): Set<"single" | "multi"> {
  const forms = new Set<"single" | "multi">();
  for (const id of targetIds) {
    const t = playableTargetById(id);
    if (!t) continue;
    if (t.form === "single" || t.form === "both") forms.add("single");
    if (t.form === "multi" || t.form === "both") forms.add("multi");
  }
  return forms;
}

/** 目标某一形态的产物目录（相对构建输出根 build/playable/）：
 *  both 目标分 single/ multi/ 子目录，单一形态目标直接占目标目录 */
export function targetOutRel(id: string, form: "single" | "multi"): string {
  const t = playableTargetById(id);
  return t?.form === "both" ? `${id}/${form}` : id;
}
