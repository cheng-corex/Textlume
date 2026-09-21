export type DocumentId = string;

export type TextEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "gbk"
  | "latin1"
  | "unknown";

export type LineEnding = "LF" | "CRLF" | "CR";

export type DocumentMode =
  | "normal-edit"
  | "large-edit"
  | "large-readonly"
  | "binary-preview";

export interface OpenDocument {
  id: DocumentId;
  path?: string;
  title: string;
  content: string;
  encoding: TextEncoding;
  detectedEncoding?: TextEncoding;
  lineEnding: LineEnding;
  languageId: string;
  mode: DocumentMode;
  isDirty: boolean;
  isReadonly: boolean;
  isUntitled: boolean;
  isPinned?: boolean;
  lastAccessedAt?: number;
  fileSize?: number;
  lastSavedAt?: number;
  lastKnownModifiedAt?: number;
}

export interface EditorTab {
  id: string;
  documentId: DocumentId;
  title: string;
  pinned: boolean;
  active: boolean;
  order: number;
}

export interface AppSession {
  version: number;
  lastOpenedAt: number;
  windowState: {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
  };
  openTabs: Array<{
    path?: string;
    title: string;
    pinned: boolean;
    active: boolean;
  }>;
  recentFiles: string[];
}

export interface AppSettings {
  theme: "dark" | "light" | "system";
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  showLineNumbers: boolean;
  showMinimap: boolean;
  defaultEncoding: TextEncoding;
  defaultLineEnding: LineEnding;
  restoreSessionOnStartup: boolean;
  autoSaveRecoveryDraft: boolean;
}
