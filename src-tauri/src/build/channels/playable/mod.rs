//! playable 渠道产物管线（工厂桥接的渠道实现之一）：试玩广告按勾选目标逐一
//! 产出——内容内核只收集一次，按目标所需形态（去重后 ≤2 种）各组装一份共享
//! 产物，逐目标写入 `out/<目标>[/single|/multi]/`。
//!
//! 产物约束（resolve/preflight 强制）：CDN 强制关（试玩禁外链，three 恒内嵌）；
//! 多文件形态强制非 gzip（平台的 assets.gzip 归档是 web 托管格式，广告平台
//! 上传要普通文件）；config 写入 playableAd/playableTargets 供运行时契约层
//! （src/runtime/runtime/playable）激活。目标注册表见 targets.rs（TS 镜像）。

use std::collections::HashMap;

use crate::build::finalize::{finish_result, main_scene_name, read_project_config, ResultDraft};
use crate::build::forms::{assemble_multi_file, assemble_single_page};
use crate::build::job::{BuildJob, BuildResult, JobCtx, PlayableTargetResult, Prepared};
use crate::build::kernel::classify::{is_minifiable_script, is_runtime_code};
use crate::build::kernel::content::{build_content, ContentManifest};
use crate::build::kernel::release::minify_js_source;
use crate::build::options::{PlayableParams, ResolvedChannel};
use crate::build::pipeline::{progress, ChannelPipeline};
use crate::build::steps::config::product_config;

mod targets;
use self::targets::TargetForm;

/// playable 渠道：试玩广告逐目标产物管线
pub struct PlayablePipeline;

impl ChannelPipeline for PlayablePipeline {
    fn id(&self) -> &'static str {
        "playable"
    }

    fn resolve(&self, job: &BuildJob) -> ResolvedChannel {
        // 目标去重保序（勾选顺序）；gzip 只作用于单页形态（内联压缩）
        let mut targets: Vec<String> = Vec::new();
        for id in &job.playable_targets {
            if !targets.iter().any(|t| t == id) {
                targets.push(id.clone());
            }
        }
        ResolvedChannel::Playable(PlayableParams { targets, gzip_single: job.gzip })
    }

    fn preflight(&self, job: &BuildJob) -> Result<(), String> {
        if job.playable_targets.is_empty() {
            return Err("试玩广告渠道：请至少勾选一个广告渠道目标".to_string());
        }
        let mut need_single = false;
        let mut need_multi = false;
        for id in &job.playable_targets {
            let Some(t) = targets::target_by_id(id) else {
                return Err(format!("试玩广告渠道：未知目标 '{id}'"));
            };
            if !t.available {
                return Err(format!("试玩广告渠道：目标 '{id}' 适配器尚未支持"));
            }
            match t.form {
                TargetForm::Single => need_single = true,
                TargetForm::Multi => need_multi = true,
                TargetForm::Both => {
                    need_single = true;
                    need_multi = true;
                }
            }
        }
        // 入口页由前端模板注入（playable-artifacts.ts）；缺席 = 注入链断
        if need_single && !job.files.contains_key("index.html") {
            return Err("试玩广告渠道：缺少单页入口模板 index.html".to_string());
        }
        if need_multi && !job.files.contains_key("index-multi.html") {
            return Err("试玩广告渠道：缺少多文件入口模板 index-multi.html".to_string());
        }
        Ok(())
    }

    fn build(&self, p: &Prepared, ctx: &JobCtx) -> Result<BuildResult, String> {
        let playable = p.channel.playable();
        let job = &p.job;
        let mut files = job.files.clone();
        // 前端运行时清单里的 .wasm（base64 混在文本 map 里）分流进 binaries
        let mut binaries: HashMap<String, Vec<u8>> = HashMap::new();
        crate::scene_pack::split_wasm_base64_files(&mut files, &mut binaries)?;

        // 内容内核：与 web/wechat 同源（跨渠道一致性由 consistency_e2e 守护）
        ctx.progress(progress::COLLECT, "收集场景与资产");
        let content = build_content(&p.root_path, &job.scenes, job.release)?;
        for (k, v) in &content.text_assets {
            files.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (k, v) in &content.binaries {
            binaries.entry(k.clone()).or_insert_with(|| v.clone());
        }

        if ctx.cancelled() {
            return Err("任务已取消".into());
        }
        ctx.progress(progress::ASSEMBLE, "组装产物");

        let project_cfg = read_project_config(&p.root_path);
        let main_name = main_scene_name(&content.packed, &p.main_scene);
        let mut cfg = product_config(project_cfg, &content.packed, &main_name, job.debug, &files, "");
        // 运行时契约层激活键（仅 playable 渠道写入；web/wechat 产物零扰动）
        cfg.insert(
            "playableAd".to_string(),
            serde_json::Value::Bool(true),
        );
        cfg.insert(
            "playableTargets".to_string(),
            serde_json::Value::Array(
                playable.targets.iter().map(|t| serde_json::Value::String(t.clone())).collect(),
            ),
        );

        // 发布模式：压缩运行时脚本一次（单页/多文件两形态共享压缩结果）
        if job.release {
            if ctx.cancelled() {
                return Err("任务已取消".into());
            }
            use rayon::prelude::*;
            files.par_iter_mut().for_each(|(rel, text)| {
                if is_minifiable_script(rel) {
                    *text = minify_js_source(text);
                }
            });
        }

        // 形态去重组装：同形态目标共享同一份产物（逐目标只差落盘目录）
        let mut built: HashMap<&'static str, FormArtifact> = HashMap::new();
        for id in &playable.targets {
            let form = targets::target_by_id(id).expect("preflight 已校验目标").form;
            for kind in form.kinds().into_iter().flatten() {
                if !built.contains_key(kind) {
                    let artifact =
                        self.build_form(kind, &files, &binaries, &content, &cfg, playable.gzip_single)?;
                    built.insert(kind, artifact);
                }
            }
        }

        // 逐目标落盘（out/<目标>[/single|/multi]/，staging 原子换入）
        ctx.progress(progress::WRITE, "写入试玩广告产物");
        let out_base_rel = p
            .out
            .strip_prefix(&p.root_path)
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let mut results: Vec<PlayableTargetResult> = Vec::new();
        for id in &playable.targets {
            let form = targets::target_by_id(id).expect("preflight 已校验目标").form;
            for kind in form.kinds().into_iter().flatten() {
                let artifact = &built[kind];
                let rel = targets::target_out_rel(id, kind);
                if ctx.cancelled() {
                    return Err("任务已取消".into());
                }
                crate::scene_pack::write_export_dir(
                    &p.out.join(&rel),
                    artifact.files.clone(),
                    &artifact.binaries,
                )
                .map_err(|e| format!("写入试玩广告产物失败（{rel}）: {e}"))?;
                results.push(PlayableTargetResult {
                    id: id.clone(),
                    form: kind.to_string(),
                    out_rel: if out_base_rel.is_empty() {
                        rel.clone()
                    } else {
                        format!("{out_base_rel}/{rel}")
                    },
                    html_bytes: artifact.html_bytes,
                });
            }
        }

        let missing_n = content.missing.len();
        let bin_n = content.bin_converted.len();
        let mut message = format!("构建完成（{} 个目标）", results.len());
        if bin_n > 0 {
            message.push_str(&format!("，模型→.bin {bin_n} 个"));
        }
        if missing_n > 0 {
            message.push_str(&format!("（{} 项缺失资产被跳过）", missing_n));
        }
        let has_single = built.contains_key("single");
        Ok(finish_result(
            p,
            ResultDraft {
                packed: content.packed,
                main_name,
                bin_converted: content.bin_converted,
                assets_packed: content.assets_packed,
                missing: content.missing,
                single_page: has_single,
                gzip: has_single && playable.gzip_single,
                cdn: false,
                message,
                targets: results,
            },
        ))
    }
}

