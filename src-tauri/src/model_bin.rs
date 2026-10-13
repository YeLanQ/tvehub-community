//! 发布模式模型二进制化（移植 LQEN pack 方案：LQENBIN1 容器）：
//! - `.glb`/`.gltf` → 贴图外置化后 kind=1 包装。bin 只含几何/动画字节：
//!   内嵌且使用中的贴图提取为模型同目录兄弟文件（binaries 插入，随 uid 重命名），
//!   `images[].uri` 引用；外部引用贴图保持 uri；data: URI 保持 JSON 内嵌；
//!   未使用的贴图剔除（外部记 unused_sibs 由管线打包时剔除）；
//!   未被引用的 bufferView 压缩剔除（索引保持稳定，无需重写引用方）；
//! - `.obj` → kind=0 顶点网格二进制（v/vt/vn/f → 小端数组，player 侧重建 BufferGeometry）；
//! - 产物统一重命名为 `<uid>.bin`，player 按扩展名解包（见 runtime/runtime/model.ts
//!   parseBinModel）。uid 重命名后由 [`rewrite_model_texture_urls`] 改写 GLB 内 uri。
//! 转换失败回退原格式（保持 uid 重命名，不影响构建）。

use std::collections::{HashMap, HashSet};

use crate::scene_pack::{build_glb_container, glb_json_doc, gltf_sibling_rel};

/// 容器魔数（8 字节）+ u32 kind（LE）+ u32 payload 长度（LE）+ payload
const MAGIC: &[u8; 8] = b"LQENBIN1";

/// 模型转换结果：bin 字节 + 外部兄弟文件去留（管线据此打包/剔除）
pub(crate) struct ModelBinConversion {
    pub bin: Vec<u8>,
    /// 已并入 bin、不再单独打包的外部兄弟文件（.gltf 的外部 buffer）
    pub merged_sibs: Vec<String>,
    /// 判定未使用而剔除的兄弟文件（外部贴图；管线在他处未被引用时剔除）
    pub unused_sibs: Vec<String>,
}

/// 极简 OBJ → 二进制（kind=0 顶点网格）：v/vt/vn/f → 小端二进制（LQEN 同款格式）
pub fn obj_to_bin(text: &str) -> Option<Vec<u8>> {
    let mut verts: Vec<[f32; 3]> = Vec::new();
    let mut norms: Vec<[f32; 3]> = Vec::new();
    let mut uvs: Vec<[f32; 2]> = Vec::new();
    let mut faces: Vec<[u32; 3]> = Vec::new();
    for line in text.lines() {
        let mut it = line.split_whitespace();
        let Some(kind) = it.next() else { continue };
        match kind {
            "v" => {
                let mut a = [0f32; 3];
                for c in a.iter_mut() {
                    *c = it.next()?.parse().ok()?;
                }
                verts.push(a);
            }
            "vn" => {
                let mut a = [0f32; 3];
                for c in a.iter_mut() {
                    *c = it.next()?.parse().ok()?;
                }
                norms.push(a);
            }
            "vt" => {
                let mut a = [0f32; 2];
                for c in a.iter_mut() {
                    *c = it.next()?.parse().ok()?;
                }
                uvs.push(a);
            }
            "f" => {
                let mut idxs = [0u32; 3];
                for i in 0..3 {
                    let tok = it.next()?;
                    let first = tok.split('/').next()?.parse::<u32>().ok()?;
                    idxs[i] = if first > 0 { first - 1 } else { 0 };
                }
                faces.push(idxs);
            }
            _ => {}
        }
    }
    if verts.is_empty() || faces.is_empty() {
        return None;
    }
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&0u32.to_le_bytes()); // kind: 0 = 顶点网格
    for n in [
        verts.len() as u32,
        norms.len() as u32,
        uvs.len() as u32,
        faces.len() as u32,
    ] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    for a in &verts {
        for c in a {
            out.extend_from_slice(&c.to_le_bytes());
        }
    }
    for a in &norms {
        for c in a {
            out.extend_from_slice(&c.to_le_bytes());
        }
    }
    for a in &uvs {
        for c in a {
            out.extend_from_slice(&c.to_le_bytes());
        }
    }
    for f in &faces {
        for i in f {
            out.extend_from_slice(&i.to_le_bytes());
        }
    }
    Some(out)
}

