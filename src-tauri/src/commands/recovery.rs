use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
pub struct RecoveryDraft {
    pub id: String,
    pub path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub content: String,
    pub encoding: String,
    pub line_ending: String,
    pub language_id: String,
    pub saved_at: u64,
    #[serde(default)]
    pub tab_order: Option<usize>,
    #[serde(default)]
    pub is_active: bool,
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

fn legacy_untitled_order(id: &str) -> Option<(u64, u64)> {
    let mut parts = id.split('_');
    if parts.next()? != "doc" {
        return None;
    }
    let sequence = parts.next()?.parse().ok()?;
    let created_at = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((created_at, sequence))
}

#[tauri::command]
pub fn save_recovery_draft(draft: RecoveryDraft) -> Result<(), String> {
    let file_path = recovery_dir().join(format!("{}.json", draft.id));
    let json = serde_json::to_string(&draft).map_err(|e| e.to_string())?;
    let temp_path = temporary_path(&file_path);

    let result = (|| -> io::Result<()> {
        // 临时文件必须和正式文件位于同一目录，确保替换操作在同一文件系统内完成。
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp_file.write_all(json.as_bytes())?;
        temp_file.sync_all()?;
        drop(temp_file);
        replace_file(&temp_path, &file_path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result.map_err(|e| e.to_string())
}

fn temporary_path(file_path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("draft.json");
    file_path.with_file_name(format!(".{file_name}.{process_id}.{stamp}.tmp"))
}

#[cfg(not(windows))]
fn replace_file(temp_path: &Path, file_path: &Path) -> io::Result<()> {
    fs::rename(temp_path, file_path)
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, file_path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    const REPLACEFILE_WRITE_THROUGH: u32 = 0x00000001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let temp_wide = wide_path(temp_path);
    let file_wide = wide_path(file_path);
    let replaced = unsafe {
        if file_path.exists() {
            ReplaceFileW(
                file_wide.as_ptr(),
                temp_wide.as_ptr(),
                null(),
                REPLACEFILE_WRITE_THROUGH,
                null_mut(),
                null_mut(),
            )
        } else {
            MoveFileExW(
                temp_wide.as_ptr(),
                file_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        }
    };

    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn MoveFileExW(existing_file_name: *const u16, new_file_name: *const u16, flags: u32) -> i32;
    fn ReplaceFileW(
        replaced_file_name: *const u16,
        replacement_file_name: *const u16,
        backup_file_name: *const u16,
        replace_flags: u32,
        exclude: *mut std::ffi::c_void,
        reserved: *mut std::ffi::c_void,
    ) -> i32;
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
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<RecoveryDraft>(&content) {
                    Ok(draft) => drafts.push(draft),
                    Err(error) => {
                        eprintln!("[recovery] 忽略损坏草稿 {}: {}", path.display(), error)
                    }
                },
                Err(error) => eprintln!("[recovery] 无法读取草稿 {}: {}", path.display(), error),
            }
        }
    }

    // New drafts retain their tab order. Legacy drafts without tab_order keep the
    // previous saved-at ordering so existing recovery data remains compatible.
    drafts.sort_by(|a, b| match (a.tab_order, b.tab_order) {
        (Some(a_order), Some(b_order)) => a_order.cmp(&b_order),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => match (legacy_untitled_order(&a.id), legacy_untitled_order(&b.id)) {
            (Some(a_order), Some(b_order)) => a_order.cmp(&b_order),
            _ => b.saved_at.cmp(&a.saved_at),
        },
    });

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_paths_are_unique_and_sibling_files() {
        let target = PathBuf::from("draft.json");
        let first = temporary_path(&target);
        let second = temporary_path(&target);
        assert_ne!(first, second);
        assert_eq!(first.parent(), target.parent());
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tmp"));
    }

    #[test]
    fn recovery_draft_round_trips_json() {
        let draft = RecoveryDraft {
            id: "test".to_string(),
            path: Some("C:\\\\test.txt".to_string()),
            title: Some("test.txt".to_string()),
            content: "draft".to_string(),
            encoding: "utf-8".to_string(),
            line_ending: "LF".to_string(),
            language_id: "plaintext".to_string(),
            saved_at: 42,
            tab_order: Some(3),
            is_active: true,
        };
        let json = serde_json::to_string(&draft).expect("draft should serialize");
        let restored: RecoveryDraft =
            serde_json::from_str(&json).expect("draft should deserialize");
        assert_eq!(restored.id, draft.id);
        assert_eq!(restored.content, draft.content);
        assert_eq!(restored.saved_at, draft.saved_at);
        assert_eq!(restored.title, draft.title);
        assert_eq!(restored.tab_order, draft.tab_order);
        assert_eq!(restored.is_active, draft.is_active);
    }

    #[test]
    fn legacy_drafts_default_new_recovery_fields() {
        let json = r#"{"id":"legacy","path":null,"content":"draft","encoding":"utf-8","line_ending":"LF","language_id":"plaintext","saved_at":42}"#;
        let restored: RecoveryDraft =
            serde_json::from_str(json).expect("legacy draft should deserialize");
        assert_eq!(restored.title, None);
        assert_eq!(restored.tab_order, None);
        assert!(!restored.is_active);
    }

    #[test]
    fn legacy_untitled_ids_expose_stable_creation_order() {
        assert_eq!(legacy_untitled_order("doc_3_1000"), Some((1000, 3)));
        assert_eq!(legacy_untitled_order("doc_1000"), None);
    }
}
