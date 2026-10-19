
use super::*;
use serde_json::json;

fn mesh_cmd(id: &str, parent: Option<&str>) -> SceneCmd {
    let node: NodeData = serde_json::from_value(json!({
        "type": "meshNode", "id": id, "name": id, "parentId": parent,
        "source": "primitive", "geometry": "box"
    }))
    .unwrap();
    SceneCmd {
        label: format!("Add {id}"),
        kind: CmdKind::Add { node },
    }
}

#[test]
fn add_undo_redo() {
    let mut g = Graph::default();
    let mut h = History::default();

    h.push(mesh_cmd("root", None));
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    h.push(mesh_cmd("a", Some("root")));
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert!(g.contains("a"));

    h.undo(&mut g).unwrap();
    assert!(!g.contains("a") && g.contains("root"));

    h.redo(&mut g).unwrap();
    assert!(g.contains("a"));
    assert_eq!(g.get("a").unwrap().parent_id.as_deref(), Some("root"));
}

#[test]
fn remove_batch_undo_restores_in_reverse() {
    let mut g = Graph::default();
    let mut h = History::default();
    for (id, parent) in [("root", None), ("a", Some("root")), ("b", Some("root"))] {
        h.push(mesh_cmd(id, parent));
        h.undo_stack.last_mut().unwrap().execute(&mut g);
    }

    let mut cmd = SceneCmd {
        label: "Remove".into(),
        kind: CmdKind::RemoveNodes {
            ids: vec!["a".into(), "b".into()],
            captured: vec![],
            done: false,
        },
    };
    cmd.execute(&mut g);
    assert!(!g.contains("a") && !g.contains("b"));
    h.push(cmd);

    h.undo(&mut g).unwrap();
    assert!(g.contains("a") && g.contains("b"));
    h.redo(&mut g).unwrap();
    assert!(!g.contains("a") && !g.contains("b"));
}

#[test]
fn transform_undo_restores_before() {
    let mut g = Graph::default();
    let mut h = History::default();
    h.push(mesh_cmd("n", None));
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert!(g.contains("n"));

    let before = g.get("n").unwrap().transform.clone();
    let after = TransformData {
        position: super::super::model::Vec3Data {
            x: 5.0,
            y: 0.0,
            z: 0.0,
        },
        ..before.clone()
    };
    h.push(SceneCmd {
        label: "Set Transform".into(),
        kind: CmdKind::SetTransform {
            id: "n".into(),
            before: before.clone(),
            after: after.clone(),
        },
    });
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert_eq!(g.get("n").unwrap().transform.position.x, 5.0);

    h.undo(&mut g).unwrap();
    assert_eq!(g.get("n").unwrap().transform.position.x, before.position.x);
}

/// AddTree（prefab 实例化）：undo 摘除整棵子树，redo 按嵌套文档重建
#[test]
fn add_tree_undo_redo_roundtrip() {
    let mut g = Graph::default();
    let mut h = History::default();
    h.push(mesh_cmd("root", None));
    h.undo_stack.last_mut().unwrap().execute(&mut g);

    let tree: NodeData = serde_json::from_value(json!({
        "type": "node", "id": "t", "name": "T", "parentId": "root",
        "children": [
            { "type": "meshNode", "id": "t1", "name": "T1", "parentId": "t",
              "source": "primitive", "geometry": "box" }
        ]
    }))
    .unwrap();
    h.push(SceneCmd {
        label: "Add Tree".into(),
        kind: CmdKind::AddTree {
            root: tree,
            parent_id: Some("root".into()),
        },
    });
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert!(g.contains("t") && g.contains("t1"));
    assert_eq!(g.get("t").unwrap().parent_id.as_deref(), Some("root"));

    h.undo(&mut g).unwrap();
    assert!(!g.contains("t") && !g.contains("t1"));

    h.redo(&mut g).unwrap();
    assert!(g.contains("t") && g.contains("t1"));
    assert_eq!(g.get("t1").unwrap().parent_id.as_deref(), Some("t"));
}

/// PatchNodes（多选批量编辑）：一次撤销/重做回填全部节点
#[test]
fn patch_nodes_undo_redo_batch() {
    let mut g = Graph::default();
    let mut h = History::default();
    for id in ["a", "b"] {
        h.push(mesh_cmd(id, None));
        h.undo_stack.last_mut().unwrap().execute(&mut g);
    }

    let snapshot = |g: &Graph, id: &str| g.get(id).unwrap().clone();
    let items: Vec<(String, NodeData, NodeData)> = ["a", "b"]
        .iter()
        .map(|id| {
            let before = snapshot(&g, id);
            let mut after = before.clone();
            after.name = format!("{id}-renamed");
            (id.to_string(), before, after)
        })
        .collect();
    h.push(SceneCmd {
        label: "Batch Patch".into(),
        kind: CmdKind::PatchNodes { items },
    });
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert_eq!(g.get("a").unwrap().name, "a-renamed");
    assert_eq!(g.get("b").unwrap().name, "b-renamed");

    h.undo(&mut g).unwrap();
    assert_eq!(g.get("a").unwrap().name, "a");
    assert_eq!(g.get("b").unwrap().name, "b");

    h.redo(&mut g).unwrap();
    assert_eq!(g.get("a").unwrap().name, "a-renamed");
    assert_eq!(g.get("b").unwrap().name, "b-renamed");
}

