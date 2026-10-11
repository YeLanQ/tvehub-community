//! playable 渠道端到端：多目标勾选导出、逐目标目录布局、config 激活键、
//! preflight 拦截（空目标 / 未知目标 / 未支持目标 / 缺入口模板）。

use std::collections::HashMap;
use std::fs;

use crate::build::{run_build, BuildJob, JobCtx};

/// 最小临时项目 + 双入口模板运行时（单页 index.html + 多文件 index-multi.html）
struct Fixture {
    root: std::path::PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let base = std::env::temp_dir().join(format!("tve-playable-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("proj");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(
            root.join("project.config.json"),
            r#"{"designResolution":{"width":1280,"height":720}}"#,
        )
        .unwrap();
        fs::write(
            root.join("assets/Main.scene"),
            r#"{"type":"scene","root":{"type":"node","childIds":[],"children":[]}}"#,
        )
        .unwrap();
        Self { root }
    }

    /// 运行时文件：单页模板（{{BUILD_DATA}} 占位 + player 脚本标签）+ 多文件模板
    /// （player 脚本标签；Rust 取它写为目标目录的 index.html）+ 运行时代码
    fn runtime_files(&self) -> HashMap<String, String> {
        HashMap::from([
            (
                "index.html".to_string(),
                "<html><title>t</title><body>{{BUILD_DATA}}<script type=\"module\" src=\"./player.mjs\"></script></body></html>".to_string(),
            ),
            (
                "index-multi.html".to_string(),
                "<html><title>t</title><body><script type=\"module\" src=\"./player.mjs\"></script></body></html>".to_string(),
            ),
            (
                "player.mjs".to_string(),
                "import { b } from \"./engine/b.mjs\";\nconsole.log(b);\n".to_string(),
            ),
            ("engine/b.mjs".to_string(), "export const b = 2;\n".to_string()),
        ])
    }

    fn job(&self, targets: Vec<String>, files: HashMap<String, String>) -> BuildJob {
        self.job_gzip(targets, files, true)
    }

    fn job_gzip(
        &self,
        targets: Vec<String>,
        files: HashMap<String, String>,
        gzip: bool,
    ) -> BuildJob {
        BuildJob {
            root: self.root.display().to_string(),
            channel: "playable".into(),
            scenes: vec!["assets/Main.scene".into()],
            main_scene: "assets/Main.scene".into(),
            title: "T".into(),
            debug: false,
            single_page: false,
            gzip,
            release: false,
            cdn: false,
            gzip_base: String::new(),
            cdn_base: String::new(),
            files,
            out_dir: None,
            wechat_appid: None,
            wechat_orientation: None,
            wechat_subpackages: None,
            wechat_subpackage_size: None,
            wechat_diag: None,
            playable_targets: targets,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.root.parent().unwrap());
    }
}

/// 多目标（meta + google，均单页形态）→ 各自目录同构产物 + config 激活键 +
/// 逐目标结果清单；多文件模板不泄漏进单页产物。gzip 两形态都过（gzip 单页
/// 代码进 base64 归档、非 gzip 明文内联——与 web 渠道同规则）
#[test]
fn playable_multi_target_single_form_export() {
    let fx = Fixture::new("multi");
    for gzip in [false, true] {
        let result = run_build(
            fx.job_gzip(vec!["meta".into(), "google".into()], fx.runtime_files(), gzip),
            &JobCtx::default(),
        )
        .unwrap_or_else(|e| panic!("gzip={gzip} 构建失败: {e}"));

        assert!(result.ok);
        assert_eq!(result.targets.len(), 2, "逐目标结果清单");
        assert_eq!(result.targets[0].id, "meta");
        assert_eq!(result.targets[0].form, "single");
        assert_eq!(result.targets[0].out_rel, "build/playable/meta");
        assert!(result.targets[0].html_bytes > 0, "单页产物有 HTML 字节数");
        assert_eq!(result.targets[1].id, "google");
        assert_eq!(result.gzip, gzip);

        for id in ["meta", "google"] {
            let dir = fx.root.join("build/playable").join(id);
            // 单页产物只有一个入口 HTML
            let written: Vec<String> = fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            assert_eq!(written, vec!["index.html".to_string()], "{id} 单页产物只有 index.html");
            let html = fs::read_to_string(dir.join("index.html")).unwrap();
            assert!(html.contains("__TVE_BUILD_DATA"), "{id} 单页内联数据");
            assert!(html.contains("\"playableAd\":true"), "{id} config 携带激活键");
            assert!(
                html.contains("\"playableTargets\":[\"meta\",\"google\"]"),
                "{id} config 携带目标清单（诊断用，运行时以探测为准）"
            );
            assert!(
                !html.contains("index-multi"),
                "{id} 多文件模板键不泄漏进单页产物"
            );
            if gzip {
                assert!(
                    !html.contains("export const b = 2"),
                    "{id} gzip 单页代码进归档而非明文"
                );
                assert!(html.contains("data.pak"), "{id} gzip 单页走归档引导分支");
            } else {
                assert!(html.contains("export const b = 2"), "{id} 非 gzip 运行时代码内联");
            }
        }
    }
}

/// preflight 拦截矩阵：空目标 / 未知目标 / 未支持目标 / 缺入口模板
#[test]
fn playable_preflight_rejections() {
    let fx = Fixture::new("preflight");

    let err = run_build(fx.job(vec![], fx.runtime_files()), &JobCtx::default())
        .unwrap_err();
    assert!(err.contains("至少勾选"), "空目标拦截: {err}");

    let err = run_build(fx.job(vec!["nope".into()], fx.runtime_files()), &JobCtx::default())
        .unwrap_err();
    assert!(err.contains("未知目标"), "未知目标拦截: {err}");

    let err = run_build(
        fx.job(vec!["ironsource".into()], fx.runtime_files()),
        &JobCtx::default(),
    )
    .unwrap_err();
    assert!(err.contains("尚未支持"), "占位目标拦截: {err}");

    // 缺单页入口模板（前端注入链断裂）
    let mut files = fx.runtime_files();
    files.remove("index.html");
    let err = run_build(fx.job(vec!["mraid".into()], files), &JobCtx::default()).unwrap_err();
    assert!(err.contains("index.html"), "缺单页入口拦截: {err}");
}

/// CDN 选项对 playable 渠道无效：即使 IPC 误传 cdn=true 也强制内嵌（试玩禁外链）
#[test]
fn playable_forces_no_cdn() {
    let fx = Fixture::new("cdn");
    let mut job = fx.job(vec!["mraid".into()], fx.runtime_files());
    job.cdn = true;
    job.cdn_base = "https://cdn.example.com/".into();
    let result = run_build(job, &JobCtx::default()).expect("构建失败");
    assert!(!result.cdn, "playable 渠道 CDN 恒关");
    let html =
        fs::read_to_string(fx.root.join("build/playable/mraid/index.html")).unwrap();
    assert!(html.contains("cdn.example.com") == false, "产物不得引用 CDN 地址");
}
