import { invoke } from "@tauri-apps/api/core";

export interface FileInfo {
  content: string;
  path: string;
  encoding: string;
  lineEnding: string;
  fileSize: number;
  languageId: string;
  lastModifiedAt: number;
  isReadonly: boolean;
}

export interface SavePayload {
  path: string;
  content: string;
  encoding: string;
  lineEnding: string;
}

export async function openFile(path: string): Promise<FileInfo> {
  return invoke<FileInfo>("open_file", { path });
}

export async function saveFile(payload: SavePayload): Promise<{ lastModifiedAt: number }> {
  return invoke("save_file", { payload });
}

export async function getFileEncoding(path: string): Promise<{ encoding: string; bom: boolean }> {
  return invoke("get_file_encoding", { path });
}

export async function searchInFiles(params: {
  query: string;
  root: string;
  include?: string;
  exclude?: string;
}): Promise<Array<{ file: string; line: number; column: number; content: string }>> {
  return invoke("search_in_files", { params });
}

export async function getRecentFiles(): Promise<string[]> {
  return invoke<string[]>("get_recent_files");
}

export async function addRecentFile(path: string): Promise<string[]> {
  return invoke<string[]>("add_recent_file", { filePath: path });
}

export async function getAppSettings(): Promise<Record<string, unknown>> {
  return invoke("get_app_settings");
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export async function listDirectory(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_directory", { path });
}

// Recovery
export interface RecoveryDraft {
  id: string;
  path?: string;
  content: string;
  encoding: string;
  line_ending: string;
  language_id: string;
  saved_at: number;
}

export async function saveRecoveryDraft(draft: RecoveryDraft): Promise<void> {
  return invoke("save_recovery_draft", { draft });
}

export async function listRecoveryDrafts(): Promise<RecoveryDraft[]> {
  return invoke<RecoveryDraft[]>("list_recovery_drafts");
}

export async function clearRecoveryDraft(id: string): Promise<void> {
  return invoke("clear_recovery_draft", { id });
}

export async function clearAllRecoveryDrafts(): Promise<void> {
  return invoke("clear_all_recovery_drafts");
}

export async function renameFile(oldPath: string, newName: string): Promise<string> {
  return invoke<string>("rename_file", { oldPath, newName });
}

export async function createFile(path: string): Promise<void> {
  return invoke("create_file", { path });
}

export async function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export async function deleteFileOrDir(path: string): Promise<void> {
  return invoke("delete_file_or_dir", { path });
}

export async function drainPendingFiles(): Promise<string[]> {
  return invoke<string[]>("drain_pending");
}

export async function getStartupFiles(): Promise<string[]> {
  return invoke<string[]>("get_startup_files");
}

export async function saveSessionFiles(paths: string[]): Promise<void> {
  return invoke("save_session_files", { filePaths: paths });
}

export async function getSessionFiles(): Promise<string[]> {
  return invoke<string[]>("get_session_files");
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

export async function moveFileOrDir(srcPath: string, destDir: string): Promise<string> {
  return invoke<string>("move_file_or_dir", { srcPath, destDir });
}

export async function copyFileOrDir(srcPath: string, destDir: string): Promise<string> {
  return invoke<string>("copy_file_or_dir", { srcPath, destDir });
}
