//! 把文件/目录移入系统回收站（垃圾篓）。
//! - Windows：直接调用 shell32 的 `SHFileOperationW`（FO_DELETE + FOF_ALLOWUNDO），
//!   不依赖任何第三方 crate；
//! - Linux：优先 `gio trash`（正确处理挂载点回收站/重名/跨分区），失败回落到
//!   XDG Trash 规范（`$XDG_DATA_HOME/Trash/{files,info}`）；
//! - 其它平台：返回错误（前端按平台能力置灰入口）。

/// 把 `path` 移入系统回收站。成功返回 `Ok(())`。
pub fn move_to_trash(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_move_to_trash(path)
    }
    #[cfg(target_os = "linux")]
    {
        linux_move_to_trash(path)
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "linux")))]
    {
        let _ = path;
        Err("当前平台暂不支持移入回收站".to_string())
    }
}

#[cfg(target_os = "windows")]
fn windows_move_to_trash(path: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    // SHFILEOPSTRUCTW 常量（shell32）
    const FO_DELETE: u32 = 0x0003;
    /// 允许撤销 → 移入回收站（而非永久删除）
    const FOF_ALLOWUNDO: u16 = 0x0040;
    const FOF_NOCONFIRMATION: u16 = 0x0010;
    const FOF_SILENT: u16 = 0x0004;
    const FOF_NOERRORUI: u16 = 0x0400;

    #[repr(C)]
    struct SHFILEOPSTRUCTW {
        hwnd: *mut core::ffi::c_void,
        w_func: u32,
        p_from: *const u16,
        p_to: *const u16,
        f_flags: u16,
        f_any_operations_aborted: i32,
        h_name_mappings: *mut core::ffi::c_void,
        lpsz_progress_title: *const u16,
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHFileOperationW(lp_file_op: *mut SHFILEOPSTRUCTW) -> i32;
    }

    // pFrom 需要双 null 结尾的 UTF-16 字符串
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .chain(std::iter::once(0))
        .collect();

    let mut op = SHFILEOPSTRUCTW {
        hwnd: ptr::null_mut(),
        w_func: FO_DELETE,
        p_from: wide.as_ptr(),
        p_to: ptr::null(),
        f_flags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        f_any_operations_aborted: 0,
        h_name_mappings: ptr::null_mut(),
        lpsz_progress_title: ptr::null(),
    };

    // SAFETY: op 各字段有效；p_from 指向双 null 结尾的 UTF-16；SHFileOperationW 同步阻塞执行
    let code = unsafe { SHFileOperationW(&mut op) };
    if code == 0 && op.f_any_operations_aborted == 0 {
        Ok(())
    } else {
        Err(format!("移入回收站失败（SHFileOperationW 返回 {code}）"))
    }
}

// ---------------------------------------------------------------------------
// Linux：gio trash → XDG Trash 回落
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn linux_move_to_trash(path: &str) -> Result<(), String> {
    use std::path::Path;
    use std::process::Command;

    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    // 1) gio trash：桌面环境自带，按挂载点选择回收站（跨分区也正确）
    if let Ok(status) = Command::new("gio").arg("trash").arg("--").arg(p).status() {
        if status.success() {
            return Ok(());
        }
    }
    // 2) XDG Trash 规范（同分区；无 gio 的最小系统）
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            home.join(".local").join("share")
        });
    xdg_trash_into(&data_home, p)
}

