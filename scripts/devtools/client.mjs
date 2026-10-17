// 统一 TCP 连接层：外部 Agent 连接 devtools 开发者服务的唯一入口。
//
// 解决三类历史问题：
//   1. 端口不可知（固定端口被占用后回退随机）→ 发现文件 + 候选端口逐个校验；
//   2. 响应流混入广播事件行（{"event":...}）→ 按 id 配对，事件单独分发；
//   3. 转发类命令在无编辑器时统一失败 → NO_ACTIVE_EDITOR 时自动开窗并重试一次。
//
// 协议：127.0.0.1:<port> 上换行分隔 JSON；请求 {id,method,params}，
// 响应 {id,result,error[,code]}，推送 {event,data}。

import { connect as netConnect } from "node:net";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_PORT = 39100;
export const PROTOCOL_VERSION = 1;
export const CLIENT_NAME = "tve-devtools-client";

/** 错误码 → 可操作提示（错误码由服务端给出，客户端不解析中文散文） */
const HINTS = {
  NO_ACTIVE_EDITOR: "没有活跃的编辑器窗口：给 --project 打开项目（客户端会自动开窗重试）",
  EDITOR_TIMEOUT: "编辑器执行超时（60s）：命令可能仍在执行，先查状态再重试",
  UNKNOWN_METHOD: "未知方法：用 `pnpm devtools tools` 查可用方法",
  TOOL_DISABLED: "工具权限未开启：在首页「开发者服务 → 工具权限」中启用",
  BAD_PARAMS: "参数不合法：检查必填字段与类型",
  CONNECTION: "无法连接开发者服务：确认应用已启动（服务随应用自动开启）",
};

export function hintFor(code) {
  return HINTS[code] ?? "";
}

/** 发现文件候选（配置根 / 平台默认 / 便携 data/） */
export function discoveryFiles({
  env = process.env,
  home = homedir(),
  plat = platform(),
  cwd = process.cwd(),
} = {}) {
  const files = [];
  if (env.TVE_CONFIG_ROOT) files.push(join(env.TVE_CONFIG_ROOT, "devtools.json"));
  if (plat === "win32") {
    files.push(join(env.APPDATA || join(home, "AppData", "Roaming"), "TvE.Hub", "devtools.json"));
  } else if (plat === "darwin") {
    files.push(join(home, "Library", "Application Support", "TvE.Hub", "devtools.json"));
  } else {
    files.push(join(env.XDG_CONFIG_HOME || join(home, ".config"), "TvE.Hub", "devtools.json"));
  }
  files.push(join(cwd, "data", "devtools.json"));
  return files;
}

/** 进程是否存活（pid 缺失/非法按存活处理，兼容旧格式发现文件） */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM：进程存在但无权限探测
    return e?.code === "EPERM";
  }
}

/** 端口候选顺序：显式 → 环境变量 → 发现文件 → 默认端口（去重） */
export function discoverCandidates({
  port,
  env = process.env,
  home = homedir(),
  plat = platform(),
  cwd = process.cwd(),
  log,
} = {}) {
  const out = [];
  const add = (p, source) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n <= 65535 && !out.some((c) => c.port === n)) {
      out.push({ port: n, source });
    }
  };
  if (port) add(port, "explicit");
  if (env.TVE_DEVTOOLS_PORT) add(env.TVE_DEVTOOLS_PORT, "env:TVE_DEVTOOLS_PORT");
  if (env.TVE_DEVTOOLS_URL) {
    const m = /:(\d+)\/?$/.exec(env.TVE_DEVTOOLS_URL.trim());
    if (m) add(m[1], "env:TVE_DEVTOOLS_URL");
  }
  for (const file of discoveryFiles({ env, home, plat, cwd })) {
    try {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      // 进程已退出的残留文件跳过：跨版本/便携目录残留时不会误导到错误端口
      if (doc.pid !== undefined && !pidAlive(Number(doc.pid))) {
        log?.(`跳过残留发现文件（进程 ${doc.pid} 已退出，appVersion ${doc.appVersion ?? "?"}）: ${file}`);
        continue;
      }
      add(doc.port, `discovery:${file}`);
    } catch {
      // 不存在或半截：跳过
    }
  }
  add(DEFAULT_PORT, "default");
  return out;
}

