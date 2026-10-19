// ---------------------------------------------------------------------------
// 资产移动/重命名后的引用随动改写（磁盘侧）。
// 资产在项目内换了位置（移动/重命名），所有指向旧路径的引用必须跟着改写，
// 否则模型丢贴图变白模、节点丢模型回落占位盒。本模块扫描项目内承载资产
// 引用的 JSON 文档（.scene/.prefab/.mat/.texcube/.terrain/.terrainmat），
// 把等于旧路径或位于旧路径目录前缀之下的字符串值改写到新路径。
//
// 采用「全树字符串值精确匹配」而不是逐引用字段枚举：引用字段面随节点类型
// 增长（material/model/modelMaterialOverrides/cubeMap/audio/prefab…各不相同，
// 收集器漏一处在别处就表现为白模），而与资产相对路径逐字相等的字符串值
// 只可能是引用（或语义上本就应随动的文本），不会误伤。
//
// 打开中的场景会话（内存）由 scene::remap_scene_sessions 同步改写并广播
// replace 事件；本模块只负责落盘文件。
// ---------------------------------------------------------------------------

use std::fs;
use std::path::Path;

use serde_json::Value;

/// 承载资产引用的文档扩展名（小写）。不在列的文件不解析；解析失败的跳过。
const REF_DOC_EXTS: [&str; 6] = ["scene", "prefab", "mat", "texcube", "terrain", "terrainmat"];

/// 遍历中跳过的目录（版本库/依赖目录与隐藏目录）
fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// 路径改写判定：rel 等于 from 或位于 from/ 之下时映射到 to 对应位置，否则 None。
/// from/to 为项目相对正斜杠路径（尾斜杠容忍）。
pub fn map_rel(rel: &str, from: &str, to: &str) -> Option<String> {
    fn trim(p: &str) -> &str {
        p.trim_end_matches('/')
    }
    let src = trim(from);
    if src.is_empty() {
        return None;
    }
    if rel == src {
        return Some(trim(to).to_string());
    }
    let rest = rel.strip_prefix(&format!("{src}/"))?;
    Some(format!("{}/{}", trim(to), rest))
}

/// map_rel 的逆映射：当前 rel 若落在 to 之下，还原其移动前的位置（否则原样返回）。
/// 模型内部 URI 的解析基准必须用移动前目录（见 model_refs）。
pub fn unmap_rel(rel: &str, from: &str, to: &str) -> String {
    fn trim(p: &str) -> &str {
        p.trim_end_matches('/')
    }
    let dst = trim(to);
    if dst.is_empty() {
        return rel.to_string();
    }
    if rel == dst {
        return trim(from).to_string();
    }
    match rel.strip_prefix(&format!("{dst}/")) {
        Some(rest) => format!("{}/{}", trim(from), rest),
        None => rel.to_string(),
    }
}

/// 递归改写 JSON 树中的字符串值（精确/前缀匹配旧路径）；命中任意改写返回 true。
pub fn remap_json_strings(v: &mut Value, from: &str, to: &str) -> bool {
    match v {
        Value::String(s) => match map_rel(s, from, to) {
            Some(next) => {
                *s = next;
                true
            }
            None => false,
        },
        Value::Array(items) => items
            .iter_mut()
            .fold(false, |hit, item| hit | remap_json_strings(item, from, to)),
        Value::Object(o) => o
            .values_mut()
            .fold(false, |hit, item| hit | remap_json_strings(item, from, to)),
        _ => false,
    }
}

/// 引用随动改写报告：内容被改写的文件相对路径（正斜杠）
#[derive(Default, Debug)]
pub struct RefRemapReport {
    /// 内容被改写的 .scene 文件
    pub scenes: Vec<String>,
    /// 内容被改写的其他引用文档（.mat/.texcube 等）
    pub others: Vec<String>,
    /// 内部外部 URI 被改写的模型文件（.gltf/.glb）
    pub models: Vec<String>,
}

/// 扫描项目并改写引用（磁盘侧）。from == to 时无需改写。
/// 单个文件读写/解析失败跳过（不阻断移动主流程，引用保持原样由调用方日志可见）。
pub fn remap_project_refs(root: &Path, from_rel: &str, to_rel: &str) -> RefRemapReport {
    let mut report = RefRemapReport::default();
    if from_rel.is_empty() || from_rel == to_rel {
        return report;
    }
    walk_dir(root, root, from_rel, to_rel, &mut report);
    // 模型内部相对 URI（同目录 .bin/贴图）：与文档字符串引用是两套路径语义
    report.models = super::model_refs::remap_model_external_uris(root, from_rel, to_rel);
    report
}

