type IconSize = "sm" | "md";

interface Props { languageId: string; size?: IconSize }

// Distinctive SVG icon paths for each language type
const ICON = {
  // Generic file icons by category
  document:   { path: "M2 1h5.5L12 5.5V14a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: "M12 5.5H6.5V1", decor: null },
  code:       { path: "M2 1h5.5L12 5.5V14a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: "M12 5.5H6.5V1", decor: "M5.5 8.5l-2 2 2 2M10.5 8.5l2 2-2 2" },
  window:     { path: "M1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11z", doc: null, decor: "M2 5h12M5 2v3" },
  gear:       { path: "M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 10a2 2 0 100-4 2 2 0 000 4z", doc: null, decor: null },
  terminal:   { path: "M2 1h12a1 1 0 011 1v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: null, decor: "M4.5 5.5l3 2.5-3 2.5M8.5 10.5h3" },
  cube:       { path: "M8 1l6 3v8l-6 3-6-3V4l6-3z", doc: null, decor: "M8 1v14M2 4l6 3M14 4l-6 3" },
  note:       { path: "M2 1h5.5L12 5.5V14a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: "M12 5.5H6.5V1", decor: "M5 8.5h4M5 10h3M5 11.5h4" },
  json:       { path: "M2 1h5.5L12 5.5V14a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: "M12 5.5H6.5V1", decor: "M6.5 8l-1.5 2 1.5 2M9.5 8l1.5 2-1.5 2" },
  diff:       { path: "M2 1h12a1 1 0 011 1v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z", doc: null, decor: "M5 5h6M5 8h6M5 11h6M5.5 6.5l2.5-3 2.5 3M5.5 9.5l2.5 3 2.5-3" },
  // Folder
  folder:     { path: "M1 3.5A1.5 1.5 0 012.5 2h2.764a1.5 1.5 0 011.2.6l.936 1.248a.5.5 0 00.4.2H14a1 1 0 011 1v7.5a1 1 0 01-1 1H2.5A1.5 1.5 0 011 12V3.5z", doc: null, decor: null },
  search:     { path: "M11.5 6.5a5 5 0 11-10 0 5 5 0 0110 0zm-.56 4.94a6.5 6.5 0 111.06-1.06l3.31 3.31a.75.75 0 11-1.06 1.06l-3.31-3.31z", doc: null, decor: null },
  gem:        { path: "M8 1L1 5v6l7 4 7-4V5L8 1zm0 1.5L12.5 5 8 8 3.5 5 8 2.5z", doc: null, decor: "M1 5l7 10M15 5L8 15" },
} as const;

const COLORS: Record<string, string> = {
  javascript: "#f0db4f", jsx: "#f0db4f", typescript: "#3178c6", tsx: "#3178c6",
  html: "#e34f26", css: "#1572b6", python: "#3776ab", rust: "#dea584",
  json: "#bd93f9", markdown: "#42a5f5", xml: "#ff9800", sql: "#e38c00",
  yaml: "#6aad5c", go: "#00add8", java: "#b07219", c: "#a8b9cc",
  cpp: "#00599c", csharp: "#953dac", shell: "#4eaa25",
  plaintext: "#969696", log: "#78909c", csv: "#43a047", diff: "#78909c",
  php: "#777bb4", ruby: "#cc342d", kotlin: "#7f52ff", swift: "#fe5e2f",
  dockerfile: "#2496ed", powershell: "#5391fe", dotenv: "#f9a825",
};

// Map language to icon variant
const ICON_MAP: Record<string, keyof typeof ICON> = {
  javascript: "cube", jsx: "cube", typescript: "cube", tsx: "cube",
  html: "window", css: "window", python: "window", rust: "gear",
  json: "json", markdown: "note", xml: "code", sql: "window",
  yaml: "document", go: "gear", java: "window",
  c: "gear", cpp: "gear", csharp: "window",
  shell: "terminal", powershell: "terminal", plaintext: "document",
  log: "document", csv: "document", diff: "diff",
  php: "window", ruby: "gem", kotlin: "window",
  swift: "window", dockerfile: "window", dotenv: "document",
};

function extToLang(name: string): string {
  const e = name.split(".").pop()?.toLowerCase();
  const m: Record<string, string> = {
    js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
    html: "html", css: "css", py: "python", rs: "rust",
    json: "json", md: "markdown", xml: "xml", sql: "sql",
    yaml: "yaml", yml: "yaml", go: "go", java: "java",
    c: "c", cpp: "cpp", cs: "csharp", sh: "shell",
    log: "log", csv: "csv", diff: "diff", patch: "diff",
    php: "php", rb: "ruby", kt: "kotlin", swift: "swift",
    ps1: "powershell", dockerfile: "dockerfile", env: "dotenv",
  };
  return m[e ?? ""] ?? "plaintext";
}

export default function FileIcon({ languageId, size = "sm" }: Props) {
  const dim = size === "md" ? 18 : 16;
  const style = ICON_MAP[languageId] ?? "document";
  const icon = ICON[style] ?? ICON.document;
  const color = COLORS[languageId] ?? "#969696";

  return (
    <span className="flex items-center justify-center flex-shrink-0 leading-none">
      <svg width={dim} height={dim} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d={icon.path} fill={color} opacity="0.85" />
        {icon.doc && <path d={icon.doc} fill={color} opacity="0.4" />}
        {icon.decor && <path d={icon.decor} stroke="#fff" strokeWidth="0.8" fill="none" opacity="0.8" />}
      </svg>
    </span>
  );
}

export function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="flex items-center justify-center flex-shrink-0 leading-none">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d={ICON.folder.path} fill="#fab387" />
      </svg>
    </span>
  );
}

export { extToLang, COLORS };
