//! 试玩广告目标注册表（Rust 侧）：TS 镜像 src/app/lib/build/playable-targets.ts
//! ——两例试图一一对应，改一处必改另一处（TS spec 守护形状、本文件单测 +
//! playable_e2e 守护行为）。
//!
//! 形态语义（form）：
//!   single → 产物 <target>/index.html（全内联自包含，直接上传平台素材后台）
//!   multi  → 产物 <target>/（普通静态站点；不产 assets.gzip——我们的 gzip
//!            归档是 web 托管格式，广告平台要普通文件打包 zip）
//!   both   → 两者都产：<target>/single/ + <target>/multi/
//! 不可用目标（available=false）为注册占位：适配器随后续版本逐家落地
//!（需逐平台核对官方 spec 并真机验证），preflight 拒绝其进构建。

/// 目标产物形态
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(in crate::build) enum TargetForm {
    Single,
    Multi,
    /// P2 both 形态目标的机制占位（当前注册表暂无 both 目标；组装层已支持，
    /// e2e 以合成目标验证双形态）
    #[allow(dead_code)]
    Both,
}

impl TargetForm {
    /// 该形态需要组装的产物形态列表（both 展开；组装层按形态去重共享产物）
    pub(in crate::build) fn kinds(self) -> [Option<&'static str>; 2] {
        match self {
            Self::Single => [Some("single"), None],
            Self::Multi => [None, Some("multi")],
            Self::Both => [Some("single"), Some("multi")],
        }
    }
}

/// 注册表条目
pub(in crate::build) struct PlayableTarget {
    pub id: &'static str,
    pub form: TargetForm,
    /// 适配器是否已落地（false = 注册占位，preflight 拒绝）
    pub available: bool,
}

/// 目标清单（与 TS PLAYABLE_TARGETS 同序同 id）
pub(in crate::build) const PLAYABLE_TARGETS: &[PlayableTarget] = &[
    PlayableTarget { id: "meta", form: TargetForm::Single, available: true },
    PlayableTarget { id: "google", form: TargetForm::Single, available: true },
    PlayableTarget { id: "mraid", form: TargetForm::Single, available: true },
    // ironSource 并入 Unity Grow：官方当前 spec=单 HTML+MRAID 3.0（历史 DAPI
    // postMessage 无公开官方文档），契约与 mraid 同族
    PlayableTarget { id: "ironsource", form: TargetForm::Single, available: true },
    // 官方双 API：CTA=window.install、结束上报=window.gameEnd；zip 路线走多文件
    PlayableTarget { id: "mintegral", form: TargetForm::Multi, available: true },
    // 官方开发者 spec 在 Partner Center 登录墙内，核到再解锁（核不到不动笔）
    PlayableTarget { id: "pangle", form: TargetForm::Single, available: false },
];

/// 按 id 取目标
pub(in crate::build) fn target_by_id(id: &str) -> Option<&'static PlayableTarget> {
    PLAYABLE_TARGETS.iter().find(|t| t.id == id)
}

/// 目标某一形态的产物目录（相对构建输出根 build/playable/）：
/// both 目标分 single/ multi/ 子目录，单一形态目标直接占目标目录
pub(in crate::build) fn target_out_rel(id: &str, kind: &str) -> String {
    match target_by_id(id).map(|t| t.form) {
        Some(TargetForm::Both) => format!("{id}/{kind}"),
        _ => id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{target_by_id, target_out_rel, TargetForm};

    /// 注册表与 TS 镜像的对齐锚：id 集与可用性（TS 侧 playable-targets.spec.ts 同题）
    #[test]
    fn registry_shape() {
        let ids: Vec<&str> = super::PLAYABLE_TARGETS.iter().map(|t| t.id).collect();
        assert_eq!(ids, ["meta", "google", "mraid", "ironsource", "mintegral", "pangle"]);
        // P0 三大通用族 + P2 核实过官方 spec 的 ironsource/mintegral 可用
        for t in &super::PLAYABLE_TARGETS[..5] {
            assert!(t.available, "已核实目标必须可用: {}", t.id);
        }
        for t in &super::PLAYABLE_TARGETS[5..] {
            assert!(!t.available, "占位目标必须不可用: {}", t.id);
        }
        assert_eq!(target_by_id("meta").unwrap().form, TargetForm::Single);
        assert_eq!(target_by_id("ironsource").unwrap().form, TargetForm::Single);
        assert_eq!(target_by_id("mintegral").unwrap().form, TargetForm::Multi);
        assert!(target_by_id("nope").is_none());
    }

    /// both 目标分形态子目录（当前注册表无 both 目标，用 TargetForm 直接验证
    /// 映射规则与形态展开）；单一形态目标直接占目标目录
    #[test]
    fn out_rel_and_kinds() {
        assert_eq!(target_out_rel("meta", "single"), "meta");
        assert_eq!(target_out_rel("mintegral", "multi"), "mintegral");
        assert_eq!(TargetForm::Both.kinds(), [Some("single"), Some("multi")]);
        assert_eq!(TargetForm::Single.kinds(), [Some("single"), None]);
        assert_eq!(TargetForm::Multi.kinds(), [None, Some("multi")]);
    }
}
