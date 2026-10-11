//! 渠道实现层：每个渠道一个目录，只经 pipeline 工厂桥接、互不可见——
//! 渠道之间不产生代码依赖（共享机制在 kernel/forms/steps/finalize 公共层，
//! 渠道只编排），内容一致性由 tests/consistency_e2e.rs 守护。

pub(super) mod playable;
pub(super) mod web;
pub(super) mod wechat;
