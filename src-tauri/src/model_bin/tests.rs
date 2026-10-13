//! model_bin 单测：外置化管线（使用中提取/未使用剔除/KHR 双键形态/外部引用去留/
//! gltf 合并/data URI 不变量）与 uid 重命名后的 uri 改写。

use std::collections::HashMap;

use super::{convert_model_to_bin, glb_to_bin, obj_to_bin, relative_uri, rewrite_model_texture_urls};
use crate::scene_pack::build_glb_container;

/// 构造测试 GLB：blob = 图像 8 字节(0xAA) + 几何 4 字节(0x0B)；bv0=图像 bv1=几何
fn fixture_png() -> [u8; 8] {
    [0xAA; 8]
}

fn fixture_json(materials: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "asset": { "version": "2.0" },
        "scenes": [{ "nodes": [0] }],
        "nodes": [{ "mesh": 0 }],
        "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
        "accessors": [{ "bufferView": 1, "componentType": 5126, "count": 1, "type": "VEC3" }],
        "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": 8 },
            { "buffer": 0, "byteOffset": 8, "byteLength": 4 },
        ],
        "buffers": [{ "byteLength": 12 }],
        "images": [{ "bufferView": 0, "mimeType": "image/png", "name": "albedo" }],
        "textures": [{ "source": 0 }],
        "materials": materials,
    })
}

fn fixture_blob() -> Vec<u8> {
    let mut blob = fixture_png().to_vec();
    blob.extend_from_slice(&[0x0B; 4]);
    blob
}

fn payload_glb_json(bin: &[u8]) -> serde_json::Value {
    assert_eq!(&bin[0..8], b"LQENBIN1");
    assert_eq!(u32::from_le_bytes(bin[8..12].try_into().unwrap()), 1);
    let payload = &bin[16..];
    super::glb_parts(payload).unwrap().0
}

#[test]
fn obj_bin_layout() {
    let obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf 1/1/1 2/2/2 3/3/3\n";
    let bin = obj_to_bin(obj).unwrap();
    assert_eq!(&bin[0..8], b"LQENBIN1");
    assert_eq!(u32::from_le_bytes(bin[8..12].try_into().unwrap()), 0);
    assert_eq!(u32::from_le_bytes(bin[12..16].try_into().unwrap()), 3); // verts
    assert_eq!(u32::from_le_bytes(bin[24..28].try_into().unwrap()), 1); // faces
    // 顶点数据从 28 开始：第一个顶点 x=0
    assert_eq!(f32::from_le_bytes(bin[28..32].try_into().unwrap()), 0.0);
    // obj 无效（无面）→ None
    assert!(obj_to_bin("v 0 0 0\n").is_none());
}

#[test]
fn glb_bin_wraps_raw() {
    let glb = b"glTF-fake-bytes";
    let bin = glb_to_bin(glb);
    assert_eq!(&bin[0..8], b"LQENBIN1");
    assert_eq!(u32::from_le_bytes(bin[8..12].try_into().unwrap()), 1);
    assert_eq!(u32::from_le_bytes(bin[12..16].try_into().unwrap()), 15);
    assert_eq!(&bin[16..], glb);
}

/// 使用中的内嵌贴图：提取为兄弟文件 + uri 引用；PNG 字节不再出现在 bin 中
#[test]
fn used_embedded_texture_externalized() {
    let glb = build_glb_container(&fixture_json(serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } },
    ])), &fixture_blob());
    let mut binaries = HashMap::new();
    binaries.insert("m/KY2DM.glb".to_string(), glb);

    let conv = convert_model_to_bin("m/KY2DM.glb", &mut binaries).expect("转换成功");
    assert!(conv.merged_sibs.is_empty() && conv.unused_sibs.is_empty());

    let sib = "m/KY2DM_albedo.png";
    assert_eq!(binaries.get(sib).map(Vec::as_slice), Some(fixture_png().as_slice()), "贴图字节提取为兄弟文件");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0]["uri"], "KY2DM_albedo.png", "uri 指向兄弟文件");
    assert!(doc["images"][0].get("bufferView").is_none(), "内嵌引用已移除");
    assert!(
        !conv.bin.windows(8).any(|w| w == fixture_png()),
        "PNG 字节不得残留在 bin 中"
    );
    // 几何仍在（accessor 引用的 bv1）
    assert!(conv.bin.windows(4).any(|w| w == [0x0B; 4]), "几何字节保留");
    // 压缩后单 buffer
    assert_eq!(doc["buffers"][0]["byteLength"], 4, "未引用 bv 剔除后 blob 仅剩几何");
}