fn walk_dir(root: &Path, dir: &Path, from: &str, to: &str, report: &mut RefRemapReport) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if !is_skipped_dir(&entry.file_name().to_string_lossy()) {
                walk_dir(root, &p, from, to, report);
            }
            continue;
        }
        let Some(ext) = p
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
        else {
            continue;
        };
        if !REF_DOC_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&p) else {
            continue;
        };
        let Ok(mut doc) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if !remap_json_strings(&mut doc, from, to) {
            continue;
        }
        let Ok(content) = serde_json::to_string_pretty(&doc) else {
            continue;
        };
        if fs::write(&p, content).is_err() {
            continue;
        }
        let rel = p
            .strip_prefix(root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if ext == "scene" {
            report.scenes.push(rel);
        } else {
            report.others.push(rel);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tve-refremap-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn map_rel_exact_prefix_and_miss() {
        assert_eq!(
            map_rel("assets/textures/a.png", "assets/textures/a.png", "assets/tex/b.png"),
            Some("assets/tex/b.png".into())
        );
        // 目录移动：前缀整体平移
        assert_eq!(
            map_rel("assets/textures/sub/a.png", "assets/textures", "assets/tex"),
            Some("assets/tex/sub/a.png".into())
        );
        // 相邻名不误伤（assets/textures2 不是 assets/textures 之下）
        assert_eq!(map_rel("assets/textures2/a.png", "assets/textures", "assets/tex"), None);
        assert_eq!(map_rel("assets/other.png", "assets/textures", "assets/tex"), None);
        // 尾斜杠容忍
        assert_eq!(
            map_rel("assets/textures/a.png", "assets/textures/", "assets/tex/"),
            Some("assets/tex/a.png".into())
        );
        assert_eq!(map_rel("x.png", "", "y"), None);
    }

    #[test]
    fn remap_updates_mat_texture_fields() {
        let root = scratch("mat");
        fs::write(
            root.join("m.mat"),
            r#"{"$type":"material","name":"M","shader":"","map":"assets/textures/a.png","normalMap":"assets/textures/n.png"}"#,
        )
        .unwrap();
        let report = remap_project_refs(&root, "assets/textures/a.png", "assets/tex2/a.png");
        assert_eq!(report.scenes.len(), 0);
        assert_eq!(report.others, vec!["m.mat".to_string()]);
        let text = fs::read_to_string(root.join("m.mat")).unwrap();
        let doc: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["map"], "assets/tex2/a.png");
        // 未命中的通道保持原值
        assert_eq!(doc["normalMap"], "assets/textures/n.png");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_updates_scene_refs_incl_override_table() {
        let root = scratch("scene");
        fs::create_dir_all(root.join("assets/models")).unwrap();
        fs::write(
            root.join("assets/models/main.scene"),
            r#"{
  "root": {
    "type": "meshNode",
    "source": "model",
    "model": "assets/models/hero.glb",
    "material": "assets/materials/hero.mat",
    "modelMaterialOverrides": { "Body": "assets/materials/body.mat" },
    "children": [
      { "type": "audioNode", "audio": "assets/audio/shot.mp3" }
    ]
  }
}"#,
        )
        .unwrap();
        let report = remap_project_refs(&root, "assets/materials", "assets/mats");
        assert_eq!(report.scenes, vec!["assets/models/main.scene".to_string()]);
        let doc: Value =
            serde_json::from_str(&fs::read_to_string(root.join("assets/models/main.scene")).unwrap())
                .unwrap();
        assert_eq!(doc["root"]["material"], "assets/mats/hero.mat");
        assert_eq!(doc["root"]["modelMaterialOverrides"]["Body"], "assets/mats/body.mat");
        // 目录外引用不动
        assert_eq!(doc["root"]["model"], "assets/models/hero.glb");
        assert_eq!(doc["root"]["children"][0]["audio"], "assets/audio/shot.mp3");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_skips_unmatched_and_non_json_files() {
        let root = scratch("skip");
        fs::write(root.join("plain.mat"), "not json at all").unwrap();
        fs::write(root.join("raw.png"), "\u{0}\u{1}binary").unwrap();
        fs::write(
            root.join("clean.scene"),
            r#"{"root":{"type":"meshNode","model":"assets/keep.glb"}}"#,
        )
        .unwrap();
        let report = remap_project_refs(&root, "assets/moved.glb", "assets/next.glb");
        assert!(report.scenes.is_empty() && report.others.is_empty());
        // 未命中引用的文件字节不变
        assert_eq!(
            fs::read_to_string(root.join("clean.scene")).unwrap(),
            r#"{"root":{"type":"meshNode","model":"assets/keep.glb"}}"#
        );
        assert_eq!(fs::read_to_string(root.join("plain.mat")).unwrap(), "not json at all");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_noop_when_same_path() {
        let root = scratch("noop");
        fs::write(
            root.join("a.mat"),
            r#"{"map":"assets/textures/a.png"}"#,
        )
        .unwrap();
        let report = remap_project_refs(&root, "assets/textures/a.png", "assets/textures/a.png");
        assert!(report.scenes.is_empty() && report.others.is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
