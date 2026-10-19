// ---------------------------------------------------------------------------
// 模型文件内部引用随动改写（glTF 家族）：
// .gltf/.glb 的 buffers[].uri / images[].uri 是**相对于模型文件所在目录**的
// 相对地址，与场景里的项目相对路径不是一回事。模型或它的外部贴图/二进制换
// 位置时，只改写场景/材质里的字符串并不够：模型内部的相对地址会指向新的
// 空目录 → 贴图丢失（白模）或 .bin 缺失（模型加载失败）。
//
// 本模块按「保持引用目标的项目相对路径不变」改写 URI：
//   旧模型目录 + 旧 uri = 目标项目路径 →（from→to 映射）→ 新目标路径
//   → 新 uri = 新模型目录到新目标路径的相对地址
// 覆盖三种情形：模型文件自身移动、贴图/bin 被移动、目录整体移动（组内相对
// 地址不变时不落盘）。GLB 只重写 JSON chunk（其余 chunk 字节原样保留）。
// ---------------------------------------------------------------------------

use std::fs;
use std::io::Read;
use std::path::Path;

use serde_json::Value;

use super::ref_remap::{map_rel, unmap_rel};

/// 外部引用清单字段（glTF 的 buffers / images 元素都是 { uri }）
const URI_CONTAINERS: [&str; 2] = ["buffers", "images"];
/// JSON chunk 类型标记（小端 "JSON"）
const CHUNK_JSON: &[u8; 4] = b"JSON";

/// 扫描项目内全部 .gltf/.glb，改写受移动影响的外部 URI。
/// 返回内容被改写的模型相对路径（正斜杠）。
pub fn remap_model_external_uris(root: &Path, from: &str, to: &str) -> Vec<String> {
    let mut changed = Vec::new();
    if from.is_empty() || from == to {
        return changed;
    }
    walk(root, root, from, to, &mut changed);
    changed
}

fn walk(root: &Path, dir: &Path, from: &str, to: &str, changed: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') && name != "node_modules" {
                walk(root, &p, from, to, changed);
            }
            continue;
        }
        let Some(ext) = p
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
        else {
            continue;
        };
        if ext != "gltf" && ext != "glb" {
            continue;
        }
        let rel = p
            .strip_prefix(root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if rel.is_empty() {
            continue;
        }
        let ok = if ext == "gltf" {
            rewrite_gltf(root, &p, &rel, from, to)
        } else {
            rewrite_glb(root, &p, &rel, from, to)
        };
        if ok == Some(true) {
            changed.push(rel);
        }
    }
}

/// .gltf（JSON 文本）：解析 → 改写 URI → pretty 回写（无命中不动文件）
fn rewrite_gltf(root: &Path, path: &Path, rel: &str, from: &str, to: &str) -> Option<bool> {
    let text = fs::read_to_string(path).ok()?;
    let mut doc: Value = serde_json::from_str(&text).ok()?;
    if !rewrite_doc(&mut doc, root, rel, from, to) {
        return Some(false);
    }
    let content = serde_json::to_string_pretty(&doc).ok()?;
    fs::write(path, content).ok()?;
    Some(true)
}

/// .glb：只读文件头 + JSON chunk 判定是否需要改写；需要时才整文件重建
/// （BIN chunk 与额外 chunk 原样保留，仅替换 JSON chunk 并回填总长）
fn rewrite_glb(root: &Path, path: &Path, rel: &str, from: &str, to: &str) -> Option<bool> {
    let mut f = fs::File::open(path).ok()?;
    let mut head = [0u8; 20];
    f.read_exact(&mut head).ok()?;
    if &head[0..4] != b"glTF" || &head[16..20] != CHUNK_JSON {
        return Some(false);
    }
    let json_len = u32::from_le_bytes(head[12..16].try_into().ok()?) as usize;
    let mut json_bytes = vec![0u8; json_len];
    f.read_exact(&mut json_bytes).ok()?;
    let mut doc: Value = serde_json::from_slice(&json_bytes).ok()?;
    if !rewrite_doc(&mut doc, root, rel, from, to) {
        return Some(false);
    }
    write_glb_with_json(path, &doc).ok()?;
    Some(true)
}

