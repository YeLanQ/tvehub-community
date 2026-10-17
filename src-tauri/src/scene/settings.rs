// 场景 settings 补丁校验（后端权威）：白名单块/字段 + 类型收敛。
//
// 目前场景文档的 settings 面 = ScenePrototype 默认值：
//   rendering: { backgroundColor, ambientIntensity, ambientColor }
// 与节点属性相同原则：未知字段/非法类型拒绝并回传支持集合，不做静默透传——
// settings 会被 scene.save 持久化，脏值（如字符串 ambientIntensity）会一直留在文件里。

use serde_json::{Map, Value};

const SETTINGS_BLOCKS: &[&str] = &["rendering"];
const RENDERING_KEYS: &[&str] = &["backgroundColor", "ambientIntensity", "ambientColor"];

/// 校验结果：规范化后的补丁 + 被收敛的字段（与 material.set 的 clamped 同语义）
#[derive(Debug)]
pub(crate) struct NormalizedSettings {
    pub patch: Value,
    pub clamped: Vec<String>,
}

fn color_value(key: &str, v: &Value) -> Result<(Value, bool), String> {
    if let Some(n) = v.as_u64() {
        if n <= 0xffffff {
            return Ok((Value::Number(n.into()), false));
        }
        return Ok((Value::Number(0xffffffu64.into()), true));
    }
    if let Some(s) = v.as_str() {
        let hex = s.trim().trim_start_matches('#');
        let rgb = match hex.len() {
            3 => {
                let n = u32::from_str_radix(hex, 16)
                    .map_err(|_| format!("settings.{key} 不是合法颜色: {s}"))?;
                let (r, g, b) = ((n >> 8) & 0xf, (n >> 4) & 0xf, n & 0xf);
                (r * 17) << 16 | (g * 17) << 8 | (b * 17)
            }
            6 => u32::from_str_radix(hex, 16)
                .map_err(|_| format!("settings.{key} 不是合法颜色: {s}"))?,
            _ => return Err(format!("settings.{key} 需要 #rgb/#rrggbb 或数字，收到 {s}")),
        };
        return Ok((Value::Number(rgb.into()), false));
    }
    Err(format!(
        "settings.{key} 需要 #rrggbb 颜色或数字，收到 {}",
        v
    ))
}

fn intensity_value(key: &str, v: &Value) -> Result<(Value, bool), String> {
    let n = if let Some(n) = v.as_f64() {
        n
    } else if let Some(s) = v.as_str() {
        s.trim()
            .parse::<f64>()
            .map_err(|_| format!("settings.{key} 需要数值，收到 {}", v))?
    } else {
        return Err(format!("settings.{key} 需要数值，收到 {}", v));
    };
    if !n.is_finite() {
        return Err(format!("settings.{key} 需要有限数值，收到 {n}"));
    }
    // 与 material 的越界策略一致：收敛到 0..1 并在结果里回显 clamped
    let clamped = n.clamp(0.0, 1.0);
    let value = serde_json::Number::from_f64(clamped)
        .map(Value::Number)
        .unwrap_or(Value::from(0));
    Ok((value, clamped != n))
}

/// 校验并规范化 settings 补丁（颜色统一为数字，数值字符串转数字；越界收敛并回显）。
/// 未知块/未知字段/非法类型都返回错误，不做静默合并。
pub(crate) fn normalize_settings_patch(patch: &Value) -> Result<NormalizedSettings, String> {
    let obj = patch
        .as_object()
        .ok_or("patch 应为 JSON 对象（如 {rendering:{ambientIntensity:0.4}}）")?;
    if obj.is_empty() {
        return Err("patch 不能为空".to_string());
    }
    let mut out = Map::new();
    let mut clamped = Vec::new();
    for (block, value) in obj {
        if !SETTINGS_BLOCKS.contains(&block.as_str()) {
            return Err(format!(
                "未知 settings 块: {block}（支持: {}）",
                SETTINGS_BLOCKS.join("/")
            ));
        }
        let block_obj = value
            .as_object()
            .ok_or_else(|| format!("settings.{block} 应为对象"))?;
        let mut normalized = Map::new();
        for (key, v) in block_obj {
            if !RENDERING_KEYS.contains(&key.as_str()) {
                return Err(format!(
                    "未知 settings.{block} 字段: {key}（支持: {}）",
                    RENDERING_KEYS.join("/")
                ));
            }
            let (value, was_clamped) = if key == "ambientIntensity" {
                intensity_value(key, v)?
            } else {
                color_value(key, v)?
            };
            if was_clamped {
                clamped.push(format!("{block}.{key}"));
            }
            normalized.insert(key.clone(), value);
        }
        out.insert(block.clone(), Value::Object(normalized));
    }
    Ok(NormalizedSettings {
        patch: Value::Object(out),
        clamped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_known_fields_and_normalizes_types() {
        let out = normalize_settings_patch(&serde_json::json!({
            "rendering": {
                "backgroundColor": "#112233",
                "ambientIntensity": "0.35",
                "ambientColor": 16777215u64
            }
        }))
        .unwrap();
        assert_eq!(out.patch["rendering"]["backgroundColor"], 0x112233);
        assert_eq!(out.patch["rendering"]["ambientIntensity"], 0.35);
        assert_eq!(out.patch["rendering"]["ambientColor"], 0xffffff);
        assert!(out.clamped.is_empty());
    }

    #[test]
    fn rejects_unknown_block_field_and_bad_type() {
        assert!(normalize_settings_patch(&serde_json::json!({ "bogusBlock": {} }))
            .unwrap_err()
            .contains("未知 settings 块"));
        assert!(normalize_settings_patch(&serde_json::json!({
            "rendering": { "bogusKey": 1 }
        }))
        .unwrap_err()
        .contains("未知 settings.rendering 字段"));
        assert!(normalize_settings_patch(&serde_json::json!({
            "rendering": { "ambientIntensity": "abc" }
        }))
        .unwrap_err()
        .contains("需要数值"));
    }

    #[test]
    fn out_of_range_values_are_clamped_and_reported() {
        let out = normalize_settings_patch(&serde_json::json!({
            "rendering": { "ambientIntensity": 5.0 }
        }))
        .unwrap();
        assert_eq!(out.patch["rendering"]["ambientIntensity"], 1.0);
        assert_eq!(out.clamped, vec!["rendering.ambientIntensity".to_string()]);

        let color = normalize_settings_patch(&serde_json::json!({
            "rendering": { "backgroundColor": 0x1000000u64 }
        }))
        .unwrap();
        assert_eq!(color.patch["rendering"]["backgroundColor"], 0xffffff);
        assert_eq!(color.clamped, vec!["rendering.backgroundColor".to_string()]);
    }
}
