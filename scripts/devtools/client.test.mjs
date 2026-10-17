// 统一连接层的离线自测（不碰网络）：分帧/事件过滤/错误归一/端口发现顺序。
// 运行：pnpm devtools:selftest（node --test）

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  takeLines,
  classifyLine,
  normalizeResponse,
  discoverCandidates,
  cleanStaleDiscovery,
  DEFAULT_PORT,
} from "./client.mjs";
import { parseArgs, parsePayload } from "./cli.mjs";

test("takeLines 保留半行，跨块拼接不丢数据", () => {
  const a = takeLines("", '{"id":1,"result":1}\n{"id":2');
  assert.deepEqual(a.lines, ['{"id":1,"result":1}']);
  assert.equal(a.rest, '{"id":2');
  const b = takeLines(a.rest, ',"result":2}\n');
  assert.deepEqual(b.lines, ['{"id":2,"result":2}']);
  assert.equal(b.rest, "");
});

test("takeLines 过滤空行并保留空白内容", () => {
  const { lines, rest } = takeLines("", "\n\n  \n");
  assert.deepEqual(lines, []);
  assert.equal(rest, "");
});

test("classifyLine 区分推送事件与响应", () => {
  assert.deepEqual(classifyLine('{"event":"log","data":"x"}'), { kind: "event", event: "log", data: "x" });
  assert.equal(classifyLine('{"id":3,"result":null,"error":null}').kind, "response");
  assert.equal(classifyLine("not json").kind, "garbage");
  assert.equal(classifyLine('{"hello":1}').kind, "other");
});

test("normalizeResponse 使用服务端错误码并附提示", () => {
  const err = normalizeResponse(
    { id: 1, result: null, error: "没有活跃的编辑器窗口", code: "NO_ACTIVE_EDITOR" },
    "node.add",
  );
  assert.equal(err.ok, false);
  assert.equal(err.code, "NO_ACTIVE_EDITOR");
  assert.equal(err.method, "node.add");
  assert.ok(err.hint.includes("--project"));

  const ok = normalizeResponse({ id: 2, result: { id: "n1" }, error: null }, "node.add");
  assert.deepEqual(ok, { ok: true, result: { id: "n1" }, method: "node.add" });
});

test("旧服务端无 code 字段时按文本兜底", () => {
  const legacy = normalizeResponse({ id: 1, error: "没有活跃的编辑器窗口" }, "node.add");
  assert.equal(legacy.code, "NO_ACTIVE_EDITOR");
  assert.equal(normalizeResponse({ id: 1, error: "其它失败" }, "x").code, "ERROR");
});

test("discoverCandidates：显式 > env > 发现文件 > 默认，且去重", () => {
  const dir = mkdtempSync(join(tmpdir(), "tve-devtools-"));
  writeFileSync(join(dir, "devtools.json"), JSON.stringify({ port: 41234 }));
  const candidates = discoverCandidates({
    port: 40000,
    env: { TVE_CONFIG_ROOT: dir, TVE_DEVTOOLS_PORT: "39100" },
    plat: "win32",
    home: dir,
    cwd: dir,
  });
  assert.deepEqual(
    candidates.map((c) => c.port),
    [40000, 39100, 41234],
  );
  assert.equal(candidates[0].source, "explicit");
  assert.equal(candidates[1].source, "env:TVE_DEVTOOLS_PORT");
  assert.ok(candidates[2].source.startsWith("discovery:"));
});

test("发现文件损坏时跳过，不抛异常", () => {
  const dir = mkdtempSync(join(tmpdir(), "tve-devtools-"));
  writeFileSync(join(dir, "devtools.json"), "{ half");
  const candidates = discoverCandidates({
    env: { TVE_CONFIG_ROOT: dir },
    plat: "linux",
    home: dir,
    cwd: dir,
  });
  assert.deepEqual(candidates.map((c) => c.port), [DEFAULT_PORT]);
});

test("进程已退出的残留发现文件不采用，clean 可清理", () => {
  const dir = mkdtempSync(join(tmpdir(), "tve-devtools-"));
  const file = join(dir, "devtools.json");
  writeFileSync(file, JSON.stringify({ port: 41235, pid: 999999, appVersion: "1.0.5" }));
  const candidates = discoverCandidates({
    env: { TVE_CONFIG_ROOT: dir },
    plat: "linux",
    home: dir,
    cwd: dir,
  });
  assert.ok(!candidates.some((c) => c.port === 41235), "死进程的端口不应进入候选");
  const cleaned = cleanStaleDiscovery({
    env: { TVE_CONFIG_ROOT: dir },
    plat: "linux",
    home: dir,
    cwd: dir,
  });
  assert.equal(cleaned.removed.length, 1);
  assert.equal(existsSync(file), false);
});

test("存活进程的发现文件保留", () => {
  const dir = mkdtempSync(join(tmpdir(), "tve-devtools-"));
  writeFileSync(
    join(dir, "devtools.json"),
    JSON.stringify({ port: 41236, pid: process.pid }),
  );
  const cleaned = cleanStaleDiscovery({
    env: { TVE_CONFIG_ROOT: dir },
    plat: "linux",
    home: dir,
    cwd: dir,
  });
  assert.equal(cleaned.removed.length, 0);
  assert.equal(cleaned.kept.length, 1);
});

test("parseArgs 支持位置参数与开关", () => {
  const o = parseArgs(["call", "node.add", "{}", "--project", "C:/p", "--no-auto-open", "--timeout", "5000"]);
  assert.deepEqual(o.positional, ["call", "node.add", "{}"]);
  assert.equal(o.project, "C:/p");
  assert.equal(o.autoOpen, false);
  assert.equal(o.timeoutMs, 5000);
});

test("parsePayload 支持 JSON 与 stdin", () => {
  assert.deepEqual(parsePayload(undefined, () => ""), {});
  assert.deepEqual(parsePayload('{"a":1}', () => ""), { a: 1 });
  assert.deepEqual(parsePayload("-", () => '{"b":2}'), { b: 2 });
  assert.deepEqual(parsePayload("-", () => ""), {});
});