/// 重建 GLB：新 JSON chunk（空格补齐 4 字节）+ 原文件其余 chunk 原样拼接
fn write_glb_with_json(path: &Path, doc: &Value) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() < 20 {
        return Err("GLB 文件过短".to_string());
    }
    let orig_json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let rest_start = 20usize
        .checked_add(orig_json_len)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| "GLB JSON chunk 长度越界".to_string())?;

    let mut json_bytes = serde_json::to_vec(doc).map_err(|e| e.to_string())?;
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let mut out = Vec::with_capacity(bytes.len() + json_bytes.len());
    out.extend_from_slice(&bytes[0..12]);
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(CHUNK_JSON);
    out.extend_from_slice(&json_bytes);
    out.extend_from_slice(&bytes[rest_start..]);
    let total = (out.len() as u32).to_le_bytes();
    out[8..12].copy_from_slice(&total);
    fs::write(path, out).map_err(|e| format!("写入 GLB 失败: {e}"))
}

/// 改写文档内 buffers/images 的 uri；命中任意改写返回 true。
fn rewrite_doc(doc: &mut Value, root: &Path, rel: &str, from: &str, to: &str) -> bool {
    // 模型自身也可能被移动：URI 的解析基准必须是**移动前**的目录
    let old_rel = unmap_rel(rel, from, to);
    let dir_old = dir_of(&old_rel);
    let dir_new = dir_of(rel);
    let mut hit = false;
    for key in URI_CONTAINERS {
        let Some(items) = doc.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        for item in items {
            let Some(obj) = item.as_object_mut() else {
                continue;
            };
            let Some(Value::String(uri)) = obj.get("uri") else {
                continue;
            };
            let Some(next) = remap_uri(root, &dir_old, &dir_new, uri, from, to) else {
                continue;
            };
            obj.insert("uri".to_string(), Value::String(next));
            hit = true;
        }
    }
    hit
}

/// 单个 URI 的新值（无需改写返回 None）。
/// 目标原路径不存在且自身未被移动命中时跳过——避免对本来就是断链的引用做无谓改写。
fn remap_uri(
    root: &Path,
    dir_old: &str,
    dir_new: &str,
    uri: &str,
    from: &str,
    to: &str,
) -> Option<String> {
    let target_old = resolve_uri(dir_old, uri)?;
    let mapped = map_rel(&target_old, from, to);
    let target_new = mapped.clone().unwrap_or_else(|| target_old.clone());
    if mapped.is_none() && !root.join(&target_old).is_file() {
        return None;
    }
    let next = rel_from_dir(dir_new, &target_new)?;
    if next == uri {
        return None;
    }
    Some(encode_uri(&next))
}

/// 写回 URI 的最小百分号编码：解码方（编辑器/运行时）会对 URI 做
/// decodeURIComponent，裸 `%`/空格/`#`/`?` 会被解码坏或截断路径。
fn encode_uri(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for ch in path.chars() {
        match ch {
            '%' => out.push_str("%25"),
            ' ' => out.push_str("%20"),
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            _ => out.push(ch),
        }
    }
    out
}

/// 外部 URI → 项目相对路径（按 dir + uri 归一化，拒绝绝对地址/协议/越界回溯）。
fn resolve_uri(dir: &str, uri: &str) -> Option<String> {
    // gltf_sibling_rel 按「模型 rel 所在目录 + uri」解析；用一个占位文件名取目录
    let model_rel = if dir.is_empty() {
        "__model__".to_string()
    } else {
        format!("{dir}/__model__")
    };
    crate::scene_pack::gltf_sibling_rel(&model_rel, uri)
}

/// 目录 dir → 目标 target 的相对地址（POSIX；dir 为空表示项目根）
pub fn rel_from_dir(dir: &str, target: &str) -> Option<String> {
    let d: Vec<&str> = if dir.is_empty() {
        Vec::new()
    } else {
        dir.split('/').filter(|s| !s.is_empty()).collect()
    };
    let t: Vec<&str> = target.split('/').filter(|s| !s.is_empty()).collect();
    if t.is_empty() || (dir == target && !d.is_empty()) {
        return None;
    }
    let mut same = 0;
    while same < d.len() && same + 1 < t.len() && d[same] == t[same] {
        same += 1;
    }
    let mut parts: Vec<&str> = Vec::new();
    parts.extend(std::iter::repeat("..").take(d.len() - same));
    parts.extend_from_slice(&t[same..]);
    Some(parts.join("/"))
}