/// 未使用的内嵌贴图：条目清空、字节剔除，不产生兄弟文件
#[test]
fn unused_embedded_texture_pruned() {
    let glb = build_glb_container(&fixture_json(serde_json::json!([])), &fixture_blob());
    let mut binaries = HashMap::new();
    binaries.insert("m/KY2DM.glb".to_string(), glb);

    let conv = convert_model_to_bin("m/KY2DM.glb", &mut binaries).expect("转换成功");
    assert!(conv.unused_sibs.is_empty(), "内嵌贴图剔除不产生 unused_sibs");
    assert!(!binaries.contains_key("m/KY2DM_albedo.png"), "不落兄弟文件");
    assert!(!conv.bin.windows(8).any(|w| w == fixture_png()), "PNG 字节剔除");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0], serde_json::json!({}), "图像条目清空");
}

/// KHR_texture_transform 的 {index, extensions} 双键形态必须计为使用中
#[test]
fn khr_texture_transform_counts_as_used() {
    let materials = serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0, "extensions": { "KHR_texture_transform": { "offset": [0, 0] } } } } },
    ]);
    let glb = build_glb_container(&fixture_json(materials), &fixture_blob());
    let mut binaries = HashMap::new();
    binaries.insert("m/a.glb".to_string(), glb);

    let conv = convert_model_to_bin("m/a.glb", &mut binaries).expect("转换成功");
    assert!(binaries.contains_key("m/a_albedo.png"), "双键形态不得误剔使用中贴图");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0]["uri"], "a_albedo.png");
}

/// 使用中的外部贴图：保持 uri 引用、不并入 unused_sibs、不落新文件
#[test]
fn used_external_texture_kept() {
    let mut json = fixture_json(serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } },
    ]));
    json["images"] = serde_json::json!([{ "uri": "albedo.png" }]);
    let glb = build_glb_container(&json, &[0x0B; 12]);
    let mut binaries = HashMap::new();
    binaries.insert("m/a.glb".to_string(), glb);
    binaries.insert("m/albedo.png".to_string(), vec![7u8; 4]);

    let conv = convert_model_to_bin("m/a.glb", &mut binaries).expect("转换成功");
    assert!(conv.unused_sibs.is_empty(), "使用中外贴图不剔除");
    assert_eq!(binaries.get("m/albedo.png").unwrap(), &[7u8; 4], "原样保留");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0]["uri"], "albedo.png", "uri 不改写");
    assert_eq!(doc["buffers"][0]["byteLength"], 4, "blob 仅剩被引用几何");
}

/// 未使用的外部贴图：记入 unused_sibs 由管线剔除
#[test]
fn unused_external_texture_pruned() {
    let mut json = fixture_json(serde_json::json!([]));
    json["images"] = serde_json::json!([{ "uri": "albedo.png" }]);
    let glb = build_glb_container(&json, &[0x0B; 12]);
    let mut binaries = HashMap::new();
    binaries.insert("m/a.glb".to_string(), glb);
    binaries.insert("m/albedo.png".to_string(), vec![7u8; 4]);

    let conv = convert_model_to_bin("m/a.glb", &mut binaries).expect("转换成功");
    assert_eq!(conv.unused_sibs, vec!["m/albedo.png".to_string()]);
}

/// .gltf：外部 buffer 并入 blob（bufferView 偏移重定基），外部贴图保持引用
#[test]
fn gltf_external_buffer_merged() {
    let json = serde_json::json!({
        "asset": { "version": "2.0" },
        "buffers": [{ "uri": "a.bin", "byteLength": 4 }],
        "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 4 }],
        "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3" }],
        "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
        "nodes": [{ "mesh": 0 }],
        "scenes": [{ "nodes": [0] }],
        "images": [{ "uri": "albedo.png" }],
        "textures": [{ "source": 0 }],
        "materials": [{ "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } }],
    });
    let mut binaries = HashMap::new();
    binaries.insert("m/a.gltf".to_string(), json.to_string().into_bytes());
    binaries.insert("m/a.bin".to_string(), vec![1, 2, 3, 4]);
    binaries.insert("m/albedo.png".to_string(), vec![7u8; 4]);

    let conv = convert_model_to_bin("m/a.gltf", &mut binaries).expect("转换成功");
    assert_eq!(conv.merged_sibs, vec!["m/a.bin".to_string()], "外部 buffer 并入");
    assert!(conv.unused_sibs.is_empty(), "使用中外贴图保留");
    assert!(conv.bin.windows(4).any(|w| w == [1, 2, 3, 4]), "buffer 字节在 bin 内");
    assert!(!conv.bin.windows(4).any(|w| w == [7u8; 4]), "贴图字节不内嵌");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0]["uri"], "albedo.png");
    assert_eq!(doc["buffers"].as_array().unwrap().len(), 1, "收敛为单 buffer");
}