/** 清理进程已退出的残留发现文件（不触碰存活实例；无 pid 的旧格式保留） */
export function cleanStaleDiscovery({
  env = process.env,
  home = homedir(),
  plat = platform(),
  cwd = process.cwd(),
} = {}) {
  const removed = [];
  const kept = [];
  for (const file of discoveryFiles({ env, home, plat, cwd })) {
    try {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const dead = doc.pid !== undefined && !pidAlive(Number(doc.pid));
      if (dead) {
        unlinkSync(file);
        removed.push({ file, pid: doc.pid ?? null, appVersion: doc.appVersion ?? null });
      } else {
        kept.push({ file, pid: doc.pid ?? null, appVersion: doc.appVersion ?? null });
      }
    } catch {
      // 不存在/损坏：无残留可清
    }
  }
  return { removed, kept };
}

/** 追加一块数据，返回完整行与剩余半行（半行必须保留，否则大 payload 丢行） */
export function takeLines(buffer, chunk) {
  const text = buffer + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.map((l) => l.trim()).filter(Boolean);
  return { lines, rest };
}

/** 一行分类：推送事件 / 响应 / 无法解析 */
export function classifyLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: "garbage" };
  }
  if (msg && msg.event !== undefined && msg.id === undefined) {
    return { kind: "event", event: msg.event, data: msg.data };
  }
  if (msg && msg.id !== undefined) return { kind: "response", msg };
  return { kind: "other", msg };
}

/** 旧版服务端不带 code：按文本兜底，保证升级前的应用也能被统一客户端驱动 */
export function legacyCodeFor(message) {
  if (message.includes("没有活跃的编辑器窗口") || message.includes("没有工作区项目")) {
    return "NO_ACTIVE_EDITOR";
  }
  if (message.includes("编辑器执行超时")) return "EDITOR_TIMEOUT";
  if (message.startsWith("未知方法")) return "UNKNOWN_METHOD";
  if (message.startsWith("工具「") && message.includes("未启用")) return "TOOL_DISABLED";
  if (message.startsWith("缺少")) return "BAD_PARAMS";
  if (message.includes("无法连接")) return "CONNECTION";
  return "ERROR";
}

/** 响应归一：{ok,result} 或 {ok:false,code,error,hint} */
export function normalizeResponse(msg, method) {
  if (msg.error) {
    const error = String(msg.error);
    const code = msg.code || legacyCodeFor(error);
    return { ok: false, code, error, hint: hintFor(code), method };
  }
  return { ok: true, result: msg.result ?? null, method };
}