/// 按 XDG Trash 规范把 `path` 移入 `data_home/Trash`（可注入 data_home 便于单测）。
#[cfg(target_os = "linux")]
fn xdg_trash_into(data_home: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    use std::io::ErrorKind;

    let files = data_home.join("Trash").join("files");
    let infos = data_home.join("Trash").join("info");
    std::fs::create_dir_all(&files).map_err(|e| format!("创建回收站目录失败: {e}"))?;
    std::fs::create_dir_all(&infos).map_err(|e| format!("创建回收站目录失败: {e}"))?;

    let name = std::fs::canonicalize(path)
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_os_string()))
        .or_else(|| path.file_name().map(|n| n.to_os_string()))
        .ok_or_else(|| format!("无法解析文件名: {}", path.display()))?;
    let unique = unique_trash_name(&files, &infos, &name);
    let dest = files.join(&unique);

    match std::fs::rename(path, &dest) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::CrossesDevices => {
            return Err("项目位于另一分区：XDG 回收站不支持跨分区移动，请用系统文件管理器删除"
                .to_string())
        }
        Err(e) => return Err(format!("移入回收站失败: {e}")),
    }

    let info = format!(
        "[Trash Info]\nPath={}\nDeletionDate={}\n",
        percent_encode_path(path),
        deletion_date_now()
    );
    let info_path = infos.join(format!("{unique}.trashinfo"));
    if let Err(e) = std::fs::write(&info_path, info) {
        // 信息文件写不进去就回滚，避免出现「回收站里没记录」的孤儿文件
        let _ = std::fs::rename(&dest, path);
        return Err(format!("写入回收站信息失败: {e}"));
    }
    Ok(())
}

/// 回收站内重名时追加 `.N`（files 与 info 都检查，避免覆盖已有记录）
#[cfg(target_os = "linux")]
fn unique_trash_name(
    files: &std::path::Path,
    infos: &std::path::Path,
    name: &std::ffi::OsStr,
) -> String {
    let base = name.to_string_lossy().to_string();
    let taken = |n: &str| files.join(n).exists() || infos.join(format!("{n}.trashinfo")).exists();
    if !taken(&base) {
        return base;
    }
    for i in 1..10_000 {
        let cand = format!("{base}.{i}");
        if !taken(&cand) {
            return cand;
        }
    }
    format!("{base}.{}", std::process::id())
}

/// XDG Trash Info 的 Path 字段：按 URL 规则百分号编码（保留 `/` 与 unreserved）
#[cfg(target_os = "linux")]
fn percent_encode_path(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len());
    for b in raw.as_bytes() {
        let c = *b;
        let unreserved =
            c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_' | b'~' | b'/');
        if unreserved {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{c:02X}"));
        }
    }
    out
}

/// Linux 回收站记录的删除时间（UTC，ISO 8601 `YYYY-MM-DDThh:mm:ss`）
#[cfg(target_os = "linux")]
fn deletion_date_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 天数（1970-01-01 起）→ 公历年月日（Howard Hinnant 算法，无外部依赖）
#[cfg(target_os = "linux")]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{percent_encode_path, xdg_trash_into};
    use std::path::PathBuf;

    fn temp_base(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("tve-trash-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn moves_file_into_xdg_trash_with_info() {
        let base = temp_base("move");
        let data = base.join("data");
        let src = base.join("proj");
        std::fs::create_dir_all(&src).unwrap();
        let file = src.join("demo.txt");
        std::fs::write(&file, "hi").unwrap();

        xdg_trash_into(&data, &file).unwrap();

        assert!(!file.exists(), "原文件应被移走");
        assert!(data.join("Trash/files/demo.txt").is_file());
        let info = std::fs::read_to_string(data.join("Trash/info/demo.txt.trashinfo")).unwrap();
        assert!(info.starts_with("[Trash Info]\nPath="));
        assert!(info.contains("DeletionDate="));
        assert!(info.contains(percent_encode_path(&file).as_str()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn name_collision_gets_suffix() {
        let base = temp_base("collide");
        let data = base.join("data");
        let a = base.join("a");
        let b = base.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("same.txt"), "1").unwrap();
        std::fs::write(b.join("same.txt"), "2").unwrap();

        xdg_trash_into(&data, &a.join("same.txt")).unwrap();
        xdg_trash_into(&data, &b.join("same.txt")).unwrap();

        assert!(data.join("Trash/files/same.txt").is_file());
        assert!(data.join("Trash/files/same.txt.1").is_file(), "重名追加 .1");
        assert!(data.join("Trash/info/same.txt.1.trashinfo").is_file());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn percent_encodes_space_and_non_ascii() {
        let p = std::path::Path::new("/home/me/My Proj/贴图.png");
        let encoded = percent_encode_path(p);
        assert!(encoded.starts_with("/home/me/My%20Proj/"));
        assert!(encoded.contains("%E8%B4%B4"));
        assert!(!encoded.contains(' '));
    }
}