/// GLB → kind=1 包装（kind=0 OBJ 与 glTF 已外置化后的 GLB 容器共用）
pub fn glb_to_bin(bytes: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(16 + bytes.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&1u32.to_le_bytes()); // kind: 1 = glb 原始字节
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    out
}

/// data URI / 文件兄弟引用 → 字节（文件引用记入 merged，调用方决定是否从产物剔除）
fn resolve_uri(
    model_rel: &str,
    uri: &str,
    binaries: &HashMap<String, Vec<u8>>,
    merged: &mut Vec<String>,
) -> Option<Vec<u8>> {
    if let Some(b64) = uri
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(','))
        .map(|(_, b64)| b64)
    {
        use base64::Engine as _;
        let cleaned: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
        return base64::engine::general_purpose::STANDARD.decode(cleaned).ok();
    }
    let sib = gltf_sibling_rel(model_rel, uri)?;
    let data = binaries.get(&sib)?;
    merged.push(sib);
    Some(data.clone())
}

fn mime_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// 文件名段消毒（GLTF 内名可能含路径分隔/Windows 非法字符）
fn sanitize_seg(v: &str) -> String {
    let clean: String = v
        .chars()
        .map(|c| if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let trimmed = clean.trim();
    if trimmed.is_empty() { "_".to_string() } else { trimmed.to_string() }
}

/// uri 编码：逐段百分号编码非安全字符，保留路径分隔符
fn uri_encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            let mut out = String::with_capacity(seg.len());
            for b in seg.bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'!' | b'\'' | b'(' | b')' | b'*' => {
                        out.push(b as char);
                    }
                    _ => out.push_str(&format!("%{b:02X}")),
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// GLB 容器 →（JSON 文档, BIN chunk 字节）；非容器/解析失败 → None
fn glb_parts(bytes: &[u8]) -> Option<(serde_json::Value, Vec<u8>)> {
    let json = glb_json_doc(bytes)?;
    let total = u32::from_le_bytes(bytes[8..12].try_into().ok()?) as usize;
    let jlen = u32::from_le_bytes(bytes[12..16].try_into().ok()?) as usize;
    let mut off = 20usize.checked_add(jlen)?;
    let mut bin = Vec::new();
    while off + 8 <= total.min(bytes.len()) {
        let clen = u32::from_le_bytes(bytes[off..off + 4].try_into().ok()?) as usize;
        if &bytes[off + 4..off + 8] == b"BIN\x00" {
            bin.extend_from_slice(bytes.get(off + 8..off + 8 + clen)?);
        }
        off += 8usize.checked_add(clen)?;
    }
    Some((json, bin))
}

/// 材质子树内的贴图使用扫描：任何含数值 `index` 键的对象都计为纹理引用
/// （KHR_texture_transform 的引用是 `{index, extensions}` 双键形态，只认单键会误剔）；
/// 含数值 `source` 键的计为直接图像引用（EXT_texture_webp 等扩展形态）。
fn collect_used_texture_refs(
    v: &serde_json::Value,
    tex_idx: &mut HashSet<usize>,
    img_idx: &mut HashSet<usize>,
) {
    match v {
        serde_json::Value::Object(map) => {
            if let Some(i) = map.get("index").and_then(|x| x.as_u64()) {
                tex_idx.insert(i as usize);
            }
            if let Some(i) = map.get("source").and_then(|x| x.as_u64()) {
                img_idx.insert(i as usize);
            }
            for child in map.values() {
                collect_used_texture_refs(child, tex_idx, img_idx);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                collect_used_texture_refs(child, tex_idx, img_idx);
            }
        }
        _ => {}
    }
}

/// 全文档 bufferView 引用扫描（accessor/sparse/draco/留存内嵌图）
fn collect_buffer_view_refs(v: &serde_json::Value, out: &mut HashSet<usize>) {
    match v {
        serde_json::Value::Object(map) => {
            if let Some(i) = map.get("bufferView").and_then(|x| x.as_u64()) {
                out.insert(i as usize);
            }
            for child in map.values() {
                collect_buffer_view_refs(child, out);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                collect_buffer_view_refs(child, out);
            }
        }
        _ => {}
    }
}

/// 同目录兄弟文件插入 binaries：同名字节一致复用（跨模型共享贴图去重），
/// 冲突加序号。返回实际落位的 rel。
fn insert_sibling(
    binaries: &mut HashMap<String, Vec<u8>>,
    base_rel: String,
    bytes: &[u8],
) -> String {
    let ext = base_rel.rsplit('.').next().unwrap_or("").to_string();
    let stem = base_rel[..base_rel.len() - ext.len()].trim_end_matches('.');
    let mut rel = base_rel.clone();
    let mut n = 2;
    loop {
        match binaries.get(&rel) {
            Some(existing) if existing.as_slice() == bytes => return rel, // 共享复用
            Some(_) => {
                rel = format!("{stem} {n}.{ext}");
                n += 1;
            }
            None => {
                binaries.insert(rel.clone(), bytes.to_vec());
                return rel;
            }
        }
    }
}

/// gltf/glb → 贴图外置化 GLB：外部 buffer 并入 blob、使用中内嵌贴图提取为兄弟
/// 文件、未使用贴图剔除、blob 按 bufferView 引用压缩（索引不变）。
fn externalize_gltf(
    rel: &str,
    json: &mut serde_json::Value,
    blob: &[u8],
    binaries: &mut HashMap<String, Vec<u8>>,
) -> Option<(Vec<u8>, Vec<String>, Vec<String>)> {
    let stem = sanitize_seg(&rel.rsplit('/').next().map_or(rel, |n| {
        n.rsplit_once('.').map_or(n, |(s, _)| s)
    }));

    // 使用中纹理/图像判定（材质子树扫描，可变借用前完成）
    let mut tex_used = HashSet::new();
    let mut img_direct = HashSet::new();
    if let Some(mats) = json.get("materials") {
        collect_used_texture_refs(mats, &mut tex_used, &mut img_direct);
    }
    let mut img_used = img_direct;
    if let Some(texs) = json.get("textures").and_then(|v| v.as_array()) {
        for t in tex_used.iter() {
            if let Some(src) = texs.get(*t).and_then(|x| x.get("source")).and_then(|x| x.as_u64()) {
                img_used.insert(src as usize);
            }
        }
    }

    // bufferView 位置表（图像提取用；提前算好避免循环内再借 json）
    let bv_info: Vec<(usize, usize)> = json
        .get("bufferViews")
        .and_then(|v| v.as_array())
        .map(|bvs| {
            bvs.iter()
                .map(|bv| {
                    let off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let len = bv
                        .get("byteLength")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as usize)
                        .unwrap_or(blob.len().saturating_sub(off));
                    (off, len)
                })
                .collect()
        })
        .unwrap_or_default();

    // 使用中内嵌贴图 → 提取为兄弟文件；未使用 → 图像条目清空（字节随压缩剔除）
    let mut unused_sibs: Vec<String> = Vec::new();
    let mut kept_bvs: HashSet<usize> = HashSet::new();
    {
        let obj = json.as_object_mut()?;
        if let Some(imgs) = obj.get_mut("images").and_then(|v| v.as_array_mut()) {
            for (i, img) in imgs.iter_mut().enumerate() {
                let Some(o) = img.as_object_mut() else { continue };
                if !img_used.contains(&i) {
                    if let Some(uri) = o.get("uri").and_then(|v| v.as_str()) {
                        if let Some(sib) = gltf_sibling_rel(rel, uri) {
                            unused_sibs.push(sib);
                        }
                    }
                    *img = serde_json::json!({});
                    continue;
                }
                let raw_name = o.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let name = sanitize_seg(raw_name);
                let name = if name == "_" { format!("image{i}") } else { name };
                let Some(bvi) = o.get("bufferView").and_then(|v| v.as_u64()) else { continue };
                // 内嵌：mimeType 判定扩展名；不认识的格式保持内嵌（不动）
                let Some(mime) = o.get("mimeType").and_then(|v| v.as_str()) else { continue };
                let Some(ext) = mime_ext(mime) else {
                    kept_bvs.insert(bvi as usize);
                    continue;
                };
                let Some(&(off, len)) = bv_info.get(bvi as usize) else { continue };
                let Some(data) = blob.get(off..off.checked_add(len)?) else { continue };
                let fname = format!("{stem}_{name}.{ext}");
                let sib_rel = if let Some(dir) = rel.rfind('/').map(|p| &rel[..=p]) {
                    insert_sibling(binaries, format!("{dir}{fname}"), data)
                } else {
                    insert_sibling(binaries, fname, data)
                };
                let file_name = sib_rel.rsplit('/').next().unwrap_or(&sib_rel).to_string();
                o.remove("bufferView");
                o.insert("uri".into(), serde_json::json!(uri_encode_path(&file_name)));
                // 已是 uri（外部文件/data:）的使用中贴图：保持引用原样
            }
        }
    }

    // blob 压缩：只保留仍被引用的 bufferView（索引稳定，未引用置零长桩）
    let old_bvs = json
        .get_mut("bufferViews")
        .and_then(|v| v.as_array_mut())
        .map(std::mem::take)
        .unwrap_or_default();
    let mut refs = HashSet::new();
    collect_buffer_view_refs(json, &mut refs);
    refs.extend(&kept_bvs);
    let mut new_blob: Vec<u8> = Vec::with_capacity(blob.len());
    let mut new_bvs = Vec::with_capacity(old_bvs.len());
    for (i, bv) in old_bvs.iter().enumerate() {
        if !refs.contains(&i) {
            new_bvs.push(serde_json::json!({ "buffer": 0, "byteOffset": 0, "byteLength": 0 }));
            continue;
        }
        let off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let len = bv
            .get("byteLength")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(blob.len().saturating_sub(off));
        let data = blob.get(off..off.checked_add(len)?)?;
        let mut nbv = bv.clone();
        nbv.as_object_mut().map(|o| {
            o.insert("buffer".into(), serde_json::json!(0));
            o.insert("byteOffset".into(), serde_json::json!(new_blob.len()));
        });
        new_blob.extend_from_slice(data);
        new_bvs.push(nbv);
    }
    let obj = json.as_object_mut()?;
    obj.insert("bufferViews".into(), serde_json::Value::Array(new_bvs));
    obj.insert(
        "buffers".into(),
        serde_json::json!([{ "byteLength": new_blob.len() }]),
    );
    Some((build_glb_container(json, &new_blob), Vec::new(), unused_sibs))
}

