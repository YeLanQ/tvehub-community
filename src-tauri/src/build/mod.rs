//! 构建导出（分层管线）：前端收集运行时文本 → Rust 按渠道装配产物管线 →
//! 写入 `<项目>/build/<渠道>/` → 返回自描述结果。
//!
//! 分层（自上而下，只允许上层引用下层）：
//! - [`command`]：Tauri 命令 build_export——注册任务管理器（取消/进度），收敛
//!   IPC 参数为 BuildJob 后交给 run_build（字段与前端 api.buildExport 一一
//!   对应，不改变 IPC 契约）；
//! - [`pipeline`]：渠道管线层——ChannelPipeline trait（id/resolve/preflight/
//!   build）+ channel_pipeline 工厂 + run_build 公共编排（渠道无关预检、主场景
//!   兜底、输出目录解析、统一进度锚点）；通用层零渠道字面量；
//! - [`channels`]：渠道实现（各自成目录，只经工厂桥接互不可见）——`web/`
//!   （WebPipeline，消费共享形态机组装产物）；`wechat/`（WechatPipeline +
//!   pack 包文件生成 + preflight 能力预检）；`playable/`（PlayablePipeline +
//!   目标注册表，按勾选广告渠道逐目标产出单页/多文件形态）；
//! - [`forms`]：产物形态组装机（渠道共享）——单页内联/多文件站点 × gzip 归档
//!   × 模块说明符重写 × 远程地址（web 与 playable 两渠道消费）；
//! - [`kernel`]：导出内容内核（渠道无关）——content（场景收集+合并+release
//!   主干）、classify（产物内文件分类）、refs/release（发布模式引用重写与
//!   uid 重命名）；跨渠道一致性由 tests/consistency_e2e.rs 守护；
//! - [`steps`]：共享产物步骤——config（产物 config.json 组装）；
//! - [`finalize`]：渠道公共收尾——项目配置读取/主场景解析/写盘/BuildResult
//!   组装的唯一出口（各渠道不再各写一份）；
//! - [`options`]：渠道选项分型——扁平 IPC 字段按渠道解析为强类型参数。
//!
//! 场景与资产由 Rust 直读磁盘（底座见 crate::scene_pack），资源二进制不以
//! base64 穿过 IPC。

mod channels;
mod command;
mod finalize;
mod forms;
mod job;
mod kernel;
mod options;
mod pipeline;
mod steps;

// 命令与数据从模块根再导出：lib.rs 的命令注册表保持 build::build_export 的读法
// （glob 带出 tauri 命令宏生成的隐藏符号，与 lanshare 同一做法）
pub use command::*;
pub use job::{BuildJob, BuildResult, JobCtx};
pub use pipeline::run_build;

#[cfg(test)]
mod tests;
