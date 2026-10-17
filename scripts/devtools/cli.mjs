// devtools CLI：外部 Agent 连接 TvE 开发者服务的统一命令行入口。
//
//   pnpm devtools info [--port N] [--json]
//   pnpm devtools tools [--json]
//   pnpm devtools recent [--json]
//   pnpm devtools clean [--json]
//   pnpm devtools call <method> [json|@file|-] [--project P] [--no-auto-open]
//                                [--timeout ms] [--json]
//
// 退出码：0 成功 / 1 用法错误 / 2 连接失败 / 3 命令失败 / 4 无编辑器且自动打开失败。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openClient, callWithEnsure, cleanStaleDiscovery } from "./client.mjs";

const USAGE = `用法：
  pnpm devtools info    [--port N] [--json]        连接自描述（端口/进程/活跃编辑器/项目）
  pnpm devtools catalog [--json]                   TCP 命令集（名称/路由 local|editor/权限）
  pnpm devtools tools   [--json]                   工具权限清单
  pnpm devtools recent  [--json]                   最近项目
  pnpm devtools clean   [--json]                   清理进程已退出的残留发现文件
  pnpm devtools call <method> [json|@file|-] [选项] 调用一个方法
选项：--project <dir>  --no-auto-open  --timeout <ms>  --json`;

/** 解析 --key value / --flag；位置参数收进 positional */
export function parseArgs(argv) {
  const opts = { positional: [], json: false, autoOpen: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--no-auto-open") opts.autoOpen = false;
    else if (a === "--project") opts.project = argv[++i];
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`未知选项：${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

/** 载荷：缺省 {}；@file 读文件；- 读 stdin；其余按 JSON 解析 */
export function parsePayload(arg, readStdin) {
  if (arg === undefined) return {};
  if (arg === "-") {
    const text = readStdin().trim();
    return text ? JSON.parse(text) : {};
  }
  if (arg.startsWith("@")) return JSON.parse(readFileSync(arg.slice(1), "utf8"));
  return arg.trim() ? JSON.parse(arg) : {};
}

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(result) {
  process.stderr.write(`${result.code || "ERROR"}: ${result.error}\n`);
  if (result.hint) process.stderr.write(`提示：${result.hint}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = opts.positional;
  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // 清理残留发现文件不需要连接应用
  if (cmd === "clean") {
    const result = cleanStaleDiscovery({});
    if (opts.json) print(result);
    else {
      for (const r of result.removed) {
        process.stdout.write(
          `已清理残留: ${r.file}（pid ${r.pid ?? "?"}, appVersion ${r.appVersion ?? "?"}）\n`,
        );
      }
      for (const k of result.kept) {
        process.stdout.write(
          `保留: ${k.file}（pid ${k.pid ?? "?"}, appVersion ${k.appVersion ?? "?"}）\n`,
        );
      }
      if (!result.removed.length) process.stdout.write("没有可清理的残留发现文件。\n");
    }
    return 0;
  }

  let client;
  try {
    client = await openClient({
      port: opts.port,
      timeoutMs: opts.timeoutMs,
      log: (m) => process.stderr.write(`${m}\n`),
    });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    for (const a of e.attempts ?? []) process.stderr.write(`  - ${a}\n`);
    process.stderr.write("提示：确认 TvE Hub 已启动（开发者服务随应用自动开启）。\n");
    return 2;
  }

  try {
    if (cmd === "info") {
      if (opts.json) print(client.hello);
      else {
        const h = client.hello ?? {};
        process.stdout.write(
          `服务：${h.name} 协议 v${h.protocolVersion}（${h.transport}）\n` +
            `端口：${h.port}  进程：${h.pid}  版本：${h.appVersion}\n` +
            `编辑器：${h.activeEditor ?? "未打开"}\n` +
            `项目：${h.activeProject ?? "未打开"}\n`,
        );
      }
      return 0;
    }

    if (cmd === "catalog") {
      const r = await client.call("devtools.catalog");
      if (!r.ok) {
        fail(r);
        return 3;
      }
      if (opts.json) print(r.result);
      else {
        const mark = { local: "[L]", editor: "[E]" };
        for (const c of r.result?.commands ?? []) {
          process.stdout.write(`${mark[c.route] ?? "[?]"} ${c.name.padEnd(24)} ${c.enabled ? "" : "（工具未启用）"}\n`);
        }
        process.stdout.write("L=无需编辑器直接应答  E=需要编辑器（无会话时自动打开项目）\n");
      }
      return 0;
    }

    if (cmd === "tools") {
      const r = await client.call("devtools.tools");
      if (!r.ok) {
        fail(r);
        return 3;
      }
      if (opts.json) print(r.result);
      else {
        for (const t of r.result?.tools ?? []) {
          process.stdout.write(`${t.enabled ? "[x]" : "[ ]"} ${t.id.padEnd(14)} ${t.group} / ${t.name}\n`);
        }
      }
      return 0;
    }

    if (cmd === "recent") {
      const r = await client.call("project.list");
      if (!r.ok) {
        fail(r);
        return 3;
      }
      if (opts.json) print(r.result);
      else {
        for (const p of r.result?.recent ?? []) process.stdout.write(`${p.name}\t${p.path}\n`);
      }
      return 0;
    }

    if (cmd === "call") {
      const method = rest[0];
      if (!method) {
        process.stderr.write(`${USAGE}\n`);
        return 1;
      }
      let params;
      try {
        params = parsePayload(rest[1], () => readFileSync(0, "utf8"));
      } catch (e) {
        process.stderr.write(`参数 JSON 解析失败：${e.message}\n`);
        return 1;
      }
      const r = await callWithEnsure(client, method, params, {
        project: opts.project,
        autoOpen: opts.autoOpen,
        timeoutMs: opts.timeoutMs,
        log: (m) => process.stderr.write(`${m}\n`),
      });
      if (opts.json) print(r);
      else if (r.ok) print(r.result);
      else fail(r);
      if (r.ok) return 0;
      return r.code === "NO_ACTIVE_EDITOR" || r.code === "CONNECTION" ? 4 : 3;
    }

    process.stderr.write(`未知子命令：${cmd}\n${USAGE}\n`);
    return 1;
  } finally {
    client.close();
  }
}

// 仅直接执行时跑 main（供测试 import 纯函数）
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`${e.stack || e.message}\n`);
      process.exit(1);
    });
}
