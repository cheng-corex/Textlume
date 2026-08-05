use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct RecoveryDraft {
    pub id: String,
    pub path: Option<String>,
    pub content: String,
    pub encoding: String,
    pub line_ending: String,
    pub language_id: String,
    pub saved_at: u64,
}

fn recovery_dir() -> PathBuf {
    // 存到应用数据目录（%APPDATA%\textlume\recovery），比 temp 目录持久，
    // 系统不会定期清理，崩溃后仍可恢复
    let mut dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata)
    } else if let Ok(home) = std::env::var("HOME") {
        let mut h = PathBuf::from(home);
        h.push(".config");
        h
    } else {
        PathBuf::from(".")
    };
    dir.push("textlume");
    dir.push("recovery");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn save_recovery_draft(draft: RecoveryDraft) -> Result<(), String> {
    let file_path = recovery_dir().join(format!("{}.json", draft.id));
    let json = serde_json::to_string(&draft).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recovery_drafts() -> Result<Vec<RecoveryDraft>, String> {
    let dir = recovery_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut drafts = Vec::new();
    let mut entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

    while let Some(Ok(entry)) = entries.next() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(draft) = serde_json::from_str::<RecoveryDraft>(&content) {
                    drafts.push(draft);
                }
            }
        }
    }

    // Sort by saved_at descending
    drafts.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));

    Ok(drafts)
}

#[tauri::command]
pub fn clear_recovery_draft(id: String) -> Result<(), String> {
    let file_path = recovery_dir().join(format!("{}.json", id));
    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// 清空所有草稿（当前仅用于测试/调试，前端不再调用）
#[tauri::command]
pub fn clear_all_recovery_drafts() -> Result<(), String> {
    let dir = recovery_dir();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}
