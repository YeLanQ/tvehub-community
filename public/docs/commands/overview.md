# 指令集总览（本地控制面）

TvE Hub 在应用内部运行一个只绑定 `127.0.0.1` 的控制面：外部脚本、CI、自动化工具与 AI Agent 通过它驱动编辑器、项目与预览。它不是公网 API，没有 TLS，也没有账号体系——安全模型是「同机、同用户、由用户主动开启」。

首页 → **开发者服务** → 控制服务器可以启停服务、固定端口、查看工具权限与最近调用。

## 连接

| 项目 | 值 |
| --- | --- |
| 地址 | `127.0.0.1`（只监听本机回环） |
| 端口 | 默认 `39100`；被占用时自动回退随机端口 |
| 发现文件 | 配置根下 `devtools.json`（含实际端口、token、协议） |
| 协议 | TCP + 换行分隔 JSON（JSON Lines）；同端口另提供 MCP HTTP 端点 |
| 编码 | UTF-8，一行一条 JSON，以 `\n` 结束 |

发现文件位置随安装形态变化：

- Windows：`%APPDATA%\TvE.Hub\devtools.json`
- Linux：`~/.config/TvE.Hub/devtools.json`
- 便携版：exe 同级 `data/devtools.json`

端口被占用回退随机端口时，**以发现文件里的 port 为准**，不要写死 `39100`。

## 三种帧

**请求**

```json
{"id": 1, "method": "project.list", "params": {}}
```

**响应**

```json
{"id": 1, "result": {"recent": []}, "error": null}
{"id": 2, "result": null, "error": "没有活跃的编辑器窗口", "code": "NO_ACTIVE_EDITOR"}
```

- `id` 由客户端生成，用来匹配响应；同一连接可以同时在途多个请求，响应不保证按发送顺序返回。
- 成功时 `error` 为 `null`；失败时 `error` 为非空字符串，并带稳定 `code`（按 `code` 分支，不要解析中文文案）。

**推送**（需先订阅）

```json
{"event": "node.added", "data": {"kind": "add", "nodeId": "node_x", "revision": 12, "dirty": true}}
```

推送没有 `id`。默认不推；发送 `{"method":"devtools.subscribe","params":{"events":true}}` 后开始推送，`{"events":false}` 取消，断开连接自动清理。

## 最小客户端

```js
import net from "node:net";

const sock = net.createConnection({ host: "127.0.0.1", port: 39100 });
const pending = new Map();
let buf = "";

sock.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.event) {
      console.log("[event]", msg.event, msg.data);
      continue;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p(msg);
    }
  }
});

function call(method, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) {
        reject(Object.assign(new Error(msg.error), { code: msg.code }));
      } else {
        resolve(msg.result);
      }
    });
    sock.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
```

## 推荐接入顺序

1. `devtools.hello`：确认身份、端口、是否有活跃编辑器与当前项目；
2. `devtools.catalog {verbose:true}`：拿到方法表、参数 schema、权限与能力版本——**不要靠猜参数**；
3. 需要事件时 `devtools.subscribe {events:true}`；
4. 写命令发完直接读：写命令在落账后才返回，成功即可 `scene.tree` / `state.snapshot`，不会读到默认材质或半成品；
5. 能力探测只信 `capabilitiesRevision`；变更内容看 `capabilitiesNotes`。

## 方法如何执行

方法分两类：

- **本地（local）**：Rust 直接应答，不依赖编辑器窗口，例如项目列表、文件读写、协议自省；
- **编辑器（editor）**：需要活跃编辑器窗口的引擎/场景状态。没有编辑器时，多数方法会自动打开项目窗口；`project.close` / `preview.close` / `preview.stop` 属于例外（不会为了关闭而开窗）。

两条对客户端最重要的时序契约：

1. **写命令返回时写链已静默**：`node.add/remove/rename/set`、`node.component.*`、`scene.settings.patch`、`scene.save`、`history.*`、`state.restore`、`scene.write` 成功返回后，紧接读取一定看到结果。
2. **冷启动等场景就绪**：编辑器刚打开、项目还在装载时，命令会等到 `sceneReady`（上限 15 秒）；超时返回 `SCENE_NOT_READY`，稍后重试即可。

## 权限与安全

- **只在本机回环监听**，不要做端口转发或反向代理。
- `devtools.json` 里的 `token` **不是鉴权凭据**，不要当密码；它用于同机进程识别与诊断。
- 外部调用受**工具权限**约束（开发者服务页可逐项开关）。接入不完全可信的 Agent 时，建议关闭写入类工具：`assetWrite`、`nodeDelete`、`projectBuild` 等。
- 文本资产写入有格式锁与体积上限；`internal/` 内置资源只读，不能通过指令集绕过。
- 不需要时关闭控制服务器；自动化任务建议使用项目副本或独立工作区。

## 能力自描述

```json
{"method":"devtools.catalog","params":{"verbose":true}}
```

返回方法集、路由、权限、参数 schema，以及：

- `capabilitiesRevision`：方法集 + 参数 schema 的稳定哈希，应用热更新时 `appVersion` 不变，客户端据此判断能力是否变化；
- `capabilitiesNotes`：变更说明（最新在前）。

**本手册以当前方法集整理；运行时以 `devtools.catalog` 返回为准。**

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [项目与场景](project-scene.md) | 项目创建/打开/关闭/构建，场景列表/打开/保存/直写 |
| [节点、组件与状态](node-state.md) | 节点增删改、组件挂载、快照恢复、撤销重做、场景设置 |
| [资产、材质与预览](asset-preview.md) | 资产读写/新建/删除/刷新、材质读写、预览与截图 |
| [控制面、事件与错误](devtools-events.md) | 握手、工具权限、事件订阅、错误码、MCP 映射、文件索引 |
| [方法速查（50 条）](reference.md) | 全量方法表：路由、权限、参数、返回与备注 |
