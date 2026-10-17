// 外部副作用命令（资产写盘 / settings 信封）的执行逻辑，独立于图命令模块。
// 由 history.rs 的 SceneCmd 实现拆分而来；undo/redo_full 调用 apply_external。

use super::super::model::JsonMap;
use super::CmdKind;
use super::SceneCmd;
use serde_json::Value;
use std::path::Path;

impl SceneCmd {
    /// 是否为外部副作用命令（资产写盘 / settings 信封）
    pub fn is_external(&self) -> bool {
        matches!(
            self.kind,
            CmdKind::AssetWrite { .. } | CmdKind::Settings { .. }
        )
    }

    /// 应用外部副作用（forward=true 为 redo，false 为 undo）。
    /// 返回受影响的资产相对路径（供前端失效缓存/重读）。
    pub fn apply_external(
        &mut self,
        forward: bool,
        envelope: &mut JsonMap,
        root: Option<&Path>,
    ) -> Result<Vec<String>, String> {
        match &mut self.kind {
            CmdKind::AssetWrite { rel, before, after } => {
                let Some(root) = root else {
                    return Err("材质撤销需要项目根（当前会话未绑定项目）".into());
                };
                let content: &String = if forward { after } else { before };
                crate::scene::migrate::write_material_asset(root, rel, content)?;
                Ok(vec![rel.clone()])
            }
            CmdKind::Settings { before, after } => {
                let restored: Option<Value> = if forward {
                    Some(after.clone())
                } else {
                    before.clone()
                };
                match restored {
                    Some(v) => {
                        envelope.insert("settings".into(), v);
                    }
                    None => {
                        envelope.remove("settings");
                    }
                }
                Ok(Vec::new())
            }
            _ => Ok(Vec::new()),
        }
    }
}
