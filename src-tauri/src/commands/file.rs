use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn recent_files_path() -> PathBuf {
    let mut dir = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    dir.push("textlume-recent.json");
    dir
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME").ok().map(|h| {
                let mut p = PathBuf::from(h);
                p.push(".config");
                p
            })
        })
}

#[tauri::command]
pub fn get_recent_files() -> Result<Vec<String>, String> {
    let path = recent_files_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_recent_file(file_path: String) -> Result<Vec<String>, String> {
    let path = recent_files_path();
    let mut recent: Vec<String> = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Remove duplicate and add to front
    recent.retain(|f| f != &file_path);
    recent.insert(0, file_path);

    // Keep only last 20
    recent.truncate(20);

    let json = serde_json::to_string_pretty(&recent).map_err(|e| e.to_string())?;
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;

    Ok(recent)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub content: String,
    pub path: String,
    pub encoding: String,
    pub line_ending: String,
    pub file_size: u64,
    pub language_id: String,
    pub last_modified_at: u64,
    pub is_readonly: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub last_modified_at: u64,
    pub file_size: u64,
    pub is_readonly: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePayload {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub line_ending: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub last_modified_at: u64,
    pub file_size: u64,
}

/// Guess language from file extension
fn guess_language(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "js" | "mjs" => "javascript",
        "jsx" => "jsx",
        "ts" | "mts" => "typescript",
        "tsx" => "tsx",
        "json" => "json",
        "html" | "htm" => "html",
        "css" => "css",
        "py" => "python",
        "rs" => "rust",
        "md" => "markdown",
        "xml" | "svg" => "xml",
        "yaml" | "yml" => "yaml",
        "sql" => "sql",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "rb" => "ruby",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "sh" | "bash" => "shell",
        "ps1" => "powershell",
        "bat" | "cmd" => "batch",
        "ini" | "cfg" => "ini",
        "env" => "dotenv",
        "toml" => "toml",
        "dockerfile" => "dockerfile",
        "csv" => "csv",
        "log" => "log",
        "diff" | "patch" => "diff",
        _ => "plaintext",
    }
}

/// Detect line ending from content
fn detect_line_ending(content: &[u8]) -> String {
    if content.contains(&b'\r') {
        // Check for CRLF
        if content.windows(2).any(|w| w == [b'\r', b'\n']) {
            "CRLF".to_string()
        } else {
            "CR".to_string()
        }
    } else {
        "LF".to_string()
    }
}

/// Detect encoding and decode content
fn decode_content(bytes: &[u8]) -> (String, String) {
    // Check BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        // UTF-8 BOM
        let (text, _, _) = encoding_rs::UTF_8.decode(&bytes[3..]);
        (text.into_owned(), "utf-8-bom".to_string())
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        (text.into_owned(), "utf-16le".to_string())
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        (text.into_owned(), "utf-16be".to_string())
    } else {
        // Try UTF-8 first, then GBK
        if let Ok(text) = std::str::from_utf8(bytes) {
            (text.to_owned(), "utf-8".to_string())
        } else {
            // Try GBK
            let (text, _, had_errors) = encoding_rs::GBK.decode(bytes);
            if had_errors {
                // Fall back to Latin-1
                let (text, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
                (text.into_owned(), "latin1".to_string())
            } else {
                (text.into_owned(), "gbk".to_string())
            }
        }
    }
}

#[tauri::command]
pub fn open_file(path: String) -> Result<FileInfo, String> {
    let p = Path::new(&path);

    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let file_size = metadata.len();
    let is_readonly = metadata.permissions().readonly();

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (content, encoding) = decode_content(&bytes);
    let line_ending = detect_line_ending(&bytes);
    // Normalize content to LF so CodeMirror doesn't treat line-ending conversion as a change
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let language_id = guess_language(&path);

    let last_modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(FileInfo {
        content,
        path: path.clone(),
        encoding,
        line_ending,
        file_size,
        language_id: language_id.to_string(),
        last_modified_at,
        is_readonly,
    })
}

#[tauri::command]
pub fn save_file(payload: SavePayload) -> Result<SaveResult, String> {
    // Encode content based on the specified encoding
    let bytes: Vec<u8> = match payload.encoding.as_str() {
        "utf-8-bom" => {
            let mut bom = vec![0xEF, 0xBB, 0xBF];
            let (encoded, _, _) = encoding_rs::UTF_8.encode(&payload.content);
            bom.extend_from_slice(&encoded);
            bom
        }
        "utf-16le" => {
            let (encoded, _, _) = encoding_rs::UTF_16LE.encode(&payload.content);
            encoded.into_owned()
        }
        "utf-16be" => {
            let (encoded, _, _) = encoding_rs::UTF_16BE.encode(&payload.content);
            encoded.into_owned()
        }
        "gbk" => {
            let (encoded, _, _) = encoding_rs::GBK.encode(&payload.content);
            encoded.into_owned()
        }
        "latin1" => {
            let (encoded, _, _) = encoding_rs::WINDOWS_1252.encode(&payload.content);
            encoded.into_owned()
        }
        _ => {
            // Default UTF-8
            let (encoded, _, _) = encoding_rs::UTF_8.encode(&payload.content);
            encoded.into_owned()
        }
    };

    // Apply line ending conversion
    let final_bytes: Vec<u8> = if payload.line_ending == "CRLF" {
        // Replace LF with CRLF, but avoid double CRLF
        let mut result = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\n' {
                if i == 0 || bytes[i - 1] != b'\r' {
                    result.push(b'\r');
                }
                result.push(b'\n');
            } else if bytes[i] == b'\r' {
                result.push(b'\r');
                // Skip next \n if present, it will be added above
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    i += 1;
                }
                result.push(b'\n');
            } else {
                result.push(bytes[i]);
            }
            i += 1;
        }
        result
    } else if payload.line_ending == "CR" {
        bytes.iter().map(|&b| if b == b'\n' { b'\r' } else { b }).collect()
    } else {
        // LF: replace CRLF and CR with LF
        let mut result = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\r' {
                result.push(b'\n');
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    i += 1;
                }
            } else {
                result.push(bytes[i]);
            }
            i += 1;
        }
        result
    };

    // Write to temp file first, then atomically replace
    let temp_path = format!("{}.textlume.tmp", payload.path);
    std::fs::write(&temp_path, &final_bytes).map_err(|e| format!("保存失败: {}", e))?;
    std::fs::rename(&temp_path, &payload.path).map_err(|e| format!("保存失败: {}", e))?;

    let saved_metadata = std::fs::metadata(&payload.path).map_err(|e| format!("保存失败: {}", e))?;
    let last_modified_at = saved_metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Ok(SaveResult { last_modified_at, file_size: saved_metadata.len() })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let p = std::path::Path::new(&path);
    if !p.is_dir() {
        return Err(format!("不是目录: {}", path));
    }

    let mut entries = Vec::new();
    let mut dir = std::fs::read_dir(p).map_err(|e| format!("读取目录失败: {}", e))?;

    while let Some(Ok(entry)) = dir.next() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }
        let md = entry.metadata().ok();
        let is_dir = md.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = md.map(|m| m.len()).unwrap_or(0);
        let full_path = entry.path().to_string_lossy().to_string();

        entries.push(DirEntry {
            name,
            path: full_path,
            is_dir,
            size,
        });
    }

    // Directories first, then files
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    let p = std::path::Path::new(&old_path);
    let parent = p.parent().ok_or("无法获取父目录")?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("文件已存在: {}", new_name));
    }

    std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("文件已存在: {}", path));
    }
    // Ensure parent directory exists
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(p, "").map_err(|e| format!("创建文件失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("已存在: {}", path));
    }
    std::fs::create_dir_all(p).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_file_or_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        std::fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

/// Copy a file or directory into a target directory
#[tauri::command]
pub fn copy_file_or_dir(src_path: String, dest_dir: String) -> Result<String, String> {
    let src = std::path::Path::new(&src_path);
    let dest = std::path::Path::new(&dest_dir);

    if !src.exists() {
        return Err(format!("源路径不存在: {}", src_path));
    }
    if !dest.is_dir() {
        return Err(format!("目标不是目录: {}", dest_dir));
    }

    let file_name = src.file_name().ok_or("无法获取文件名")?;
    let new_path = dest.join(file_name);

    if new_path.exists() {
        return Err(format!("目标已存在同名文件: {}", file_name.to_string_lossy()));
    }

    if src.is_dir() {
        copy_dir_recursive(src, &new_path).map_err(|e| format!("复制目录失败: {}", e))?;
    } else {
        std::fs::copy(src, &new_path).map_err(|e| format!("复制文件失败: {}", e))?;
    }
    Ok(new_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_line_endings() {
        assert_eq!(detect_line_ending(b"a\nb"), "LF");
        assert_eq!(detect_line_ending(b"a\r\nb"), "CRLF");
        assert_eq!(detect_line_ending(b"a\rb"), "CR");
    }

    #[test]
    fn decodes_bom_and_utf8() {
        assert_eq!(decode_content(b"hello"), ("hello".to_string(), "utf-8".to_string()));
        assert_eq!(decode_content(&[0xEF, 0xBB, 0xBF, b'h']), ("h".to_string(), "utf-8-bom".to_string()));
        assert_eq!(decode_content(&[0xFF, 0xFE, b'h', 0]), ("h".to_string(), "utf-16le".to_string()));
    }

    #[test]
    fn guesses_common_languages() {
        assert_eq!(guess_language("app.tsx"), "tsx");
        assert_eq!(guess_language("README.MD"), "markdown");
        assert_eq!(guess_language("unknown.custom"), "plaintext");
    }

    #[test]
    fn saves_content_and_reports_size() {
        let path = std::env::temp_dir().join(format!("textlume-file-test-{}.txt", std::process::id()));
        let payload = SavePayload {
            path: path.to_string_lossy().into_owned(),
            content: "a\nb".to_string(),
            encoding: "utf-8".to_string(),
            line_ending: "CRLF".to_string(),
        };
        let result = save_file(payload).expect("save should succeed");
        assert_eq!(std::fs::read(&path).expect("file should exist"), b"a\r\nb");
        assert_eq!(result.file_size, 4);
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let last_modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileMetadata {
        last_modified_at,
        file_size: metadata.len(),
        is_readonly: metadata.permissions().readonly(),
    })
}

/// Move a file or directory into a target directory
#[tauri::command]
pub fn move_file_or_dir(src_path: String, dest_dir: String) -> Result<String, String> {
    let src = std::path::Path::new(&src_path);
    let dest = std::path::Path::new(&dest_dir);

    if !src.exists() {
        return Err(format!("源路径不存在: {}", src_path));
    }
    if !dest.is_dir() {
        return Err(format!("目标不是目录: {}", dest_dir));
    }

    let file_name = src.file_name().ok_or("无法获取文件名")?;
    let new_path = dest.join(file_name);

    if new_path.exists() {
        return Err(format!("目标已存在同名文件: {}", file_name.to_string_lossy()));
    }

    // Try rename first (fast, works on same drive/filesystem)
    match std::fs::rename(src, &new_path) {
        Ok(_) => Ok(new_path.to_string_lossy().to_string()),
        Err(_) => {
            // Cross-drive: copy then delete
            if src.is_dir() {
                copy_dir_recursive(src, &new_path).map_err(|e| format!("跨盘移动失败: {}", e))?;
                std::fs::remove_dir_all(src).map_err(|e| format!("删除源目录失败: {}", e))?;
            } else {
                std::fs::copy(src, &new_path).map_err(|e| format!("跨盘复制失败: {}", e))?;
                std::fs::remove_file(src).map_err(|e| format!("删除源文件失败: {}", e))?;
            }
            Ok(new_path.to_string_lossy().to_string())
        }
    }
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

/// Get and clear files passed via command-line args (double-click / file association)
#[tauri::command]
pub fn get_startup_files() -> Vec<String> {
    let startup_file = std::env::temp_dir().join("textlume.startup");
    if let Ok(content) = std::fs::read_to_string(&startup_file) {
        let _ = std::fs::remove_file(&startup_file);
        content.lines().map(|s| s.to_string()).filter(|s| !s.is_empty()).collect()
    } else {
        Vec::new()
    }
}

fn session_file_path() -> PathBuf {
    let mut dir = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    dir.push("textlume-session.json");
    dir
}

fn session_temp_path(file_path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("session.json");
    file_path.with_file_name(format!(".{file_name}.{process_id}.{stamp}.tmp"))
}

fn atomic_replace_session(temp_path: &Path, file_path: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(temp_path, file_path)
    }

    #[cfg(windows)]
    {
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

fn atomic_write_session(file_path: &Path, contents: &str) -> io::Result<()> {
    let temp_path = session_temp_path(file_path);
    let result = (|| {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp_file.write_all(contents.as_bytes())?;
        temp_file.sync_all()?;
        drop(temp_file);
        atomic_replace_session(&temp_path, file_path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct SessionCursor {
    pub line: u32,
    pub col: u32,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct SessionSelection {
    pub anchor: u64,
    pub head: u64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct SessionFile {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_ending: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<SessionCursor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<SessionSelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_top: Option<f64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct SessionData {
    #[serde(default)]
    pub files: Vec<SessionFile>,
    #[serde(default)]
    pub active_path: Option<String>,
}

/// Save open files and their editor state so they can be restored on next launch
#[tauri::command]
pub fn save_session_files(session: SessionData) -> Result<(), String> {
    let session_path = session_file_path();
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    atomic_write_session(&session_path, &json).map_err(|e| e.to_string())
}

/// Get previously open files and editor state for session restore.
/// Older versions stored a plain string array, so keep that format readable.
#[tauri::command]
pub fn get_session_files() -> SessionData {
    let session_path = session_file_path();
    if let Ok(content) = std::fs::read_to_string(&session_path) {
        let _ = std::fs::remove_file(&session_path);
        if let Ok(session) = serde_json::from_str::<SessionData>(&content) {
            return session;
        }
        if let Ok(file_paths) = serde_json::from_str::<Vec<String>>(&content) {
            return SessionData {
                files: file_paths.into_iter().map(|path| SessionFile { path, ..Default::default() }).collect(),
                ..Default::default()
            };
        }
        SessionData::default()
    } else {
        SessionData::default()
    }
}

/// Reveal a file or folder in the system file manager
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if p.is_dir() {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    } else {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(p)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(())
}