/** 一个持久的 JSON-lines 连接：自增 id、按 id 配对、丢弃事件行 */
export class Client {
  constructor(socket, port, { timeoutMs = 120000, onEvent } = {}) {
    this.socket = socket;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.pending = new Map();
    this.nextId = 0;
    this.buf = "";
    this.decoder = new StringDecoder("utf8");
    this.closed = false;
    this.hello = null;
    this.source = "";
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("close", () => this.#failAll("连接已关闭"));
    socket.on("error", () => this.#failAll("连接出错"));
  }

  static connect(port, opts = {}) {
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host: "127.0.0.1", port });
      const onError = (e) => reject(e);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.removeListener("error", onError);
        resolve(new Client(socket, port, opts));
      });
    });
  }

  #onData(chunk) {
    // StringDecoder 处理多字节字符跨 TCP 分片：直接 chunk.toString 会切坏中文
    const { lines, rest } = takeLines(this.buf, this.decoder.write(chunk));
    this.buf = rest;
    for (const line of lines) {
      const c = classifyLine(line);
      if (c.kind === "event") {
        this.onEvent?.(c.event, c.data);
        continue;
      }
      if (c.kind !== "response") continue;
      const p = this.pending.get(c.msg.id);
      if (!p) continue;
      this.pending.delete(c.msg.id);
      clearTimeout(p.timer);
      p.resolve(normalizeResponse(c.msg, p.method));
    }
  }

  #failAll(error) {
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, code: "CONNECTION", error, hint: hintFor("CONNECTION"), method: p.method });
      this.pending.delete(id);
    }
  }

  call(method, params = {}, opts = {}) {
    if (this.closed) {
      return Promise.resolve({
        ok: false, code: "CONNECTION", error: "连接已关闭", hint: hintFor("CONNECTION"), method,
      });
    }
    const id = ++this.nextId;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false, code: "TIMEOUT",
          error: `等待 ${method} 响应超时（${timeoutMs}ms）`,
          hint: "命令可能仍在执行；先查状态再重试", method,
        });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, method });
      this.socket.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`);
    });
  }

  close() {
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }
}

/** 建立已校验的连接：候选端口逐个试，连上后用 devtools.hello 认身份 */
export async function openClient(opts = {}) {
  const { timeoutMs = 120000, onEvent, log } = opts;
  const candidates = opts.candidates ?? discoverCandidates(opts);
  const attempts = [];
  for (const c of candidates) {
    let client;
    try {
      client = await Client.connect(c.port, { timeoutMs, onEvent });
      const hello = await client.call("devtools.hello", {}, { timeoutMs: 10000 });
      let info = hello.ok ? hello.result : null;
      if (!info) {
        // 旧版服务端没有 devtools.hello：用 editor.health 认身份（能力降级）
        const health = await client.call("editor.health", {}, { timeoutMs: 10000 });
        if (health.ok && health.result?.protocol) {
          info = {
            name: "tve-devtools",
            protocolVersion: 0,
            transport: "tcp-jsonlines",
            legacy: true,
            activeEditor: null,
            ...health.result,
          };
        }
      }
      if (info?.name === "tve-devtools") {
        client.hello = info;
        client.source = c.source;
        if (onEvent && !info.legacy) {
          // 事件默认不推：显式订阅后才接收（旧版服务端本来就广播，无需订阅）
          const sub = await client.call("devtools.subscribe", { events: true }, { timeoutMs: 10000 });
          if (!sub.ok) log?.(`事件订阅失败：${sub.error}`);
        }
        log?.(`已连接 ${c.source} → 127.0.0.1:${c.port}${info.legacy ? "（旧版服务端，能力降级）" : ""}`);
        return client;
      }
      client.close();
      attempts.push(`${c.port} (${c.source}) 不是 TvE 开发者服务`);
    } catch (e) {
      client?.close();
      attempts.push(`${c.port} (${c.source}) ${e.code || e.message}`);
    }
  }
  const err = new Error(
    `无法连接 TvE 开发者服务（已尝试端口 ${candidates.map((c) => c.port).join(", ")}）`,
  );
  err.code = "CONNECTION";
  err.attempts = attempts;
  throw err;
}

/** 自动开窗时可用的项目：显式 --project → params.root → 最近项目 */
export async function resolveProject(client, params = {}, opts = {}) {
  if (opts.project) return opts.project;
  const root = params?.root;
  if (typeof root === "string" && root.trim()) return root.trim();
  const recent = await client.call("project.list", {}, { timeoutMs: 10000 });
  const list = recent.ok ? recent.result?.recent ?? [] : [];
  return list.length ? list[0].path : null;
}

/** "关闭/停止"类方法：没有可操作对象，不为它们自动开窗 */
const NO_AUTO_OPEN = new Set(["project.close", "preview.close", "preview.stop"]);

/**
 * 统一调用入口：直接执行；命中 NO_ACTIVE_EDITOR 时自动打开项目并重试一次。
 * autoOpen=false 时保持原错误（由调用方决定是否开窗）。
 */
export async function callWithEnsure(client, method, params = {}, opts = {}) {
  const first = await client.call(method, params, opts);
  if (
    first.ok ||
    first.code !== "NO_ACTIVE_EDITOR" ||
    opts.autoOpen === false ||
    NO_AUTO_OPEN.has(method)
  ) {
    return first;
  }
  const project = await resolveProject(client, params, opts);
  if (!project) {
    return {
      ok: false, code: "NO_ACTIVE_EDITOR", method,
      error: "没有活跃的编辑器窗口，且找不到可打开的项目",
      hint: "用 --project 指定项目目录，或先在应用里打开项目",
    };
  }
  opts.log?.(`没有活跃编辑器，自动打开：${project}`);
  const opened = await client.call("project.open", { path: project }, {
    timeoutMs: opts.openTimeoutMs ?? 60000,
  });
  if (!opened.ok) {
    return {
      ok: false, code: opened.code || "ERROR", method,
      error: `自动打开项目失败：${opened.error}`, hint: "检查项目路径是否存在",
    };
  }
  const hello = await client.call("devtools.hello", {}, { timeoutMs: 10000 });
  if (hello.ok) client.hello = hello.result;
  return client.call(method, params, opts);
}
