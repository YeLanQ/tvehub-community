import type { ProjectTemplate } from "./project-templates";
import { api } from "../../lib/api";

/**
 * 读取模板文件内容（相对路径 → 内容），供 create_project 写入项目。
 * 模板文件清单（files）来自 template-registry（内置）/ scan_user_templates（自定义）：
 * - 内置模板：fetch public/templates/<dir>/<rel>（随 exe 内嵌，打包后可用）；
 * - 用户自定义模板：经 Rust 读 exe 旁 public/templates/<dir>/<rel>（磁盘文件）。
 */
export async function fetchTemplateFiles(
  template: ProjectTemplate,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    template.files.map(async (rel) => {
      if (template.builtin === false && template.id.startsWith("user:")) {
        return [rel, await api.readUserTemplateText("templates", template.dir, rel)] as const;
      }
      const url = `/templates/${template.dir}/${rel}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`读取模板文件失败: ${url} (${res.status})`);
      }
      return [rel, await res.text()] as const;
    }),
  );
  return Object.fromEntries(entries);
}