/// .gltf（JSON + 外部 .bin/贴图）→（JSON 文档, 合并后的 blob, 已并入的外部兄弟文件）。
/// 外部 buffer 缺失 → None（回退原格式）。
fn gltf_json_and_blob(
    rel: &str,
    bytes: &[u8],
    binaries: &HashMap<String, Vec<u8>>,
) -> Option<(serde_json::Value, Vec<u8>, Vec<String>)> {
    let mut json: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let mut merged: Vec<String> = Vec::new();
    let mut blob: Vec<u8> = Vec::new();
    let mut prefixes: Vec<usize> = Vec::new();
    let bufs = json
        .get_mut("buffers")
        .and_then(|v| v.as_array_mut())
        .map(std::mem::take)
        .unwrap_or_default();
    for b in &bufs {
        if let Some(uri) = b.get("uri").and_then(|v| v.as_str()) {
            let data = resolve_uri(rel, uri, binaries, &mut merged)?;
            prefixes.push(blob.len());
            blob.extend_from_slice(&data);
            while blob.len() % 4 != 0 {
                blob.push(0);
            }
        } else {
            prefixes.push(0); // 无 uri buffer：gltf 无内嵌数据段，视作空
        }
    }
    if let Some(bvs) = json.get_mut("bufferViews").and_then(|v| v.as_array_mut()) {
        for bv in bvs.iter_mut() {
            let bi = bv.get("buffer").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            if let Some(o) = bv.as_object_mut() {
                o.insert("buffer".into(), serde_json::json!(0));
                o.insert(
                    "byteOffset".into(),
                    serde_json::json!(prefixes.get(bi).copied().unwrap_or(0) + off),
                );
            }
        }
    }
    Some((json, blob, merged))
}

