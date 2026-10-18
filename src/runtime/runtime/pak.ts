// 构建产物资产加载（压缩/内联归档）：
// - parseArchive：解析 assets.gzip 解压后的帧格式（u32 条数 LE +
//   每条 [u32 pathLen][path][u32 dataLen][data]），得到 相对路径 → 字节表；
// - gunzip：浏览器原生 DecompressionStream 解压（无需服务器配合）；
// - installAssetShim：安装 window.fetch 拦截，命中内存资产的请求直接返回 Response，
//   其余请求透传原生 fetch——player 与 libs 各模块的资产读取代码无需感知产物形态
//   （多文件/单页、gzip/非 gzip 统一按相对路径 fetch）。

/** base64 → 字节（单页内联数据用；大字符串分块解码避免参数长度限制） */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** gzip 解压（浏览器原生 DecompressionStream；不支持时抛错） */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 归档内容表（相对路径 → 字节） */
export type AssetArchiveMap = Map<string, Uint8Array>;

/** 解析归档帧格式（输入为已解压字节） */
export function parseArchive(bytes: Uint8Array): AssetArchiveMap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const count = view.getUint32(off, true);
  off += 4;
  const map: AssetArchiveMap = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint32(off, true);
    off += 4;
    const path = dec.decode(bytes.subarray(off, off + pathLen));
    off += pathLen;
    const dataLen = view.getUint32(off, true);
    off += 4;
    map.set(path, bytes.slice(off, off + dataLen));
    off += dataLen;
  }
  return map;
}

/** fetch 拦截识别的窗口形状（防重复安装标记） */
interface AssetShimWindow {
  __tveAssetShimInstalled?: boolean;
}

/** 安全解码（非法百分号序列原样返回，不抛错） */
function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** 资源 URL → 归档条目键候选（部署形态无关，命中任一即可）。
 *  - 服务器根部署：整段 pathname；
 *  - 子路径部署：入口页目录之后的相对路径；
 *  - `file://` 双击打开：入口页目录是完整磁盘路径。两侧必须都先解码再比较——
 *    入口页路径含中文/空格时 location.pathname 是百分号编码、资源 pathname 解码后
 *    是原字符，编码态 base 前缀永不匹配（曾致打开产物贴图全 404、模型白模）。
 *  跨源地址返回空数组（不接管）。 */
export function assetKeyCandidates(rawUrl: string, pageHref: string): string[] {
  let u: URL;
  let page: URL;
  try {
    u = new URL(rawUrl, pageHref);
    page = new URL(pageHref);
  } catch {
    return [];
  }
  const isFile = u.protocol === "file:";
  if (!isFile && u.origin !== page.origin) return [];
  const path = decodePath(u.pathname);
  const pagePath = decodePath(page.pathname);
  const base = pagePath.replace(/[^/]*$/, "");
  const keys = [path.replace(/^\/+/, "")];
  if (base && path.startsWith(base)) {
    keys.push(path.slice(base.length).replace(/^\/+/, ""));
  }
  // 编码态键兜底（归档键理论上都是解码后的原始路径，防御性保留）
  const encoded = u.pathname.replace(/^\/+/, "");
  if (!keys.includes(encoded)) keys.push(encoded);
  return keys.filter((k) => k.length > 0);
}

/** 安装 fetch 拦截：同源相对路径命中内存资产 → Response；其余透传原生 fetch。
 *  命中项每次返回数据副本（Response 消费后不可复用）。
 *  key 匹配见 assetKeyCandidates（服务器根 / 子路径部署 / file:// 双击三种形态）。 */
export function installAssetShim(map: AssetArchiveMap): void {
  const w = window as Window & AssetShimWindow;
  if (w.__tveAssetShimInstalled) return;
  w.__tveAssetShimInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      // 入参三种形态都识别：字符串 / URL 对象（.href）/ Request（.url）
      const url =
        typeof input === "string"
          ? input
          : typeof URL !== "undefined" && input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : undefined;
      if (typeof url === "string" && !init?.body) {
        for (const key of assetKeyCandidates(url, location.href)) {
          const hit = map.get(key);
          if (hit) return Promise.resolve(new Response(hit.slice()));
        }
      }
    } catch {
      /* URL 解析失败按原样透传 */
    }
    return nativeFetch(input, init);
  };
}
