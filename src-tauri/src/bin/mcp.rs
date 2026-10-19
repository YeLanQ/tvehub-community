//! 开发者服务 MCP 协议桥（stdio 传输）——独立可执行入口。
//!
//! Windows 发行包以 `mcp.exe` 随主程序分发；Linux/macOS 不再需要伴生文件，
//! 由主程序的 `--mcp-bridge` 子命令提供同一能力（见 lib 的 mcp_bridge 模块）。
//! 客户端配置：{ "command": "<path>/mcp.exe", "args": ["--port", "30000"] }

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port = tve_hub_lib::mcp_bridge::port_from_args(&args);
    tve_hub_lib::mcp_bridge::run(port);
}