/// 一种形态组装出的共享产物（同形态目标逐份克隆落盘）
struct FormArtifact {
    files: HashMap<String, String>,
    binaries: HashMap<String, Vec<u8>>,
    /// 单页 HTML 字节数（多文件形态为 0）
    html_bytes: u64,
}

impl PlayablePipeline {
    /// 组装一种形态的产物。输入是已合并资产、已压缩的基底（files/binaries/
    /// 场景文本/config）；每形态独立克隆互不污染。CDN 恒关（three_base 空、
    /// cdn_active=false）；多文件形态强制非 gzip。
    fn build_form(
        &self,
        kind: &'static str,
        base_files: &HashMap<String, String>,
        base_binaries: &HashMap<String, Vec<u8>>,
        content: &ContentManifest,
        cfg: &serde_json::Map<String, serde_json::Value>,
        gzip_single: bool,
    ) -> Result<FormArtifact, String> {
        let mut files = base_files.clone();
        let mut binaries = base_binaries.clone();
        match kind {
            "single" => {
                // 入口页分流：单页模板 index.html 注入数据；多文件模板不参与
                files.remove("index-multi.html");
                let gzip = gzip_single;
                let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
                for (rel, text) in &content.scene_texts {
                    entries.push((rel.clone(), text.clone().into_bytes()));
                }
                let mut code_files: HashMap<String, String> = HashMap::new();
                for (rel, text) in files.drain() {
                    if is_runtime_code(&rel) {
                        code_files.insert(rel, text);
                    } else {
                        entries.push((rel, text.into_bytes()));
                    }
                }
                files = code_files;
                // 单页：wasm 一并内联进资产表（fetch 垫片供数）
                for (rel, bytes) in binaries.drain() {
                    entries.push((rel, bytes));
                }
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                let code_n = assemble_single_page(&mut files, &mut entries, cfg.clone(), "", false, gzip)?;
                let html_bytes = files
                    .get("index.html")
                    .map(|h| h.len() as u64)
                    .unwrap_or_default();
                let _ = code_n;
                Ok(FormArtifact { files, binaries, html_bytes })
            }
            "multi" => {
                // 入口页分流：多文件模板改键为正式入口；单页模板不参与
                let entry = files
                    .remove("index-multi.html")
                    .ok_or("多文件形态缺少入口模板 index-multi.html")?;
                files.remove("index.html");
                files.insert("index.html".to_string(), entry);
                // 多文件非 gzip：场景/资产按相对路径落盘（binaries 保持真实文件）
                for (rel, text) in &content.scene_texts {
                    files.insert(rel.clone(), text.clone());
                }
                assemble_multi_file(&mut files, &mut binaries, &[], cfg.clone(), "", false, false)?;
                Ok(FormArtifact { files, binaries, html_bytes: 0 })
            }
            other => Err(format!("未知产物形态: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::PlayablePipeline;

    /// 多文件形态组装机制（当前注册表无 multi 可用目标，e2e 走不到该分支——
    /// 以单测直接驱动 build_form 锁机制：入口页改键、单页模板不泄漏、
    /// config/server/README 附带、场景落盘）。
    #[test]
    fn multi_form_assembles_site() {
        let base_files = HashMap::from([
            (
                "index.html".to_string(),
                "<html>single-entry</html>".to_string(),
            ),
            (
                "index-multi.html".to_string(),
                "<html><body><script type=\"module\" src=\"./player.mjs\"></script></body></html>".to_string(),
            ),
            (
                "player.mjs".to_string(),
                "import { b } from \"./engine/b.mjs\";\n".to_string(),
            ),
            ("engine/b.mjs".to_string(), "export const b = 2;\n".to_string()),
        ]);
        let content = crate::build::kernel::content::ContentManifest {
            packed: Vec::new(),
            scene_texts: vec![("scenes/Main.json".to_string(), "{\"root\":1}".to_string())],
            text_assets: HashMap::new(),
            binaries: HashMap::new(),
            missing: Vec::new(),
            bin_converted: Vec::new(),
            assets_packed: 0,
        };
        let mut cfg = serde_json::Map::new();
        cfg.insert("playableAd".to_string(), serde_json::Value::Bool(true));

        let artifact = PlayablePipeline
            .build_form("multi", &base_files, &HashMap::new(), &content, &cfg, true)
            .expect("多文件组装失败");

        // 多文件模板改键为正式入口；单页模板不泄漏
        let entry = artifact.files.get("index.html").expect("入口页在场");
        assert!(entry.contains("./player.mjs"), "多文件入口保留 player 脚本标签");
        assert!(!artifact.files.contains_key("index-multi.html"));
        assert!(!entry.contains("single-entry"));
        // 形态附带货：config.json（含激活键）/ 零依赖服务器 / 说明
        let cfg_text = artifact.files.get("config.json").expect("config 落盘");
        assert!(cfg_text.contains("\"playableAd\":true"));
        assert!(artifact.files.contains_key("server.mjs"));
        assert!(artifact.files.contains_key("README.txt"));
        // 运行时代码与场景按文件落盘
        assert!(artifact.files.contains_key("player.mjs"));
        assert!(artifact.files.contains_key("engine/b.mjs"));
        assert_eq!(artifact.files.get("scenes/Main.json").map(String::as_str), Some("{\"root\":1}"));
        assert_eq!(artifact.html_bytes, 0, "多文件形态不报单页字节数");
    }

    /// 单文件形态：多文件模板键不参与组装（被剔除），入口只有 index.html
    #[test]
    fn single_form_drops_multi_entry() {
        let base_files = HashMap::from([
            (
                "index.html".to_string(),
                "<html><body>{{BUILD_DATA}}</body></html>".to_string(),
            ),
            ("index-multi.html".to_string(), "<html>multi</html>".to_string()),
            ("player.mjs".to_string(), "console.log(1);\n".to_string()),
        ]);
        let content = crate::build::kernel::content::ContentManifest {
            packed: Vec::new(),
            scene_texts: Vec::new(),
            text_assets: HashMap::new(),
            binaries: HashMap::new(),
            missing: Vec::new(),
            bin_converted: Vec::new(),
            assets_packed: 0,
        };
        let cfg = serde_json::Map::new();
        let artifact = PlayablePipeline
            .build_form("single", &base_files, &HashMap::new(), &content, &cfg, false)
            .expect("单页组装失败");
        let html = artifact.files.get("index.html").expect("入口在场");
        assert!(html.contains("__TVE_BUILD_DATA"), "单页内联数据脚本");
        assert!(!html.contains("multi"), "多文件模板不泄漏进单页产物");
        assert!(artifact.html_bytes > 0);
    }
}
