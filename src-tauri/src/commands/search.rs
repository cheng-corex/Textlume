use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use regex::Regex;

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchParams {
    pub query: String,
    pub root: String,
    pub include: Option<String>,
    pub exclude: Option<String>,
}

#[tauri::command]
pub fn search_in_files(params: SearchParams) -> Result<Vec<SearchMatch>, String> {
    let re = Regex::new(&params.query).map_err(|e| format!("正则表达式错误: {}", e))?;

    let mut results = Vec::new();
    let max_results = 1000;

    let walker = WalkDir::new(&params.root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip hidden directories and common non-text directories
            if e.file_type().is_dir() {
                return !name.starts_with('.')
                    && name != "node_modules"
                    && name != "target"
                    && name != ".git"
                    && name != ".svn"
                    && name != "__pycache__";
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if results.len() >= max_results {
            break;
        }

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let path_str = path.to_string_lossy();

        // Apply include/exclude patterns if specified
        if let Some(ref include) = params.include {
            let glob_pattern = include.replace("*", ".*");
            let inc_re = Regex::new(&format!("(?i){}", glob_pattern)).unwrap();
            if !inc_re.is_match(&path_str) {
                continue;
            }
        }

        if let Some(ref exclude) = params.exclude {
            let glob_pattern = exclude.replace("*", ".*");
            let exc_re = Regex::new(&format!("(?i){}", glob_pattern)).unwrap();
            if exc_re.is_match(&path_str) {
                continue;
            }
        }

        // Skip binary files by checking first few KB
        if let Ok(bytes) = std::fs::read(path) {
            if bytes.len() > 10_000_000 {
                continue; // Skip files larger than 10MB
            }

            // Try to read as text
            if let Ok(content) = String::from_utf8(bytes) {
                for (line_num, line_content) in content.lines().enumerate() {
                    if let Some(mat) = re.find(line_content) {
                        results.push(SearchMatch {
                            file: path_str.to_string(),
                            line: line_num + 1,
                            column: mat.start() + 1,
                            content: line_content.to_string(),
                        });

                        if results.len() >= max_results {
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}