/// 模型转换分派（发布模式）：glb/gltf → 贴图外置化 kind=1，obj → kind=0。
/// 失败 → None（调用方回退原格式）。
pub(crate) fn convert_model_to_bin(
    rel: &str,
    binaries: &mut HashMap<String, Vec<u8>>,
) -> Option<ModelBinConversion> {
    let ext = rel.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "obj" => {
            let text = String::from_utf8_lossy(binaries.get(rel)?);
            obj_to_bin(&text).map(|bin| ModelBinConversion { bin, merged_sibs: Vec::new(), unused_sibs: Vec::new() })
        }
        "glb" => {
            let bytes = binaries.get(rel)?.clone();
            let (mut json, blob) = glb_parts(&bytes)?;
            let (glb, merged, unused) = externalize_gltf(rel, &mut json, &blob, binaries)?;
            Some(ModelBinConversion { bin: glb_to_bin(&glb), merged_sibs: merged, unused_sibs: unused })
        }
        "gltf" => {
            let bytes = binaries.get(rel)?.clone();
            let (mut json, blob, merged) = gltf_json_and_blob(rel, &bytes, binaries)?;
            let (glb, _, unused) = externalize_gltf(rel, &mut json, &blob, binaries)?;
            Some(ModelBinConversion { bin: glb_to_bin(&glb), merged_sibs: merged, unused_sibs: unused })
        }
        _ => None,
    }
}

