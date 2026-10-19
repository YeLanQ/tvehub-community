//! Linux 图形栈兼容开关与启动诊断。
//!
//! 必须在 WebKitGTK 创建 webview 之前调用（见 main.rs）；WebKitGTK 只在初始化时
//! 读取这些环境变量。原则：只补「用户未显式设置」的变量，用户/发行版设置优先。
//!
//! 已知根因（Tauri Linux Graphics Issues）：
//! - DMABUF 合成在部分驱动/会话（尤其 NVIDIA）下产生黑块、撕裂、闪边；
//! - NVIDIA 专有驱动 + Wayland 的 explicit sync 协议错误（Error 71）导致花屏；
//!   关闭 explicit sync 无性能代价，优先尝试。

#[cfg(target_os = "linux")]
use std::path::Path;

/// NVIDIA 专有驱动（nouveau 没有这个文件）
#[cfg(target_os = "linux")]
fn nvidia_driver() -> bool {
    Path::new("/proc/driver/nvidia/version").exists()
}

#[cfg(target_os = "linux")]
fn wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// 第一块 DRM 卡的厂商（0x10de NVIDIA / 0x8086 Intel / 0x1002 AMD）
#[cfg(target_os = "linux")]
fn gpu_vendor() -> String {
    for i in 0..4 {
        let path = format!("/sys/class/drm/card{i}/device/vendor");
        if let Ok(v) = std::fs::read_to_string(&path) {
            return match v.trim() {
                "0x10de" => "nvidia".to_string(),
                "0x8086" => "intel".to_string(),
                "0x1002" => "amd".to_string(),
                other => other.to_string(),
            };
        }
    }
    "unknown".to_string()
}

/// 应用兼容开关（仅 Linux；其它平台 no-op）
pub fn apply() {
    #[cfg(target_os = "linux")]
    {
        // NVIDIA + Wayland：explicit sync 协议错误是黑边/花屏的常见根因，
        // 关闭它没有性能代价（用户已设置时尊重）。
        if nvidia_driver()
            && wayland_session()
            && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
        {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
        // DMABUF 零拷贝合成在部分驱动/会话下出现黑块、撕裂与残帧；
        // 默认关闭（设 0 可恢复，用户显式设置时不覆盖）。
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

/// 启动诊断行（写入 debug.log，排查图形兼容问题时让用户直接回传）
pub fn diagnostics() -> String {
    #[cfg(target_os = "linux")]
    {
        format!(
            "session={} desktop={} gpu={} nvidia_driver={} dmabuf={} nv_explicit_sync={}",
            std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "unknown".to_string()),
            std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
            gpu_vendor(),
            nvidia_driver(),
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER")
                .unwrap_or_else(|_| "unset".to_string()),
            std::env::var("__NV_DISABLE_EXPLICIT_SYNC").unwrap_or_else(|_| "unset".to_string()),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        String::new()
    }
}
