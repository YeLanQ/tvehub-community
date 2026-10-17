// ---------------------------------------------------------------------------
// 撤销/重做（后端权威）：命令枚举 + 双栈。语义移植自前端 command/commands.ts
// 与 history/CommandStack.ts——Remove 批量捕获子树、undo 逆序重挂、
// Reparent 首次执行记录旧位、Transform/属性补丁按 before/after 快照。
// ---------------------------------------------------------------------------

use super::graph::{Graph, GraphChange};
use super::model::{JsonMap, NodeData, TransformData};
use serde_json::Value;
use std::path::Path;

mod external;

/// 批量重挂目标（多选拖拽一次撤销）
#[derive(Clone, Debug)]
pub struct MoveTarget {
    pub id: String,
    pub new_parent_id: Option<String>,
    pub new_index: i64,
}

/// 一次可撤销的场景命令（label 供历史面板展示）
#[derive(Clone, Debug)]
pub struct SceneCmd {
    pub label: String,
    pub kind: CmdKind,
}

#[derive(Clone, Debug)]
pub enum CmdKind {
    /// 新增节点（node.parent_id 已指向目标父节点）
    Add { node: NodeData },
    /// 新增嵌套子树（prefab 实例化；父节点以命令参数为准，undo = 摘除根子树）
    AddTree {
        root: NodeData,
        parent_id: Option<String>,
    },
    /// 批量删除（首次执行捕获子树；redo 重新摘除）
    RemoveNodes {
        ids: Vec<String>,
        captured: Vec<Vec<NodeData>>,
        done: bool,
    },
    /// 批量重挂（首次执行记录旧位置）
    ReparentNodes {
        moves: Vec<MoveTarget>,
        olds: Vec<(String, Option<String>, i64)>,
        done: bool,
    },
    Rename {
        id: String,
        old_name: String,
        new_name: String,
    },
    SetTransform {
        id: String,
        before: TransformData,
        after: TransformData,
    },
    /// 整节点属性补丁（before/after 为完整节点快照）
    PatchNode {
        id: String,
        before: NodeData,
        after: NodeData,
    },
    /// 批量整节点属性补丁（多选批量编辑一次撤销）
    PatchNodes {
        items: Vec<(String, NodeData, NodeData)>,
    },
    /// 引擎管理资产整文替换（.mat）：文件已由写入口落盘，undo/redo 由
    /// 场景命令执行器写回 before/after 文本（不参与图变更）。
    AssetWrite {
        rel: String,
        before: String,
        after: String,
    },
    /// 场景 settings 整体替换（信封字段；undo/redo 由执行器改信封）。
    Settings {
        before: Option<Value>,
        after: Value,
    },
}

impl SceneCmd {
    /// 执行（redo）并返回图变更序列
    pub fn execute(&mut self, graph: &mut Graph) -> Vec<GraphChange> {
        match &mut self.kind {
            CmdKind::Add { node } => graph
                .add_node(node.clone())
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::AddTree { root, parent_id } => graph
                .add_tree(root.clone(), parent_id.as_deref())
                .unwrap_or_default(),
            CmdKind::RemoveNodes { ids, captured, done } => {
                let mut changes = Vec::new();
                if !*done {
                    for id in ids.clone() {
                        // 跳过根节点与不存在的节点（多选兜底，与 TS 行为一致）
                        if graph.root_id.as_deref() == Some(id.as_str()) {
                            continue;
                        }
                        if let Some((sub, change)) = graph.remove_subtree(&id) {
                            captured.push(sub);
                            changes.push(change);
                        }
                    }
                    *done = true;
                } else {
                    for cap in captured.clone() {
                        if let Some(id) = cap.first().map(|n| n.id.clone()) {
                            if let Some((_, change)) = graph.remove_subtree(&id) {
                                changes.push(change);
                            }
                        }
                    }
                }
                changes
            }
            CmdKind::ReparentNodes { moves, olds, done } => {
                let mut changes = Vec::new();
                if !*done {
                    for m in moves.clone() {
                        let Some(node) = graph.get(&m.id).cloned() else {
                            continue;
                        };
                        let old_index = node
                            .parent_id
                            .as_ref()
                            .and_then(|pid| graph.get(pid))
                            .map(|p| p.child_ids.iter().position(|c| c == &m.id))
                            .flatten()
                            .map(|i| i as i64)
                            .unwrap_or(0);
                        olds.push((m.id.clone(), node.parent_id.clone(), old_index));
                        if let Some(c) =
                            graph.reparent(&m.id, m.new_parent_id.as_deref(), m.new_index)
                        {
                            changes.push(c);
                        }
                    }
                    *done = true;
                } else {
                    for m in moves.clone() {
                        if let Some(c) =
                            graph.reparent(&m.id, m.new_parent_id.as_deref(), m.new_index)
                        {
                            changes.push(c);
                        }
                    }
                }
                changes
            }
            CmdKind::Rename { id, new_name, .. } => graph
                .rename(id, new_name)
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::SetTransform { id, after, .. } => graph
                .set_transform(id, after)
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::PatchNode { id, after, .. } => graph
                .patch_node(id, after.clone())
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::PatchNodes { items } => {
                let mut changes = Vec::new();
                for (id, _, after) in items.iter() {
                    if let Some(c) = graph.patch_node(id, after.clone()) {
                        changes.push(c);
                    }
                }
                changes
            }
            // 外部副作用命令（资产/设置）由执行器写盘/改信封，不产生图变更
            CmdKind::AssetWrite { .. } | CmdKind::Settings { .. } => Vec::new(),
        }
    }

