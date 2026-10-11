//! multi 形态产物的自动 zip 打包（Mintegral 等 zip 上传平台）：产物目录整体
//! 打包为 `<目标>.zip`，内层结构遵循 Luna 转述的官方命名约定「zip、内层目录、
//! 入口 html 三者同名」（mintegral.zip > mintegral/ > mintegral.html）——目录
//! 里的 index.html 在 zip 内改名 `<目标>.html`，其余文件原样带入（相对引用
//! 不受影响）。单页形态不打包（index.html 直接上传）。

use std::path::{Path, PathBuf};

use zip::ZipWriter;
use zip::write::SimpleFileOptions;

/// 把 `dir`（已落盘的 multi 产物目录）打包为 `out_base/<目标>.zip`；返回
/// 相对 out_base 的 zip 路径。文件按 zip 内路径排序写入（确定性输出）。
pub(in crate::build) fn write_target_zip(
    out_base: &Path,
    target_id: &str,
    dir: &Path,
) -> Result<String, String> {
    let zip_rel = format!("{target_id}.zip");
    let path = out_base.join(&zip_rel);
    let file = std::fs::File::create(&path).map_err(|e| format!("创建 {zip_rel} 失败: {e}"))?;
    let mut writer = ZipWriter::new(file);
    let opts =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    // 内层顶层目录 + 入口 html 改名（命名约定：三者同名 mintegral.zip > mintegral/ > mintegral.html）
    if let Err(e) = write_dir(
        &mut writer,
        opts,
        dir,
        &format!("{target_id}/"),
        &format!("{target_id}.html"),
    ) {
        return Err(format!("打包 {zip_rel} 失败: {e}"));
    }
    writer.finish().map_err(|e| format!("收尾 {zip_rel} 失败: {e}"))?;
    Ok(zip_rel)
}

/// 递归收集并写入一个目录：`zip_prefix` 是本目录在内层文件夹下的路径前缀
/// （顶层传 `<目标>/`）；目录内顶层的 index.html 改名 `<entry_html>`。
fn write_dir(
    writer: &mut ZipWriter<std::fs::File>,
    opts: SimpleFileOptions,
    dir: &Path,
    zip_prefix: &str,
    entry_html: &str,
) -> Result<(), String> {
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    collect(dir, zip_prefix, &mut dirs, &mut files)?;
    files.sort_by(|a, b| a.1.cmp(&b.1));
    for name in &dirs {
        writer
            .add_directory(name.clone(), opts)
            .map_err(|e| format!("写入目录项 {name}: {e}"))?;
    }
    for (disk_path, zip_name) in files {
        // 入口改名：仅路径末段恰好是 index.html 时（约定 html 与 zip 同名）
        let final_name = match zip_name.strip_suffix("/index.html") {
            Some(prefix) if prefix == target_dir_name(zip_prefix) => {
                format!("{prefix}/{entry_html}")
            }
            _ => zip_name,
        };
        let mut src =
            std::fs::File::open(&disk_path).map_err(|e| format!("读取 {final_name}: {e}"))?;
        writer
            .start_file(final_name.clone(), opts)
            .map_err(|e| format!("写入 {final_name}: {e}"))?;
        std::io::copy(&mut src, writer).map_err(|e| format!("压缩 {final_name}: {e}"))?;
    }
    Ok(())
}

/// zip 前缀的末段目录名（"mintegral/" → "mintegral"；无斜杠返回全串）
fn target_dir_name(zip_prefix: &str) -> &str {
    zip_prefix.strip_suffix('/').unwrap_or(zip_prefix)
}

/// 先序遍历目录：目录项与文件项分别收集（zip 内路径 = 前缀 + 相对路径）
fn collect(
    dir: &Path,
    zip_prefix: &str,
    dirs: &mut Vec<String>,
    files: &mut Vec<(PathBuf, String)>,
) -> Result<(), String> {
    let mut entries: Vec<std::fs::DirEntry> = dir
        .read_dir()
        .map_err(|e| format!("读取目录 {}: {e}", dir.display()))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("读取目录 {}: {e}", dir.display()))?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if path.is_dir() {
            dirs.push(format!("{zip_prefix}{name}/"));
            collect(&path, &format!("{zip_prefix}{name}/"), dirs, files)?;
        } else {
            files.push((path, format!("{zip_prefix}{name}")));
        }
    }
    Ok(())
}
