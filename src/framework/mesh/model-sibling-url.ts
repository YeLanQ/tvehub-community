// 模型同目录资源地址归一化（纯函数）：编辑器侧模型装载共用。
// 与运行时 model.ts 的 resolveSiblingUrl 同一规则（运行时返回 "./x" 形态，
// 编辑器返回资产相对路径），改一处须对另一处做行为对齐核查。

/**
 * 把加载器给出的资源地址解析为「模型同目录资产」的相对路径。
 * 绝对地址（http/data/blob/asset 等）与无法归一化的地址返回 null（调用方放行原地址）；
 * 相对地址按 POSIX 规则归一化（支持子目录与 ../ 回溯，越出资产根由后端沙箱拦截）。
 *
 * 幂等剥模型目录前缀：GLTFLoader.parse 先经 LoaderUtils.resolveURL 把 resourcePath
 * （模型目录）纯字符串拼进地址，之后才走 LoadingManager 修饰器——不剥会拼出
 * models/models/… 双前缀。
 */
export function resolveSiblingRel(modelDir: string, url: string): string | null {
  const raw = url.split("?")[0];
  if (!raw || /^(https?:|data:|blob:|file:|asset:)/i.test(raw)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    rel = raw; // 非法百分号序列按原文处理
  }
  rel = rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!rel || /^[a-zA-Z]:/.test(rel)) return null;
  const prefix = modelDir ? `${modelDir}/` : "";
  if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  const joined = modelDir ? `${modelDir}/${rel}` : rel;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  if (!parts.length) return null;
  return parts.join("/");
}
