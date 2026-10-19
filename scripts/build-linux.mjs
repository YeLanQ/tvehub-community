// Linux 发布构建入口：固定两个兼容变量（strip / FUSE），并强制 --verbose。
// Tauri 默认只显示 "failed to run linuxdeploy"，linuxdeploy 的真实 stderr 被吞掉；
// 出问题时没有 --verbose 只能靠猜。这里把详细输出保留在构建日志里。
import { spawnSync } from "node:child_process";

const guard = spawnSync(process.execPath, ["scripts/check-platform.mjs", "linux"], {
  stdio: "inherit",
});
if (guard.status !== 0) process.exit(guard.status ?? 1);

// 预检 linuxdeploy 打包链的常用外部工具；缺失只告警，不阻断（便于先看到真实报错）
for (const [cmd, pkg] of [
  ["mksquashfs", "squashfs-tools"],
  ["patchelf", "patchelf"],
]) {
  if (spawnSync("which", [cmd], { stdio: "ignore" }).status !== 0) {
    console.warn(`[build] 未找到 ${cmd}：sudo apt install ${pkg}`);
  }
}

const result = spawnSync("pnpm", ["exec", "tauri", "build", "--verbose"], {
  stdio: "inherit",
  env: {
    ...process.env,
    // linuxdeploy 内置 strip 不认识新发行版的 .relr.dyn 等 section
    NO_STRIP: "true",
    // linuxdeploy 自身也是 AppImage：无 FUSE 时解包运行
    APPIMAGE_EXTRACT_AND_RUN: "1",
  },
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