fn dir_of(rel: &str) -> String {
    rel.rfind('/').map(|i| rel[..i].to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tve-modelrefs-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    fn read_json(root: &Path, rel: &str) -> Value {
        serde_json::from_str(&fs::read_to_string(root.join(rel)).unwrap()).unwrap()
    }

    #[test]
    fn rel_from_dir_basics() {
        assert_eq!(rel_from_dir("a/b", "a/b/c.png").as_deref(), Some("c.png"));
        assert_eq!(rel_from_dir("a/b", "a/c.png").as_deref(), Some("../c.png"));
        assert_eq!(rel_from_dir("", "a/c.png").as_deref(), Some("a/c.png"));
        assert_eq!(rel_from_dir("models", "shared/x.png").as_deref(), Some("../shared/x.png"));
        assert_eq!(rel_from_dir("a", "a"), None);
    }

    /// 模型文件移到另一个目录：内部 bins/images 相对地址指回原目录；
    /// 目标未移动的外部引用也要重算（相对基准变了）
    #[test]
    fn model_move_rewrites_own_external_uris() {
        let root = scratch("model-move");
        write(
            &root,
            "assets/models/hero/hero.gltf",
            r#"{"asset":{"version":"2.0"},"buffers":[{"uri":"hero.bin"}],"images":[{"uri":"textures/skin.png"},{"uri":"../../shared/logo.png"}]}"#,
        );
        write(&root, "assets/models/hero/hero.bin", "bin");
        write(&root, "assets/models/hero/textures/skin.png", "png");
        write(&root, "assets/shared/logo.png", "png");
        // 模拟文件已移动到 assets/heroes/hero.gltf
        fs::create_dir_all(root.join("assets/heroes")).unwrap();
        fs::rename(
            root.join("assets/models/hero/hero.gltf"),
            root.join("assets/heroes/hero.gltf"),
        )
        .unwrap();

        let changed = remap_model_external_uris(
            &root,
            "assets/models/hero/hero.gltf",
            "assets/heroes/hero.gltf",
        );
        assert_eq!(changed, vec!["assets/heroes/hero.gltf".to_string()]);
        let doc = read_json(&root, "assets/heroes/hero.gltf");
        assert_eq!(doc["buffers"][0]["uri"], "../models/hero/hero.bin");
        assert_eq!(doc["images"][0]["uri"], "../models/hero/textures/skin.png");
        // 共享资源没动，但相对基准从 hero/ 换成了 heroes/ → 仍须重算
        assert_eq!(doc["images"][1]["uri"], "../shared/logo.png");
        let _ = fs::remove_dir_all(&root);
    }

    /// 贴图被单独移动：引用它的模型改写 URI 指向新位置
    #[test]
    fn dependency_move_rewrites_referencing_model() {
        let root = scratch("dep-move");
        write(
            &root,
            "assets/models/hero.gltf",
            r#"{"asset":{"version":"2.0"},"images":[{"uri":"textures/skin.png"},{"uri":"keep.png"}]}"#,
        );
        write(&root, "assets/models/textures/skin.png", "png");
        write(&root, "assets/models/keep.png", "png");
        write(&root, "assets/shared/skin.png", "png");

        let changed = remap_model_external_uris(
            &root,
            "assets/models/textures/skin.png",
            "assets/shared/skin.png",
        );
        assert_eq!(changed, vec!["assets/models/hero.gltf".to_string()]);
        let doc = read_json(&root, "assets/models/hero.gltf");
        assert_eq!(doc["images"][0]["uri"], "../shared/skin.png");
        // 未命中的引用不动
        assert_eq!(doc["images"][1]["uri"], "keep.png");
        let _ = fs::remove_dir_all(&root);
    }

    /// 目录整体移动：组内相对地址不变，不落盘不改写
    #[test]
    fn directory_move_keeps_internal_relative_uris() {
        let root = scratch("dir-move");
        let original = r#"{"asset":{"version":"2.0"},"images":[{"uri":"textures/skin.png"}]}"#;
        write(&root, "assets/m1/hero.gltf", original);
        write(&root, "assets/m1/textures/skin.png", "png");
        let changed = remap_model_external_uris(&root, "assets/models", "assets/m1");
        assert!(changed.is_empty(), "组内资源相对位置不变，无需改写");
        assert_eq!(
            fs::read_to_string(root.join("assets/m1/hero.gltf")).unwrap(),
            original
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// GLB：JSON chunk 内外部 uri 改写，BIN chunk 字节原样保留
    #[test]
    fn glb_rewrite_preserves_bin_chunk() {
        let root = scratch("glb");
        let bin: Vec<u8> = vec![1, 2, 3, 4, 5];
        let json = serde_json::json!({
            "asset": { "version": "2.0" },
            "images": [{ "uri": "textures/skin.ktx2" }]
        });
        let glb = crate::scene_pack::build_glb_container(&json, &bin);
        write(&root, "assets/models/a.glb", "");
        fs::write(root.join("assets/models/a.glb"), &glb).unwrap();
        write(&root, "assets/models/textures/skin.ktx2", "ktx");
        fs::create_dir_all(root.join("assets/heroes")).unwrap();
        fs::rename(root.join("assets/models/a.glb"), root.join("assets/heroes/a.glb")).unwrap();

        let changed =
            remap_model_external_uris(&root, "assets/models/a.glb", "assets/heroes/a.glb");
        assert_eq!(changed, vec!["assets/heroes/a.glb".to_string()]);
        let bytes = fs::read(root.join("assets/heroes/a.glb")).unwrap();
        let doc = crate::scene_pack::glb_json_doc(&bytes).expect("仍是合法 GLB");
        assert_eq!(doc["images"][0]["uri"], "../models/textures/skin.ktx2");
        // BIN chunk 内容原样
        let total = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, bytes.len());
        assert!(bytes.windows(bin.len()).any(|w| w == bin.as_slice()));
        let _ = fs::remove_dir_all(&root);
    }

    /// 无关移动：不改写、不落盘
    #[test]
    fn unrelated_move_changes_nothing() {
        let root = scratch("noop");
        let original = r#"{"asset":{"version":"2.0"},"images":[{"uri":"a.png"}]}"#;
        write(&root, "assets/models/m.gltf", original);
        write(&root, "assets/models/a.png", "png");
        let changed = remap_model_external_uris(&root, "assets/audio/x.mp3", "assets/sfx/x.mp3");
        assert!(changed.is_empty());
        assert_eq!(
            fs::read_to_string(root.join("assets/models/m.gltf")).unwrap(),
            original
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// 带空格的目录名（Kenney 资源包形态）：写回的 URI 做最小百分号编码，
    /// 仍能被 resolve_uri 还原到同一条项目路径
    #[test]
    fn paths_with_spaces_roundtrip() {
        let root = scratch("spaces");
        write(
            &root,
            "assets/kenney/Models/GLB format/bench.glb",
            "",
        );
        let json = serde_json::json!({
            "asset": { "version": "2.0" },
            "images": [{ "uri": "Textures/colormap.png" }]
        });
        fs::write(
            root.join("assets/kenney/Models/GLB format/bench.glb"),
            crate::scene_pack::build_glb_container(&json, &[9, 9, 9, 9]),
        )
        .unwrap();
        write(&root, "assets/kenney/Models/GLB format/Textures/colormap.png", "png");
        fs::create_dir_all(root.join("assets/models")).unwrap();
        fs::rename(
            root.join("assets/kenney/Models/GLB format/bench.glb"),
            root.join("assets/models/bench.glb"),
        )
        .unwrap();

        let changed = remap_model_external_uris(
            &root,
            "assets/kenney/Models/GLB format/bench.glb",
            "assets/models/bench.glb",
        );
        assert_eq!(changed, vec!["assets/models/bench.glb".to_string()]);
        let bytes = fs::read(root.join("assets/models/bench.glb")).unwrap();
        let doc = crate::scene_pack::glb_json_doc(&bytes).unwrap();
        let uri = doc["images"][0]["uri"].as_str().unwrap();
        assert_eq!(uri, "../kenney/Models/GLB%20format/Textures/colormap.png");
        // 解码解析回原目标：新模型目录 + 新 uri = 原贴图项目路径
        assert_eq!(
            resolve_uri("assets/models", uri).as_deref(),
            Some("assets/kenney/Models/GLB format/Textures/colormap.png")
        );
        let _ = fs::remove_dir_all(&root);
    }
}
