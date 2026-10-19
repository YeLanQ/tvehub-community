// ---------------------------------------------------------------------------
// 模型外部资源 URL 归一化（Worker 解析路径用，纯函数）。
// GLTFLoader 在 Worker 内拿到的 image/bin uri 是相对模型目录的相对地址；
// 这里把它拼到「模型目录的 asset URL」上，并处理 `..` 回溯。
//
// 不能用 new URL(url, base)：asset URL 的项目路径整段百分号编码，URL 的
// `../` 回溯会在编码段内错位弹栈，必须按字符串段处理。
// ---------------------------------------------------------------------------

/** 协议作用域段：`p`（项目根）/ `i`（内置资源）——上溯到此为止，不越出资产根 */
const SCOPE_RE = /\/(p|i)$/;

/** 上溯一级 URL（去掉最后一个路径段）；已到协议作用域段即停 */
function popAssetSegment(url: string): string {
  if (SCOPE_RE.test(url)) return url;
  const i = url.lastIndexOf("/");
  if (i <= 0) return url;
  return url.slice(0, i);
}

/**
 * 相对地址 → 资产 URL：
 * - 绝对地址（http/data/blob/asset/file）原样返回（调用方放行）；
 * - `.`/空段忽略，`..` 先弹已收集段、弹空后沿 base 上溯（模型换目录后引用
 *   会带 ../，丢弃会解析到模型目录下的假路径 → 贴图 404 白模）；
 * - 路径段做 encodeURIComponent（空格等字符在 URL 中必须编码）。
 */
export function resolveSiblingAssetUrl(baseUrl: string, url: string): string {
  const raw = url.split("?")[0];
  if (!raw || /^(https?:|data:|blob:|asset:|file:)/i.test(raw)) return url;
  let rel = raw;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    /* 非法百分号序列按原文处理 */
  }
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const parts: string[] = [];
  let dirUrl = base;
  for (const seg of rel.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      else dirUrl = popAssetSegment(dirUrl);
      continue;
    }
    parts.push(seg);
  }
  if (!parts.length) return url;
  return `${dirUrl}/${parts.map(encodeURIComponent).join("/")}`;
}
