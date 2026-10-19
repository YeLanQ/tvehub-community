//! 平台能力探测（单一事实源）：前端据此对不可用功能置灰并展示原因。
//! 判定只写在这里，前端不再各自按 navigator.platform 猜平台。
//!
//! 能力 id 是稳定英文串（前端类型里同名），reason 是给用户看的中文原因。

use serde::Serialize;
use std::collections::BTreeMap;

/// 单个能力：可用性 + 不可用原因（available=true 时 reason 恒为空）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Capability {
    fn yes() -> Self {
        Self { available: true, reason: None }
    }

    fn no(reason: &str) -> Self {
        Self { available: false, reason: Some(reason.to_string()) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    /// windows / linux / macos / android / ios / …
    pub os: String,
    pub arch: String,
    /// debug 构建与正式构建的能力不同（应用更新只在正式构建可用）
    pub build: String,
    pub features: BTreeMap<String, Capability>,
}

fn mcp_bridge_available() -> bool {
    // Windows 是独立 mcp.exe（与主程序同目录）；其他平台走主程序 `--mcp-bridge`。
    #[cfg(windows)]
    {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("mcp.exe")))
            .map(|p| p.exists())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// 当前平台的完整能力表
pub fn capabilities() -> PlatformCapabilities {
    let mut features = BTreeMap::new();

    // 系统回收站：Windows 走 Shell API，Linux 走 gio / XDG Trash
    features.insert(
        "trash".to_string(),
        if cfg!(any(windows, target_os = "linux")) {
            Capability::yes()
        } else {
            Capability::no("当前平台不支持系统回收站")
        },
    );

    // 应用内更新：发行资产与安装语义都是 Windows 便携包
    features.insert(
        "selfUpdate".to_string(),
        if cfg!(windows) {
            Capability::yes()
        } else {
            Capability::no("当前平台不支持应用内更新，请从发行页手动下载新版本")
        },
    );
    features.insert(
        "selfUpdateApply".to_string(),
        if !cfg!(windows) {
            Capability::no("当前平台不支持应用内更新，请从发行页手动下载新版本")
        } else if cfg!(debug_assertions) {
            Capability::no("开发构建不支持应用更新")
        } else {
            Capability::yes()
        },
    );

    // 多网卡枚举：目前只有 Windows 解析 ipconfig；其他平台只有默认路由地址
    features.insert(
        "lanMultiNic".to_string(),
        if cfg!(windows) {
            Capability::yes()
        } else {
            Capability::no("当前平台仅显示默认路由网卡地址")
        },
    );

    // MCP stdio 桥：Windows 依赖同目录 mcp.exe，运行时探测
    features.insert(
        "mcpBridge".to_string(),
        if mcp_bridge_available() {
            Capability::yes()
        } else {
            Capability::no("未找到 MCP stdio 桥程序，请检查安装是否完整")
        },
    );

    PlatformCapabilities {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        build: if cfg!(debug_assertions) { "debug" } else { "release" }.to_string(),
        features,
    }
}

/// 平台能力表（前端启动时拉取一次）
#[tauri::command]
pub fn platform_capabilities() -> PlatformCapabilities {
    capabilities()
}

#[cfg(test)]
mod tests {
    use super::capabilities;

    #[test]
    fn reports_all_known_features() {
        let caps = capabilities();
        for id in ["trash", "selfUpdate", "selfUpdateApply", "lanMultiNic", "mcpBridge"] {
            assert!(caps.features.contains_key(id), "缺能力项: {id}");
        }
        assert_eq!(caps.os, std::env::consts::OS);
        assert_eq!(caps.arch, std::env::consts::ARCH);
        assert_eq!(caps.build, if cfg!(debug_assertions) { "debug" } else { "release" });
    }

    #[test]
    fn unavailable_feature_carries_reason() {
        let caps = capabilities();
        for (id, cap) in &caps.features {
            if cap.available {
                assert!(cap.reason.is_none(), "{id} 可用时不应带原因");
            } else {
                assert!(cap.reason.as_deref().is_some_and(|r| !r.is_empty()), "{id} 不可用须给原因");
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_desktop_capabilities() {
        let caps = capabilities();
        assert!(caps.features["trash"].available);
        assert!(caps.features["selfUpdate"].available);
        assert!(caps.features["lanMultiNic"].available);
        assert_eq!(caps.features["selfUpdateApply"].available, !cfg!(debug_assertions));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_capabilities_disable_windows_only_features() {
        let caps = capabilities();
        assert!(caps.features["trash"].available, "Linux 回收站由 XDG 实现");
        assert!(!caps.features["selfUpdate"].available);
        assert!(!caps.features["selfUpdateApply"].available);
        assert!(!caps.features["lanMultiNic"].available);
        assert!(caps.features["mcpBridge"].available, "主程序内置 MCP 桥");
    }
}