/// uid 重命名后改写模型 GLB 内 images[].uri（兄弟文件 rel → uid 新名）。
/// 模型本体/贴图兄弟的重命名表一致传入；非 LQENBIN1 kind=1 静默跳过。
pub(crate) fn rewrite_model_texture_urls(
    model_rel: &str,
    lqenbin: &mut Vec<u8>,
    renames: &HashMap<String, String>,
) {
    if lqenbin.len() < 16 || &lqenbin[0..8] != MAGIC {
        return;
    }
    if u32::from_le_bytes(lqenbin[8..12].try_into().unwrap_or([0; 4])) != 1 {
        return;
    }
    let payload = lqenbin[16..].to_vec();
    let Some((mut json, blob)) = glb_parts(&payload) else { return };
    let Some(imgs) = json.get_mut("images").and_then(|v| v.as_array_mut()) else { return };
    // 模型本体新目录（uri 相对它解析）
    let new_model_rel = renames.get(model_rel).cloned().unwrap_or_else(|| model_rel.to_string());
    let new_dir = match new_model_rel.rfind('/') {
        Some(i) => &new_model_rel[..i],
        None => "",
    };
    let mut changed = false;
    for img in imgs.iter_mut() {
        let Some(uri) = img.get("uri").and_then(|v| v.as_str()).map(String::from) else { continue };
        let Some(sib) = gltf_sibling_rel(model_rel, &uri) else { continue };
        let Some(new_sib) = renames.get(&sib) else { continue };
        let new_uri = relative_uri(new_dir, new_sib);
        if let Some(o) = img.as_object_mut() {
            o.insert("uri".into(), serde_json::json!(uri_encode_path(&new_uri)));
            changed = true;
        }
    }
    if !changed {
        return;
    }
    *lqenbin = glb_to_bin(&build_glb_container(&json, &blob));
}

/// 新模型目录 → 兄弟文件新 rel 的相对引用（同目录直接文件名，跨目录 ../ 回溯）
fn relative_uri(from_dir: &str, to_rel: &str) -> String {
    let from: Vec<&str> = if from_dir.is_empty() { Vec::new() } else { from_dir.split('/').collect() };
    let to: Vec<&str> = to_rel.split('/').collect();
    let (to_dirs, file) = to.split_at(to.len() - 1);
    let common = from.iter().zip(to_dirs.iter()).take_while(|(a, b)| a == b).count();
    let mut out: Vec<String> = Vec::new();
    for _ in common..from.len() {
        out.push("..".to_string());
    }
    out.extend(to_dirs[common..].iter().map(|s| s.to_string()));
    out.push(file[0].to_string());
    out.join("/")
}

#[cfg(test)]
mod tests;
