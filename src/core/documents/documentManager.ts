import type { DocumentId, OpenDocument } from "./documentTypes";

let nextId = 1;

export function generateDocumentId(): DocumentId {
  return `doc_${nextId++}_${Date.now()}`;
}

export function createUntitledDocument(): OpenDocument {
  return {
    id: generateDocumentId(),
    title: `新文件 ${nextId - 1}`,
    content: "",
    encoding: "utf-8",
    lineEnding: "LF",
    languageId: "plaintext",
    mode: "normal-edit",
    isDirty: false,
    isReadonly: false,
    isUntitled: true,
  };
}

export function detectLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    py: "python",
    rs: "rust",
    md: "markdown",
    xml: "xml",
    svg: "xml",
    yaml: "yaml",
    yml: "yaml",
    sql: "sql",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    sh: "shell",
    bash: "shell",
    ps1: "powershell",
    bat: "batch",
    cfg: "ini",
    ini: "ini",
    env: "dotenv",
    toml: "toml",
    dockerfile: "dockerfile",
    csv: "csv",
    log: "log",
    diff: "diff",
    patch: "diff",
  };
  return langMap[ext ?? ""] ?? "plaintext";
}
