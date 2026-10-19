// 构建平台守卫：tauri build 必须在目标系统上原生构建（交叉编译不受支持），
// 在错误平台上运行会在链接 WebKitGTK 时才报错，这里提前给出可读提示。
const want = (process.argv[2] ?? "").trim();
const plat = process.platform;
const target = { linux: "linux", win32: "windows", darwin: "macos" }[plat] ?? plat;

if (want && target !== want) {
  console.error(`\n[build] 该命令只能在 ${want} 上运行（当前平台：${target}）。`);
  if (want === "linux") {
    console.error(
      "Linux 构建依赖（Ubuntu 22.04+）：\n" +
        "  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \\\n" +
        "    librsvg2-dev build-essential pkg-config curl wget file\n" +
        "然后在本机执行：pnpm install && pnpm build:linux\n",
    );
  }
  process.exit(1);
}