#[test]
fn entries_counts_both_stacks_position_only_undo() {
    let mut g = Graph::default();
    let mut h = History::default();
    h.push(mesh_cmd("root", None));
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    h.push(mesh_cmd("a", Some("root")));
    h.undo_stack.last_mut().unwrap().execute(&mut g);
    assert_eq!(h.depth(), 2, "可撤销位置");
    assert_eq!(h.entries(), 2, "总条目");
    h.undo(&mut g).unwrap();
    assert_eq!(h.depth(), 1, "undo 后位置回退");
    assert_eq!(h.entries(), 2, "总条目含 redo 栈");
}

#[test]
fn external_asset_write_undo_redo_rewrites_file() {
    let dir = std::env::temp_dir().join(format!("tve-undo-asset-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("Red.mat");
    std::fs::write(&file, "after-content").unwrap();
    let mut h = History::default();
    h.push(SceneCmd {
        label: "Material".into(),
        kind: CmdKind::AssetWrite {
            rel: "Red.mat".into(),
            before: "before-content".into(),
            after: "after-content".into(),
        },
    });
    let mut g = Graph::default();
    let mut env = JsonMap::new();
    let out = h.undo_full(&mut g, &mut env, Some(&dir)).unwrap().unwrap();
    assert_eq!(out.2, vec!["Red.mat".to_string()], "undo 返回受影响资产");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "before-content");
    h.redo_full(&mut g, &mut env, Some(&dir)).unwrap().unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "after-content");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn external_settings_undo_redo_restores_envelope() {
    let mut h = History::default();
    h.push(SceneCmd {
        label: "Scene Settings".into(),
        kind: CmdKind::Settings {
            before: Some(json!({ "a": 1 })),
            after: json!({ "a": 2 }),
        },
    });
    let mut g = Graph::default();
    let mut env = JsonMap::new();
    env.insert("settings".into(), json!({ "a": 2 }));
    let out = h.undo_full(&mut g, &mut env, None).unwrap().unwrap();
    assert_eq!(env["settings"], json!({ "a": 1 }));
    assert_eq!(out.3, Some(json!({ "a": 1 })), "undo 返回还原后的 settings");
    h.redo_full(&mut g, &mut env, None).unwrap().unwrap();
    assert_eq!(env["settings"], json!({ "a": 2 }));
}


/// 资产移动后的历史随动：图命令快照与 AssetWrite（rel + 文本载荷）一并改写，
/// 撤销/重做不再复活旧路径引用
#[test]
fn remap_refs_updates_snapshots_and_asset_write() {
    let mut h = History::default();
    let node: NodeData = serde_json::from_value(json!({
        "type": "meshNode", "id": "a", "name": "A", "source": "model",
        "model": "assets/models/hero.glb",
        "modelMaterialOverrides": { "Body": "assets/materials/body.mat" }
    }))
    .unwrap();
    h.push(SceneCmd {
        label: "编辑节点".into(),
        kind: CmdKind::PatchNode { id: "a".into(), before: node.clone(), after: node },
    });
    h.push(SceneCmd {
        label: "改材质".into(),
        kind: CmdKind::AssetWrite {
            rel: "assets/materials/body.mat".into(),
            before: r#"{"$type":"material","map":"assets/textures/a.png"}"#.into(),
            after: r#"{"$type":"material","map":"assets/textures/b.png"}"#.into(),
        },
    });

    // 目录移动：assets/textures → assets/tex；单文件重命名：body.mat → body2.mat
    assert!(h.remap_refs("assets/textures", "assets/tex"));
    assert!(h.remap_refs("assets/materials/body.mat", "assets/materials/body2.mat"));

    let cmd = h.undo_stack.get(1).unwrap();
    match &cmd.kind {
        CmdKind::AssetWrite { rel, before, after } => {
            assert_eq!(rel, "assets/materials/body2.mat");
            let before: serde_json::Value = serde_json::from_str(before).unwrap();
            let after: serde_json::Value = serde_json::from_str(after).unwrap();
            assert_eq!(before["map"], "assets/tex/a.png");
            assert_eq!(after["map"], "assets/tex/b.png");
        }
        other => panic!("栈顶应是 AssetWrite: {other:?}"),
    }
    let cmd = h.undo_stack.get(0).unwrap();
    match &cmd.kind {
        CmdKind::PatchNode { after, .. } => {
            assert_eq!(after.extra["model"], "assets/models/hero.glb", "目录外引用不动");
            assert_eq!(
                after.extra["modelMaterialOverrides"]["Body"],
                "assets/materials/body2.mat"
            );
        }
        other => panic!("应是 PatchNode: {other:?}"),
    }
    // 无命中返回 false
    assert!(!h.remap_refs("assets/none", "assets/other"));
}
