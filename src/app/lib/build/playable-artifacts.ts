// playable 渠道导出期工件注入：按勾选目标所需形态注入入口页模板——
//   单页形态 → files["index.html"]（单页模板，含 {{BUILD_DATA}} 占位）
//   多文件形态 → files["index-multi.html"]（多文件模板；键命中现有 index-*
//     入口页分类器 classify::is_entry_page，Rust playable 管线取它写为目标
//     目录的 index.html，两个入口键都不泄漏进产物）
// 与 web 渠道的差异：两种形态可并存（分别服务 single/multi 目标），因此模板
// 选择也分单页/多文件两槽（BuildOptions.playableTemplates），不用 web 的互斥
// 多选。返回 IPC 的 singlePage 恒 false（Rust 按目标形态组装，不消费该字段）。
import type { BuildOptions } from "./options";
import { neededForms, playableTargetById } from "./playable-targets";
import { withHtmlTitle } from "../web-preview-runtime";
import {
  fetchExportTemplateHtml,
  loadExportTemplates,
  resolveExportTemplate,
  type ExportTemplateInfo,
} from "./web-artifacts";

/** 模板列表可注入（单测免 fetch / tauri IPC） */
export async function applyPlayableExportArtifacts(
  opts: BuildOptions,
  files: Record<string, string>,
  templates?: ExportTemplateInfo[],
): Promise<{ singlePage: boolean }> {
  const targets = (opts.playableTargets ?? [])
    .map(playableTargetById)
    .filter((t): t is NonNullable<typeof t> => t != null);
  const available = targets.filter((t) => t.available);
  if (!available.length) {
    throw new Error("试玩广告渠道：请至少勾选一个可导出的广告渠道");
  }
  // 形态按全部勾选 id 计算（含占位目标——extra 入口无害，可用性由 Rust
  // preflight 权威拦截）
  const forms = neededForms(targets.map((t) => t.id));
  const pool = templates ?? (await loadExportTemplates());

  if (forms.has("single")) {
    const tpl = resolveExportTemplate(
      opts.playableTemplates?.single,
      pool.filter((t) => t.mode === "single"),
    );
    if (!tpl) throw new Error("试玩广告渠道缺少单页导出模板（public/exports/web）");
    files["index.html"] = withHtmlTitle(await fetchExportTemplateHtml(tpl), opts.title);
  }
  if (forms.has("multi")) {
    const tpl = resolveExportTemplate(
      opts.playableTemplates?.multi,
      pool.filter((t) => t.mode === "multi"),
    );
    if (!tpl) throw new Error("试玩广告渠道缺少多文件导出模板（public/exports/web）");
    files["index-multi.html"] = withHtmlTitle(await fetchExportTemplateHtml(tpl), opts.title);
  }
  return { singlePage: false };
}