    /// 撤销并返回图变更序列
    pub fn undo(&mut self, graph: &mut Graph) -> Vec<GraphChange> {
        match &mut self.kind {
            CmdKind::Add { node } => graph
                .remove_subtree(&node.id)
                .map(|(_, c)| vec![c])
                .unwrap_or_default(),
            CmdKind::AddTree { root, .. } => graph
                .remove_subtree(&root.id)
                .map(|(_, c)| vec![c])
                .unwrap_or_default(),
            CmdKind::RemoveNodes { captured, .. } => {
                let mut changes = Vec::new();
                for cap in captured.clone() {
                    if let Some(c) = graph.reattach(&cap) {
                        changes.push(c);
                    }
                }
                changes
            }
            CmdKind::ReparentNodes { olds, .. } => {
                let mut changes = Vec::new();
                for (id, old_parent, old_index) in olds.clone() {
                    if let Some(c) = graph.reparent(&id, old_parent.as_deref(), old_index) {
                        changes.push(c);
                    }
                }
                changes
            }
            CmdKind::Rename { id, old_name, .. } => graph
                .rename(id, old_name)
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::SetTransform { id, before, .. } => graph
                .set_transform(id, before)
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::PatchNode { id, before, .. } => graph
                .patch_node(id, before.clone())
                .map(|c| vec![c])
                .unwrap_or_default(),
            CmdKind::PatchNodes { items } => {
                let mut changes = Vec::new();
                for (id, before, _) in items.iter() {
                    if let Some(c) = graph.patch_node(id, before.clone()) {
                        changes.push(c);
                    }
                }
                changes
            }
            CmdKind::AssetWrite { .. } | CmdKind::Settings { .. } => Vec::new(),
        }
    }
}

/// 双栈命令历史（execute 压 undo 栈并清空 redo 栈）
#[derive(Default)]
pub struct History {
    undo_stack: Vec<SceneCmd>,
    redo_stack: Vec<SceneCmd>,
}

impl History {
    pub fn push(&mut self, cmd: SceneCmd) {
        self.undo_stack.push(cmd);
        self.redo_stack.clear();
    }

    pub fn undo(&mut self, graph: &mut Graph) -> Option<(String, Vec<GraphChange>)> {
        let mut cmd = self.undo_stack.pop()?;
        let changes = cmd.undo(graph);
        let label = cmd.label.clone();
        self.redo_stack.push(cmd);
        Some((label, changes))
    }

    pub fn redo(&mut self, graph: &mut Graph) -> Option<(String, Vec<GraphChange>)> {
        let mut cmd = self.redo_stack.pop()?;
        let changes = cmd.execute(graph);
        let label = cmd.label.clone();
        self.undo_stack.push(cmd);
        Some((label, changes))
    }

    /// 撤销（含外部副作用）：外部命令改信封/写盘，图命令走 graph；
    /// 返回 (label, 图变更, 受影响资产, 还原后的 settings)。
    #[allow(clippy::type_complexity)]
    pub fn undo_full(
        &mut self,
        graph: &mut Graph,
        envelope: &mut JsonMap,
        root: Option<&Path>,
    ) -> Result<Option<(String, Vec<GraphChange>, Vec<String>, Option<Value>)>, String> {
        let Some(mut cmd) = self.undo_stack.pop() else {
            return Ok(None);
        };
        if cmd.is_external() {
            match cmd.apply_external(false, envelope, root) {
                Ok(assets) => {
                    let settings = if matches!(cmd.kind, CmdKind::Settings { .. }) {
                        envelope.get("settings").cloned()
                    } else {
                        None
                    };
                    let label = cmd.label.clone();
                    self.redo_stack.push(cmd);
                    Ok(Some((label, Vec::new(), assets, settings)))
                }
                Err(e) => {
                    // 写盘失败：命令放回栈顶，保持历史一致
                    self.undo_stack.push(cmd);
                    Err(e)
                }
            }
        } else {
            let changes = cmd.undo(graph);
            let label = cmd.label.clone();
            self.redo_stack.push(cmd);
            Ok(Some((label, changes, Vec::new(), None)))
        }
    }

    /// 重做（含外部副作用）
    #[allow(clippy::type_complexity)]
    pub fn redo_full(
        &mut self,
        graph: &mut Graph,
        envelope: &mut JsonMap,
        root: Option<&Path>,
    ) -> Result<Option<(String, Vec<GraphChange>, Vec<String>, Option<Value>)>, String> {
        let Some(mut cmd) = self.redo_stack.pop() else {
            return Ok(None);
        };
        if cmd.is_external() {
            match cmd.apply_external(true, envelope, root) {
                Ok(assets) => {
                    let settings = if matches!(cmd.kind, CmdKind::Settings { .. }) {
                        envelope.get("settings").cloned()
                    } else {
                        None
                    };
                    let label = cmd.label.clone();
                    self.undo_stack.push(cmd);
                    Ok(Some((label, Vec::new(), assets, settings)))
                }
                Err(e) => {
                    self.redo_stack.push(cmd);
                    Err(e)
                }
            }
        } else {
            let changes = cmd.execute(graph);
            let label = cmd.label.clone();
            self.undo_stack.push(cmd);
            Ok(Some((label, changes, Vec::new(), None)))
        }
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn depth(&self) -> usize {
        self.undo_stack.len()
    }

    /// 历史总条目数（undo + redo 两栈之和；depth 只表示可撤销位置）
    pub fn entries(&self) -> usize {
        self.undo_stack.len() + self.redo_stack.len()
    }

    pub fn undo_label(&self) -> Option<&str> {
        self.undo_stack.last().map(|c| c.label.as_str())
    }

    pub fn redo_label(&self) -> Option<&str> {
        self.redo_stack.last().map(|c| c.label.as_str())
    }

    pub fn labels(&self) -> Vec<String> {
        self.undo_stack.iter().map(|c| c.label.clone()).collect()
    }
}

#[cfg(test)]
mod tests;
