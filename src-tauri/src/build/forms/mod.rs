//! 产物形态组装层（渠道共享）：单页内联（[`single_page`]）/ 多文件站点
//! （[`multi_file`]）两种形态 × gzip 归档（[`archive`]）× 模块说明符重写
//! （[`specifiers`]）× 远程地址（[`urls`]）。
//!
//! 原属 web 渠道私有的「渠道专属阶段」；playable 渠道按目标形态复用同一套
//! 组装后提升为公共层——channels 互不可见契约（channels/mod.rs）由此维持：
//! 形态机在 channels 之外，渠道只编排。
//!
//! 可见性口径：两渠道都消费的入口（assemble_*、THREE_RUNTIME_FILES、
//! normalize_base_url）为 `pub(in crate::build)`；形态机内部协作项保持
//! `pub(super)`（仅 forms 子树可见）。

pub(in crate::build) mod archive;
pub(in crate::build) mod multi_file;
pub(in crate::build) mod single_page;
pub(in crate::build) mod specifiers;
pub(in crate::build) mod urls;

pub(in crate::build) use multi_file::assemble_multi_file;
pub(in crate::build) use single_page::assemble_single_page;
