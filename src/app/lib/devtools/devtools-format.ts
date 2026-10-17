// devtools 拆解 —— devtools-format：开发者服务/MCP 面板的纯数据构造。
// 分组展示、端点/配置 JSON 生成不依赖 Vue；HomeView 只做参数装配与复制动作。

import { type DevToolsInfo, DEVTOOLS_DEFAULT_PORT } from "./state";

export interface DevToolRow {
  id: string;
  name: string;
  enabled: boolean;
}

/** 工具权限按 group 分组展示（保序） */
export function groupDevToolsTools(tools: {
  group: string;
  id: string;
  name: string;
  enabled: boolean;
}[]): { group: string; tools: DevToolRow[] }[] {
  const groups: { group: string; tools: DevToolRow[] }[] = [];
  for (const t of tools) {
    let g = groups.find((x) => x.group === t.group);
    if (!g) {
      g = { group: t.group, tools: [] };
      groups.push(g);
    }
    g.tools.push({ id: t.id, name: t.name, enabled: t.enabled });
  }
  return groups;
}

/** TCP 端点（tcp://127.0.0.1:<port>；服务未启用时按当前端口回退） */
export function tcpEndpointOf(info: DevToolsInfo | null, port: number): string {
  return info?.url ?? `tcp://127.0.0.1:${port > 0 ? port : DEVTOOLS_DEFAULT_PORT}`;
}

/** MCP HTTP 端点（与应用 devtools 同一端口） */
export function mcpEndpointOf(info: DevToolsInfo | null, port: number): string {
  return info?.mcp_url ?? `http://127.0.0.1:${port > 0 ? port : DEVTOOLS_DEFAULT_PORT}/mcp`;
}

/** 端口发现文件路径（配置根目录 + devtools.json；根目录未知时返回空串） */
export function discoveryFilePath(configRoot: string): string {
  const root = configRoot.trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root}${sep}devtools.json`;
}

/**
 * 一键转发的接入说明：一段可直接粘贴给外部 Agent / 自动化的 TCP 连接卡片。
 * 只讲 TCP 直连指令集（不走 MCP）；端口变化时以发现文件为准，因此有路径就一并给出。
 */
export function devtoolsHandoffText(input: {
  tcp: string;
  discovery: string;
}): string {
  const address = input.tcp.replace(/^tcp:\/\//, "");
  const lines = [
    "连接 TvE Hub 开发者服务（本机正在运行，TCP 直连指令集）：",
    "",
    `TCP：${address}（换行分隔 JSON，一行一条请求，按 id 配对响应）`,
  ];
  if (input.discovery) {
    lines.push(
      `发现文件：${input.discovery}（端口被占用时会回退随机端口，以文件内 port 为准）`,
    );
  }
  lines.push(
    "",
    "先握手、再自省、然后直接发指令：",
    '{"id":1,"method":"devtools.hello","params":{}}',
    '{"id":2,"method":"devtools.catalog","params":{}}',
    '{"id":3,"method":"editor.state","params":{}}',
    '之后按 catalog 返回的方法与参数操作；route:"editor" 的方法在无编辑器时会自动打开项目。',
  );
  return lines.join("\n");
}

/** MCP stdio 桥程序路径（mcp.exe，与主程序同目录；未启用服务时回退裸文件名） */
export function mcpStdioCommandOf(info: DevToolsInfo | null): string {
  return info?.stdio_command ?? "mcp.exe";
}

/** MCP 服务配置 JSON（streamable-http：服务名 + 端点 URL，同一端口） */
export function mcpConfigJson(endpoint: string): string {
  return JSON.stringify({ mcpServers: { "tve-devtools": { url: endpoint } } }, null, 2);
}

/** MCP 服务配置 JSON（stdio：客户端拉起 mcp.exe 子进程，--port 转发到 devtools TCP） */
export function mcpStdioConfigJson(command: string, port: number): string {
  return JSON.stringify(
    {
      mcpServers: {
        "tve-devtools": {
          command,
          args: ["--port", String(port > 0 ? port : DEVTOOLS_DEFAULT_PORT)],
        },
      },
    },
    null,
    2,
  );
}
