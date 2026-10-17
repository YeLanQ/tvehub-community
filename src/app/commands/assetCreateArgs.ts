// asset.create 目标路径解析（纯函数，独立便于单测）。
// 两种形态：① dir + name（历史契约）；② path（完整目标路径，2026-10-17 起支持）。
// path 此前被静默忽略，{path:"assets/Materials/X.mat"} 会落到项目根 Material.mat。

/** 各资产类型的扩展名（folder 无扩展名） */
const TYPE_EXT: Record<string, string> = {
  scene: ".scene",
  script: ".ts",
  material: ".mat",
  shader: ".shader",
  texcube: ".texcube",
  skybox: ".mat",
  prefab: ".prefab",
  anim: ".anim",
  terrain: ".terrain",
};

export interface AssetTarget {
  /** 目标目录（项目相对，空串 = 项目根） */
  dir: string;
  /** 文件名（含扩展名）；null = 调用方用类型默认名 */
  stem: string | null;
}

/** 解析 asset.create 的目标：path 与 dir/name 互斥；扩展名须与类型匹配 */
export function resolveAssetTarget(args: {
  type: string;
  dir?: unknown;
  name?: unknown;
  path?: unknown;
}): { target: AssetTarget } | { error: string } {
  const type = args.type;
  const dir = typeof args.dir === "string" ? args.dir.replace(/\/+$/, "") : "";
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : null;
  const rawPath = typeof args.path === "string" ? args.path.trim().replace(/\\/g, "/") : "";
  if (!rawPath) return { target: { dir, stem: name } };

  if (dir || name) return { error: "asset.create 的 path 与 dir/name 不能同时使用" };
  if (rawPath.startsWith("/") || rawPath.split("/").some((s) => s === ".." || s === "")) {
    return { error: `非法的资产路径: ${rawPath}` };
  }
  const slash = rawPath.lastIndexOf("/");
  const targetDir = slash >= 0 ? rawPath.slice(0, slash) : "";
  const stem = slash >= 0 ? rawPath.slice(slash + 1) : rawPath;
  if (!stem) return { error: `资产路径缺少文件名: ${rawPath}` };

  const expectedExt = TYPE_EXT[type];
  const lower = stem.toLowerCase();
  if (expectedExt && lower.includes(".") && !lower.endsWith(expectedExt)) {
    return { error: `asset.create type=${type} 的扩展名应为 ${expectedExt}，收到: ${rawPath}` };
  }
  if (type === "script" && targetDir && targetDir !== "src" && !targetDir.startsWith("src/")) {
    return { error: "脚本资产必须位于 src/ 或其子目录" };
  }
  return { target: { dir: targetDir, stem } };
}
