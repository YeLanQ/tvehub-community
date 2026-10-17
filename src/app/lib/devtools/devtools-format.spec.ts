import { describe, expect, it } from "vitest";
import {
  DEVTOOLS_DEFAULT_PORT,
  type DevToolsInfo,
} from "./state";
import {
  devtoolsHandoffText,
  discoveryFilePath,
  tcpEndpointOf,
} from "./devtools-format";

const info: DevToolsInfo = {
  port: 39101,
  url: "tcp://127.0.0.1:39101",
  mcp_url: "http://127.0.0.1:39101/mcp",
  stdio_command: "mcp.exe",
  token: "t",
  protocol: "tcp-jsonlines + mcp-http",
};

describe("tcpEndpointOf 端点回退", () => {
  it("服务已启用时用后端返回的端点", () => {
    expect(tcpEndpointOf(info, 39100)).toBe("tcp://127.0.0.1:39101");
  });

  it("服务未启用时按配置端口回退（0 = 默认端口）", () => {
    expect(tcpEndpointOf(null, 40000)).toBe("tcp://127.0.0.1:40000");
    expect(tcpEndpointOf(null, 0)).toBe(`tcp://127.0.0.1:${DEVTOOLS_DEFAULT_PORT}`);
  });
});

describe("discoveryFilePath 发现文件路径", () => {
  it("Windows 配置目录沿用反斜杠且容忍尾部分隔符", () => {
    expect(discoveryFilePath("C:\\Users\\me\\AppData\\Roaming\\TvE.Hub")).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\TvE.Hub\\devtools.json",
    );
    expect(discoveryFilePath("C:\\Users\\me\\AppData\\Roaming\\TvE.Hub\\")).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\TvE.Hub\\devtools.json",
    );
  });

  it("POSIX 配置目录沿用正斜杠", () => {
    expect(discoveryFilePath("/home/me/.config/TvE.Hub/")).toBe(
      "/home/me/.config/TvE.Hub/devtools.json",
    );
  });

  it("配置目录未知时返回空串（接入说明不写发现文件行）", () => {
    expect(discoveryFilePath("")).toBe("");
    expect(discoveryFilePath("   ")).toBe("");
  });
});

describe("devtoolsHandoffText 一键接入说明", () => {
  it("只讲 TCP 直连指令集，包含握手/自省/示例指令与发现文件", () => {
    const text = devtoolsHandoffText({
      tcp: "tcp://127.0.0.1:39100",
      discovery: "C:\\Users\\me\\AppData\\Roaming\\TvE.Hub\\devtools.json",
    });
    expect(text).toContain("TCP 直连指令集");
    expect(text).toContain("TCP：127.0.0.1:39100");
    expect(text).not.toContain("tcp://127.0.0.1:39100");
    expect(text).not.toContain("MCP");
    expect(text).not.toContain("/mcp");
    expect(text).toContain("devtools.json");
    expect(text).toContain('"method":"devtools.hello"');
    expect(text).toContain('"method":"devtools.catalog"');
    expect(text).toContain('"method":"editor.state"');
  });

  it("发现文件未知时省略该行", () => {
    const text = devtoolsHandoffText({
      tcp: "tcp://127.0.0.1:39100",
      discovery: "",
    });
    expect(text).not.toContain("发现文件");
    expect(text).toContain("TCP：127.0.0.1:39100");
  });
});
