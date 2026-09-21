import type { DocumentId, OpenDocument } from "./documentTypes";

let nextId = 1;

export function generateDocumentId(): DocumentId {
  return `doc_${nextId++}_${Date.now()}`;
}

/**
 * 生成下一个未命名文件的标题（如"新文件 1"、"新文件 2"），
 * 并递增内部计数器，确保与新建文件不重名。
 * 用于恢复未保存的草稿时分配标题。
 */
export function nextUntitledTitle(): string {
  return `新文件 ${nextId++}`;
}

/** Ensure newly-created documents do not reuse a restored untitled title. */
export function reserveUntitledTitle(title: string): void {
  const match = /^新文件 (\d+)$/.exec(title);
  if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
}

/** Recover the original untitled title used before drafts stored titles explicitly. */
export function untitledTitleFromDocumentId(id: string): string | undefined {
  const match = /^doc_(\d+)_\d+$/.exec(id);
  return match ? `新文件 ${match[1]}` : undefined;
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