/// data: URI 贴图保持 JSON 内嵌不变量（不提取、不改写）
#[test]
fn data_uri_kept_as_is() {
    let mut json = fixture_json(serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } },
    ]));
    json["images"] = serde_json::json!([{ "uri": "data:image/png;base64,AAAA" }]);
    let glb = build_glb_container(&json, &[0x0B; 12]);
    let mut binaries = HashMap::new();
    binaries.insert("m/a.glb".to_string(), glb);

    let conv = convert_model_to_bin("m/a.glb", &mut binaries).expect("转换成功");
    let doc = payload_glb_json(&conv.bin);
    assert_eq!(doc["images"][0]["uri"], "data:image/png;base64,AAAA", "data URI 原样保留");
}

/// uid 重命名后：uri 从提取名改写为兄弟 uid 名（同目录）
#[test]
fn rewrite_urls_after_rename() {
    let glb = build_glb_container(&fixture_json(serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } },
    ])), &fixture_blob());
    let mut binaries = HashMap::new();
    binaries.insert("m/KY2DM.glb".to_string(), glb);
    let mut bin = convert_model_to_bin("m/KY2DM.glb", &mut binaries).expect("转换成功").bin;

    let mut renames = HashMap::new();
    renames.insert("m/KY2DM.glb".to_string(), "m/11111111.bin".to_string());
    renames.insert("m/KY2DM_albedo.png".to_string(), "m/22222222.png".to_string());
    rewrite_model_texture_urls("m/KY2DM.glb", &mut bin, &renames);

    let doc = payload_glb_json(&bin);
    assert_eq!(doc["images"][0]["uri"], "22222222.png", "uri 改写为 uid 兄弟名");
    assert!(!bin.windows(8).any(|w| w == fixture_png()), "改写不回填贴图字节");
}

/// uid 重命名后：兄弟文件跨目录时的 ../ 回溯 uri
#[test]
fn rewrite_urls_cross_directory() {
    let glb = build_glb_container(&fixture_json(serde_json::json!([
        { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } },
    ])), &fixture_blob());
    let mut binaries = HashMap::new();
    binaries.insert("m/KY2DM.glb".to_string(), glb);
    let mut bin = convert_model_to_bin("m/KY2DM.glb", &mut binaries).expect("转换成功").bin;

    let mut renames = HashMap::new();
    renames.insert("m/KY2DM.glb".to_string(), "m/11111111.bin".to_string());
    renames.insert("m/KY2DM_albedo.png".to_string(), "assets/textures/22222222.png".to_string());
    rewrite_model_texture_urls("m/KY2DM.glb", &mut bin, &renames);

    let doc = payload_glb_json(&bin);
    assert_eq!(doc["images"][0]["uri"], "../assets/textures/22222222.png");
    assert_eq!(relative_uri("m", "assets/textures/x.png"), "../assets/textures/x.png");
    assert_eq!(relative_uri("", "x.png"), "x.png");
    assert_eq!(relative_uri("a/b", "a/b/x.png"), "x.png");
}

/// 非法输入回退：假 GLB 解析失败 → None（调用方保留原格式）
#[test]
fn invalid_glb_falls_back_to_none() {
    let mut binaries = HashMap::new();
    binaries.insert("m/bad.glb".to_string(), b"glTFfake-glb-bytes".to_vec());
    assert!(convert_model_to_bin("m/bad.glb", &mut binaries).is_none());
    let mut no_model = HashMap::new();
    assert!(convert_model_to_bin("m/missing.glb", &mut no_model).is_none());
    assert!(convert_model_to_bin("m/x.fbx", &mut no_model).is_none(), "fbx 不参与二进制化");
}
