import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLineGutter, rectangularSelection, scrollPastEnd } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, completionKeymap, autocompletion } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { FileText, Settings, X, Search, FileSearch, Replace, HelpCircle } from "lucide-react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { useUIStore, themes } from "../../stores/uiStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { getSelectedPath } from "../../stores/fileTreeStore";
import type { TreeNode } from "../../stores/fileTreeStore";
import { listDirectory, openFile, addRecentFile, createFile, createDirectory, deleteFileOrDir, renameFile, revealInExplorer, moveFileOrDir, copyFileOrDir } from "../../lib/ipc";
import { detectLanguage } from "../../core/documents/documentManager";
import * as textTools from "../../core/textTools";
import type { OpenDocument } from "../../core/documents/documentTypes";
import FileIcon, { FolderIcon, extToLang } from "../FileIcon";
import { useContextMenu } from "../ContextMenu";
import type { ContextMenuItem } from "../ContextMenu";
import SettingsModal from "../SettingsModal";

// Normalize path for case-insensitive comparison (Windows paths can differ in case/separators/canonical prefix)
const normPath = (p: string) => p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
// Track files being opened to prevent duplicate tabs from rapid clicks (race condition guard)
const openingPaths = new Set<string>();
// File clipboard for copy/paste in file tree
let clipboardPath: string | null = null;
let clipboardIsCut: boolean = false;
// Module-level flag: suppress click right after a drag (shared across all TN instances)
let dragJustEnded = false;
// Module-level ref to the currently active CodeMirror EditorView for FindPanel
let activeCMView: EditorView | null = null;

interface Props { onNewFile: () => void; onOpenFile: () => void; onSaveFile: () => void; onOpenRecent: (path: string) => void; recentFiles: string[]; }

export default function AppLayout({ onNewFile, onOpenFile, onSaveFile, onOpenRecent, recentFiles }: Props) {
  const theme = useUIStore((s) => s.theme);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarView = useUIStore((s) => s.sidebarView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarView = useUIStore((s) => s.setSidebarView);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className={`h-full flex flex-col theme-${theme}`} onContextMenu={(e) => e.preventDefault()}>
      <TitleBar onNewFile={onNewFile} onOpenFile={onOpenFile} onSaveFile={onSaveFile} onOpenRecent={onOpenRecent} recentFiles={recentFiles} />
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar sidebarOpen={sidebarOpen} sidebarView={sidebarView} onToggle={toggleSidebar} onViewChange={setSidebarView} onOpenSettings={() => setSettingsOpen(true)} />
        {sidebarOpen && (
          <div style={{ width: 240, backgroundColor: "var(--sidebar)", borderRight: "1px solid var(--border)" }} className="flex flex-col">
            <div className="flex items-center px-3 h-8 text-[11px] font-medium flex-shrink-0 border-b"
              style={{ backgroundColor: "var(--sidebar-header)", color: "var(--text-secondary)", borderColor: "var(--border)" }}>
              {sidebarView === "files" ? "打开的文件" : "文件夹"}
            </div>
            <div className="flex-1 overflow-y-auto">
              {sidebarView === "files" ? <OpenFiles onNewFile={onNewFile} /> : <FileTreeComp />}
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "var(--bg-primary)" }}>
          <TabBar />
          <EditorSection onNewFile={onNewFile} onOpenFile={onOpenFile} />
        </div>
      </div>
      <StatusBarComp />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ===== Title Bar =====
function TitleBar({ onNewFile, onOpenFile, onSaveFile, onOpenRecent, recentFiles }: Props) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const activeDocId = useDocumentStore((s) => s.activeDocumentId);
  const docs = useDocumentStore((s) => s.documents);
  const activeDoc = activeDocId ? docs.get(activeDocId) : undefined;
  const setLang = useDocumentStore((s) => s.setLanguage);
  const setEnc = useDocumentStore((s) => s.setEncoding);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const langs = ["plaintext","javascript","typescript","jsx","tsx","html","css","python","rust","json","markdown","xml","sql","yaml","go","java","c","cpp"];
  const encs = ["utf-8","utf-8-bom","utf-16le","utf-16be","gbk","latin1"];

  const runTool = (fn: (docId: string) => void) => {
    if (activeDocId) { fn(activeDocId); setMenuOpen(null); }
  };

  const fileMenuItems = [
    { label: "新建", sc: "Ctrl+N", onClick: onNewFile },
    { label: "打开", sc: "Ctrl+O", onClick: onOpenFile },
    { label: "保存", sc: "Ctrl+S", onClick: onSaveFile },
    ...(recentFiles.length > 0 ? [{ sep: "最近文件" }] : []),
    ...recentFiles.slice(0, 10).map((f) => ({
      label: f.split("\\").pop()?.split("/").pop() ?? f,
      title: f,
      onClick: () => { onOpenRecent(f); setMenuOpen(null); },
    })),
    { sep: "" },
    { label: "退出", onClick: () => window.close() },
  ];

  return (
    <div ref={ref} style={{ height: 28, backgroundColor: "var(--title-bar)" }} className="flex items-center px-2 select-none flex-shrink-0">
      <span className="text-[12px] font-medium mr-4" style={{ color: "#999" }}>Textlume</span>
      {["file","view","encoding","language","tools"].map((key) => (
        <div key={key} className="relative">
          <button onClick={() => setMenuOpen(menuOpen === key ? null : key)}
            className="px-2 py-0.5 text-[11px]" style={{ color: menuOpen === key ? "#fff" : "#969696", backgroundColor: menuOpen === key ? "var(--bg-hover)" : "transparent" }}>
            {key === "file" ? "文件" : key === "view" ? "视图" : key === "encoding" ? "编码" : key === "language" ? "语言" : "工具"}
          </button>
          {menuOpen === key && (
            <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", minWidth: 160 }}
              className="absolute top-full left-0 z-50 py-1 shadow-lg">
              {(key === "file" ? fileMenuItems :
                key === "view" ? [
                { label: "侧边栏", onClick: () => { toggleSidebar(); setMenuOpen(null); } },
                { sep: "主题" },
                ...themes.map((t) => ({ label: t.label, checked: theme === t.id, onClick: () => { setTheme(t.id); setMenuOpen(null); } })),
              ] : key === "encoding" ? encs.map((e) => ({ label: e, checked: activeDoc?.encoding === e, onClick: () => { if (activeDocId) { setEnc(activeDocId, e as any); setMenuOpen(null); } } })) :
                key === "language" ? langs.map((l) => ({ label: l, checked: activeDoc?.languageId === l, onClick: () => { if (activeDocId) { setLang(activeDocId, l); setMenuOpen(null); } } })) :
                // Tools menu
                [
                  { label: "大写", sep: "大小写转换", onClick: () => runTool(textTools.toUpperCase) },
                  { label: "小写", onClick: () => runTool(textTools.toLowerCase) },
                  { label: "首字母大写", onClick: () => runTool(textTools.toTitleCase) },
                  { sep: "行操作" },
                  { label: "删除空行", onClick: () => runTool(textTools.removeEmptyLines) },
                  { label: "去重行", onClick: () => runTool(textTools.removeDuplicateLines) },
                  { label: "升序排序", onClick: () => runTool((id) => textTools.sortLines(id, false)) },
                  { label: "降序排序", onClick: () => runTool((id) => textTools.sortLines(id, true)) },
                  { label: "反转行序", onClick: () => runTool(textTools.reverseLines) },
                  { label: "合并行", onClick: () => runTool(textTools.joinLines) },
                  { sep: "JSON" },
                  { label: "JSON 格式化", onClick: () => runTool(textTools.formatJson) },
                  { label: "JSON 压缩", onClick: () => runTool(textTools.minifyJson) },
                  { sep: "Base64" },
                  { label: "Base64 编码", onClick: () => runTool(textTools.encodeBase64) },
                  { label: "Base64 解码", onClick: () => runTool(textTools.decodeBase64) },
                ]
              ).map((item: any, i: number) => {
                if (item.sep) {
                  return <div key={i} className="px-3 py-1 text-[10px] font-medium" style={{ color: "var(--text-tertiary)", opacity: 0.6 }}>{item.sep}</div>;
                }
                return (
                <button key={i} onClick={item.onClick} title={item.title}
                  className="w-full flex items-center gap-3 px-3 py-1.5 text-[12px] text-left"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.checked && <span style={{ color: "var(--accent)" }}>✓</span>}
                  {item.sc && <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{item.sc}</span>}
                </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <div className="flex-1" />
      <HelpMenu />
    </div>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) { document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} title="帮助"
        className="flex items-center gap-0.5 px-2 py-0.5 text-[11px]" style={{ color: open ? "#fff" : "#969696", backgroundColor: open ? "var(--bg-hover)" : "transparent" }}>
        <HelpCircle size={12} />帮助
      </button>
      {open && (
        <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", minWidth: 140 }}
          className="absolute top-full right-0 z-50 py-1 shadow-lg">
          <button onClick={() => { setVersionOpen(true); setOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-1.5 text-[12px] text-left" style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
            <span className="flex-1">版本</span>
          </button>
          <button onClick={() => { setHelpOpen(true); setOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-1.5 text-[12px] text-left" style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
            <span className="flex-1">操作说明</span>
          </button>
        </div>
      )}
      {versionOpen && <VersionModal onClose={() => setVersionOpen(false)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function VersionModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-lg shadow-xl p-6 w-[340px] animate-fade-in" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>关于 Textlume</h3>
          <button onClick={onClose} className="p-0.5 hover:bg-[var(--bg-hover)] rounded" style={{ color: "var(--text-tertiary)" }}><X size={14} /></button>
        </div>
        <div className="space-y-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--text-tertiary)" }}>版本</span>
            <span style={{ color: "var(--text-primary)" }}>v0.1.0</span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--text-tertiary)" }}>作者</span>
            <span style={{ color: "var(--text-primary)" }}>Textlume Team</span>
          </div>
          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>基于 Tauri v2 + React + CodeMirror 6 构建</p>
            <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>轻量、快速的跨平台文本编辑器</p>
          </div>
        </div>
        <button onClick={onClose}
          className="mt-4 w-full px-4 py-1.5 text-[12px] rounded" style={{ backgroundColor: "var(--accent)", color: "#fff" }}>确定</button>
      </div>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-lg shadow-xl p-6 w-[420px] max-h-[70vh] overflow-y-auto animate-fade-in" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>操作说明</h3>
          <button onClick={onClose} className="p-0.5 hover:bg-[var(--bg-hover)] rounded" style={{ color: "var(--text-tertiary)" }}><X size={14} /></button>
        </div>
        <div className="space-y-3 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {[
            { keys: "Ctrl+N", desc: "新建文件" },
            { keys: "Ctrl+O", desc: "打开文件" },
            { keys: "Ctrl+S", desc: "保存文件" },
            { keys: "Ctrl+W", desc: "关闭当前标签" },
            { keys: "Ctrl+B", desc: "切换侧边栏" },
            { keys: "Ctrl+F", desc: "当前文件内查找" },
            { keys: "Ctrl+H", desc: "当前文件内替换" },
            { keys: "Ctrl+Shift+F", desc: "全局文件搜索" },
            { keys: "Ctrl+Tab", desc: "切换标签页" },
            { keys: "Ctrl+C / Ctrl+V", desc: "文件树中复制/粘贴文件" },
            { keys: "Ctrl+X", desc: "文件树中剪切文件" },
            { keys: "Delete", desc: "文件树中删除选中文件" },
            { keys: "Esc", desc: "关闭查找面板 / 取消剪切" },
          ].map(({ keys, desc }) => (
            <div key={keys} className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 text-[11px] rounded flex-shrink-0" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--accent)", fontFamily: "monospace" }}>{keys}</span>
              <span>{desc}</span>
            </div>
          ))}
          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              拖拽文件到文件夹节点即可移动。右键文件树查看更多操作。Markdown 文件支持实时预览。
            </p>
          </div>
        </div>
        <button onClick={onClose}
          className="mt-4 w-full px-4 py-1.5 text-[12px] rounded" style={{ backgroundColor: "var(--accent)", color: "#fff" }}>确定</button>
      </div>
    </div>
  );
}

function ActivityBar({ sidebarOpen, sidebarView, onToggle, onViewChange, onOpenSettings }: {
  sidebarOpen: boolean; sidebarView: string; onToggle: () => void; onViewChange: (v: "files" | "folder") => void; onOpenSettings: () => void;
}) {
  return (
    <div style={{ width: 48, backgroundColor: "var(--activity-bar)" }} className="flex flex-col items-center py-2 gap-2 flex-shrink-0">
      <ActBtn icon={<FileText size={20} />} active={sidebarOpen && sidebarView === "files"} title="文件"
        onClick={() => { if (sidebarOpen && sidebarView === "files") onToggle(); else { if (!sidebarOpen) onToggle(); onViewChange("files"); } }} />
      <ActBtn icon={<FolderIcon size={20} />} active={sidebarOpen && sidebarView === "folder"} title="文件夹"
        onClick={() => { if (sidebarOpen && sidebarView === "folder") onToggle(); else { if (!sidebarOpen) onToggle(); onViewChange("folder"); } }} />
      <div className="flex-1" />
      <ActBtn icon={<Settings size={20} />} active={false} title="设置" onClick={onOpenSettings} />
    </div>
  );
}

function ActBtn({ icon, active, title, onClick }: { icon: React.ReactNode; active: boolean; title: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={title}
      className="relative flex items-center justify-center w-full h-10"
      style={{ color: active ? "var(--activity-bar-active)" : "var(--activity-bar-inactive)", borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent" }}>
      {icon}
    </button>
  );
}

function OpenFiles({ onNewFile }: { onNewFile: () => void }) {
  const docs = useDocumentStore((s) => s.documents);
  const activeId = useDocumentStore((s) => s.activeDocumentId);
  const setActive = useDocumentStore((s) => s.setActiveDocument);
  const closeDoc = useDocumentStore((s) => s.closeDocument);
  const renameDoc = useDocumentStore((s) => s.renameDocument);
  const arr = Array.from(docs.values());
  const fileCtx = useContextMenu();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); } }, [renamingId]);

  if (arr.length === 0) return (
    <div className="flex items-center justify-center h-full text-[13px]" style={{ color: "var(--text-tertiary)" }}
      onContextMenu={(e) => { e.preventDefault(); fileCtx.show(e, [
        { label: "新建文件", shortcut: "Ctrl+N", onClick: onNewFile },
      ]); }}>
      暂无文件
      {fileCtx.menu}
    </div>
  );

  const startRename = (id: string, title: string) => { setRenamingId(id); setRenameVal(title); };
  const commitRename = () => { if (renamingId && renameVal.trim()) renameDoc(renamingId, renameVal.trim()); setRenamingId(null); };

  return (
    <div className="py-0.5 h-full"
      onContextMenu={(e) => { e.preventDefault(); fileCtx.show(e, [
        { label: "新建文件", shortcut: "Ctrl+N", onClick: onNewFile },
        { separator: true, label: "" },
        { label: "关闭所有", onClick: () => arr.forEach((d) => closeDoc(d.id)) },
      ]); }}>
      {arr.map((doc) => {
        const act = doc.id === activeId;
        const isRenaming = doc.id === renamingId;
        const menuItems: ContextMenuItem[] = [
          { label: "关闭", onClick: () => closeDoc(doc.id) },
          { label: "关闭其他", onClick: () => arr.filter((d) => d.id !== doc.id).forEach((d) => closeDoc(d.id)) },
          { label: "关闭所有", onClick: () => arr.forEach((d) => closeDoc(d.id)) },
          { separator: true, label: "" },
          { label: "重命名", onClick: () => startRename(doc.id, doc.title) },
          { label: "复制路径", onClick: () => doc.path && navigator.clipboard.writeText(doc.path) },
        ];
        return (
          <div key={doc.id} onClick={() => { if (!isRenaming) setActive(doc.id); }}
            onContextMenu={(e) => fileCtx.show(e, menuItems)}
            className="flex items-center gap-2 px-3 py-1 text-[13px] cursor-pointer"
            style={{ backgroundColor: act ? "var(--sidebar-active)" : "transparent", color: act ? "var(--sidebar-active-text)" : "#ccc" }}
            onMouseEnter={(e) => { if (!act) e.currentTarget.style.backgroundColor = "var(--sidebar-hover)"; }}
            onMouseLeave={(e) => { if (!act) e.currentTarget.style.backgroundColor = "transparent"; }}>
            <FileIcon languageId={doc.languageId} />
            {isRenaming ? (
              <input ref={renameRef} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 px-1 py-0 text-[13px] outline-none border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-focus-border)" }} />
            ) : (
              <span className="truncate flex-1">{doc.title}</span>
            )}
            {doc.isDirty && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--yellow)" }} />}
          </div>
        );
      })}
      {fileCtx.menu}
    </div>
  );
}

function FileTreeComp() {
  const root = useFileTreeStore((s) => s.root);
  const tree = useFileTreeStore((s) => s.tree);
  const expanded = useFileTreeStore((s) => s.expanded);
  const setRoot = useFileTreeStore((s) => s.setRoot);
  const setTree = useFileTreeStore((s) => s.setTree);
  const toggleExpanded = useFileTreeStore((s) => s.toggleExpanded);
  const setChildren = useFileTreeStore((s) => s.setChildren);
  const openDoc = useDocumentStore((s) => s.openDocument);
  const treeCtx = useContextMenu();

  // Root-level new file/folder creation state
  const [creatingType, setCreatingType] = useState<"file" | "dir" | null>(null);
  const [createVal, setCreateVal] = useState("");
  const createRef = useRef<HTMLInputElement>(null);
  const [isRootDragOver, setIsRootDragOver] = useState(false);
  useEffect(() => { if (creatingType && createRef.current) { createRef.current.focus(); } }, [creatingType]);

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRootDragOver(false);
    const srcPath = e.dataTransfer.getData("text/plain");
    if (!srcPath || !root) return;
    if (srcPath === root || root.startsWith(srcPath + "\\") || root.startsWith(srcPath + "/")) return;
    const sepIdx = Math.max(srcPath.lastIndexOf("\\"), srcPath.lastIndexOf("/"));
    const srcParent = sepIdx > 0 ? srcPath.substring(0, sepIdx) : "";
    if (normPath(srcParent) === normPath(root)) return;
    try {
      const newPath = await moveFileOrDir(srcPath, root);
      // 清除选中状态（拖拽的源已被移动）
      useFileTreeStore.getState().setSelectedPath(null);
      if (srcParent) await refreshDir(srcParent);
      await refreshRoot();
      const normSrc = normPath(srcPath);
      for (const [id, doc] of useDocumentStore.getState().documents) {
        if (doc.path && normPath(doc.path) === normSrc) {
          useDocumentStore.getState().updateDocumentPath(id, newPath);
          break;
        }
      }
    } catch (err) { console.error("移动失败:", err); alert(`移动失败: ${err}`); }
  };

  // 共享粘贴逻辑：将剪贴板中的文件粘贴到目标目录
  const doPasteToDir = async (destDir: string) => {
    if (!clipboardPath) return;
    if (clipboardPath === destDir || destDir.startsWith(clipboardPath + "\\") || destDir.startsWith(clipboardPath + "/")) return;
    try {
      if (clipboardIsCut) {
        const newPath = await moveFileOrDir(clipboardPath, destDir);
        // 刷新源目录和目标目录
        const srcSep = Math.max(clipboardPath.lastIndexOf("\\"), clipboardPath.lastIndexOf("/"));
        const srcParent = srcSep > 0 ? clipboardPath.substring(0, srcSep) : "";
        if (srcParent) await refreshDir(srcParent);
        await refreshDir(destDir);
        // 如果剪切的是目录树中已展开的目录，折叠它
        if (clipboardPath) useFileTreeStore.getState().toggleExpanded(clipboardPath);
        // 更新已打开文档的路径
        const normSrc = normPath(clipboardPath);
        for (const [id, doc] of useDocumentStore.getState().documents) {
          if (doc.path && normPath(doc.path) === normSrc) {
            useDocumentStore.getState().updateDocumentPath(id, newPath);
            break;
          }
        }
        clipboardPath = null;
        clipboardIsCut = false;
        useFileTreeStore.getState().setSelectedPath(null);
      } else {
        await copyFileOrDir(clipboardPath, destDir);
        await refreshDir(destDir);
      }
    } catch (e) { console.error("粘贴失败:", e); alert(`粘贴失败: ${e}`); }
  };

  const doPasteToRoot = async () => {
    if (!root) return;
    await doPasteToDir(root);
  };

  const doCreateAtRoot = async () => {
    if (!creatingType || !createVal.trim() || !root) { setCreatingType(null); setCreateVal(""); return; }
    try {
      const sep = root.includes("/") && !root.includes("\\") ? "/" : "\\";
      const newPath = `${root}${sep}${createVal.trim()}`;
      if (creatingType === "file") { await createFile(newPath); } else { await createDirectory(newPath); }
      await refreshRoot();
    } catch (e) { console.error("创建失败:", e); }
    setCreatingType(null);
    setCreateVal("");
  };

  const ld = async (p: string) => { try { const e = await listDirectory(p); return e.map((x: any) => ({ ...x, children: x.is_dir ? [] : undefined })); } catch { return []; } };

  // 防竞态：跟踪每个路径的加载版本号，防止过时的 setChildren 覆盖新数据
  const loadVersion = useRef(new Map<string, number>());
  const versionCounter = useRef(0);

  const refreshDir = async (dirPath: string) => {
    const children = await ld(dirPath);
    const expandedSet = useFileTreeStore.getState().expanded;
    
    // 辅助函数：检查路径是否已展开（使用 normPath 比较）
    const isExpanded = (path: string) => {
      const pathNorm = normPath(path);
      for (const expandedPath of expandedSet) {
        if (normPath(expandedPath) === pathNorm) return true;
      }
      return false;
    };
    
    // 递归处理：对于已展开的子目录，重新加载其 children
    const loadExpandedChildren = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      const result: TreeNode[] = [];
      for (const n of nodes) {
        if (n.is_dir && isExpanded(n.path)) {
          // 重新加载已展开目录的 children
          const subChildren = await ld(n.path);
          const loadedSubChildren = await loadExpandedChildren(subChildren);
          result.push({ ...n, children: loadedSubChildren });
        } else {
          result.push(n);
        }
      }
      return result;
    };
    
    const finalChildren = await loadExpandedChildren(children);
    
    // 根目录的子节点直接存在 tree 中，不是某个节点的 children
    if (normPath(dirPath) === normPath(root)) {
      setTree(finalChildren);
    } else {
      setChildren(dirPath, finalChildren);
    }
  };

  const refreshRoot = async () => {
    if (!root) return;
    // 与 refreshDir 共用递归逻辑：保留已展开子目录的 children
    await refreshDir(root);
  };

  const toggle = async (p: string) => {
    if (expanded.has(p)) {
      toggleExpanded(p);
    } else {
      toggleExpanded(p);
      const id = ++versionCounter.current;
      loadVersion.current.set(p, id);
      const c = await ld(p);
      // 只有当前路径没有更新的加载请求时才应用结果，防止过时数据覆盖
      if (loadVersion.current.get(p) === id) {
        setChildren(p, c);
      }
    }
  };

  const openf = async (fp: string) => {
    const normFp = normPath(fp);
    // Guard against race condition: skip if already opening this file
    if (openingPaths.has(normFp)) return;
    // Check if already open
    const existing = Array.from(useDocumentStore.getState().documents.entries()).find(([, d]) => d.path && normPath(d.path) === normFp);
    if (existing) { useDocumentStore.getState().setActiveDocument(existing[0]); return; }
    openingPaths.add(normFp);
    try {
      const info = await openFile(fp);
      // Re-check after async: another call may have completed while we waited
      const existing2 = Array.from(useDocumentStore.getState().documents.entries()).find(([, d]) => d.path && normPath(d.path) === normFp);
      if (existing2) { useDocumentStore.getState().setActiveDocument(existing2[0]); return; }
      const d: OpenDocument = { id: `doc_${Date.now()}`, path: info.path, title: info.path.split("\\").pop()?.split("/").pop() ?? "?", content: info.content, encoding: (info.encoding as any) ?? "utf-8", lineEnding: (info.lineEnding as any) ?? "LF", languageId: info.languageId || detectLanguage(info.path), mode: info.fileSize > 10_000_000 ? "large-edit" : "normal-edit", isDirty: false, isReadonly: info.isReadonly, isUntitled: false, fileSize: info.fileSize, lastSavedAt: info.lastModifiedAt, lastKnownModifiedAt: info.lastModifiedAt };
      openDoc(d);
      addRecentFile(info.path).catch(() => {});
    } catch { /* */ }
    finally { openingPaths.delete(normFp); }
  };

  const sel = async () => {
    try {
      const s = await dialogOpen({ directory: true, multiple: false });
      if (s) {
        const path = s as string;
        setRoot(path);
        const entries = await ld(path);
        setTree(entries);
        // Persist to localStorage
        localStorage.setItem("textlume-last-folder", path);
      }
    } catch { /* */ }
  };

  // Restore last folder on mount
  useEffect(() => {
    const lastFolder = localStorage.getItem("textlume-last-folder");
    if (lastFolder && !root) {
      setRoot(lastFolder);
      ld(lastFolder).then(setTree);
    }
  }, []);

  // 键盘快捷键：Ctrl+C 复制, Ctrl+X 剪切, Ctrl+V 粘贴, Delete 删除
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 仅在有根目录且不在输入框内时响应（不依赖焦点，因为树节点 div 不可聚焦）
      if (!root) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "c" && !e.shiftKey) {
        e.preventDefault();
        const sel = getSelectedPath();
        if (sel) { clipboardPath = sel; clipboardIsCut = false; }
      } else if (mod && e.key === "x" && !e.shiftKey) {
        e.preventDefault();
        const sel = getSelectedPath();
        if (sel) { clipboardPath = sel; clipboardIsCut = true; }
      } else if (mod && e.key === "v" && !e.shiftKey) {
        e.preventDefault();
        if (!clipboardPath) return;
        const st = useFileTreeStore.getState();
        // 决定粘贴目标：优先使用选中路径（如果是目录），否则用选中路径的父目录，否则根目录
        let target = st.root;
        if (st.selectedPath) {
          // 在树中查找该路径对应的节点判断是否为目录
          const findNode = (nodes: TreeNode[]): TreeNode | null => {
            for (const n of nodes) {
              if (normPath(n.path) === normPath(st.selectedPath!)) return n;
              if (n.children) { const f = findNode(n.children); if (f) return f; }
            }
            return null;
          };
          const node = findNode(st.tree);
          if (node && node.is_dir) {
            target = node.path;
          } else {
            const i = Math.max(st.selectedPath.lastIndexOf("\\"), st.selectedPath.lastIndexOf("/"));
            if (i > 0) target = st.selectedPath.substring(0, i);
          }
        }
        if (target) doPasteToDir(target);
      } else if (e.key === "Delete") {
        e.preventDefault();
        const sel = getSelectedPath();
        if (!sel) return;
        // 树中查找节点以获取名称和类型
        const findN = (nodes: TreeNode[]): TreeNode | null => {
          for (const n of nodes) {
            if (normPath(n.path) === normPath(sel)) return n;
            if (n.children) { const f = findN(n.children); if (f) return f; }
          }
          return null;
        };
        const targetNode = findN(tree);
        if (!targetNode) return;
        if (!confirm(`确定删除 ${targetNode.is_dir ? "文件夹" : "文件"} "${targetNode.name}" 吗？`)) return;
        deleteFileOrDir(sel).then(async () => {
          useFileTreeStore.getState().setSelectedPath(null);
          const si = Math.max(sel.lastIndexOf("\\"), sel.lastIndexOf("/"));
          const pd = si > 0 ? sel.substring(0, si) : "";
          if (pd) await refreshDir(pd);
          if (!targetNode.is_dir) {
            const normDel = normPath(sel);
            const d = useDocumentStore.getState().documents;
            for (const [id, doc] of d) {
              if (doc.path && normPath(doc.path) === normDel) { useDocumentStore.getState().closeDocument(id); break; }
            }
          }
        }).catch((e) => console.error("删除失败:", e));
      } else if (e.key === "Escape") {
        // Esc 清除剪贴板
        if (clipboardPath) { clipboardPath = null; clipboardIsCut = false; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [root]);

  if (!root) return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-4"
      onContextMenu={(e) => {
        e.preventDefault();
        treeCtx.show(e, [{ label: "打开文件夹", onClick: sel }]);
      }}>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>未打开文件夹</p>
      <button onClick={sel} className="px-3 py-1 text-[11px]" style={{ backgroundColor: "var(--accent)", color: "#fff" }}>选择文件夹</button>
      {treeCtx.menu}
    </div>
  );

  return (
    <div ref={treeRef} tabIndex={0} className="py-0.5 text-[13px] h-full outline-none"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsRootDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsRootDragOver(false); }}
      onDrop={handleRootDrop}
      style={{ outline: isRootDragOver ? "1px dashed var(--accent)" : undefined }}
      onContextMenu={(e) => {
        const items: ContextMenuItem[] = [
          { label: "新建文件", onClick: () => { setCreatingType("file"); setCreateVal(""); } },
          { label: "新建文件夹", onClick: () => { setCreatingType("dir"); setCreateVal(""); } },
          { separator: true, label: "" },
          { label: "刷新", onClick: () => { refreshRoot(); } },
          ...(clipboardPath ? [{ label: clipboardIsCut ? "粘贴 (移动)" : "粘贴", onClick: doPasteToRoot }] : []),
            { separator: true, label: "" },
            { label: "在文件管理器中显示", onClick: () => { revealInExplorer(root).catch(() => {}); } },
            { separator: true, label: "" },
            { label: "复制路径", onClick: () => navigator.clipboard.writeText(root) },
            { label: "复制文件夹名", onClick: () => navigator.clipboard.writeText(root.split("\\").pop()?.split("/").pop() ?? root) },
            { separator: true, label: "" },
            { label: "关闭文件夹", onClick: () => { setRoot(""); setTree([]); localStorage.removeItem("textlume-last-folder"); } },
          ];
          treeCtx.show(e, items);
        }}>
      <div
        onClick={() => { sel(); useFileTreeStore.getState().setSelectedPath(null); }}
        onContextMenu={(e) => {
          const items: ContextMenuItem[] = [
            { label: "新建文件", onClick: () => { setCreatingType("file"); setCreateVal(""); } },
            { label: "新建文件夹", onClick: () => { setCreatingType("dir"); setCreateVal(""); } },
            { separator: true, label: "" },
            { label: "刷新", onClick: () => { refreshRoot(); } },
            ...(clipboardPath ? [{ label: clipboardIsCut ? "粘贴 (移动)" : "粘贴", onClick: doPasteToRoot }] : []),
            { separator: true, label: "" },
            { label: "在文件管理器中显示", onClick: () => { revealInExplorer(root).catch(() => {}); } },
            { separator: true, label: "" },
            { label: "复制路径", onClick: () => navigator.clipboard.writeText(root) },
            { label: "复制文件夹名", onClick: () => navigator.clipboard.writeText(root.split("\\").pop()?.split("/").pop() ?? root) },
            { separator: true, label: "" },
            { label: "关闭文件夹", onClick: () => { setRoot(""); setTree([]); localStorage.removeItem("textlume-last-folder"); } },
          ];
          treeCtx.show(e, items);
        }}
        className="flex items-center gap-1.5 px-3 py-0.5 cursor-pointer" style={{ color: "#ccc" }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--sidebar-hover)"}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
        <span className="font-medium truncate">{root.split("\\").pop()?.split("/").pop()}</span>
      </div>
      {/* Inline input for creating new file/folder at root level */}
      {creatingType && (
        <div style={{ paddingLeft: `${1 * 12 + 20}px` }} className="flex items-center gap-1 py-0.5 pr-2">
          {creatingType === "file" ? <FileIcon languageId="plaintext" /> : <FolderIcon size={16} />}
          <input ref={createRef} value={createVal} onChange={(e) => setCreateVal(e.target.value)}
            onBlur={doCreateAtRoot} onKeyDown={(e) => { if (e.key === "Enter") doCreateAtRoot(); if (e.key === "Escape") { setCreatingType(null); setCreateVal(""); } }}
            placeholder={creatingType === "file" ? "文件名" : "文件夹名"}
            className="flex-1 px-1 py-0 text-[13px] outline-none border rounded"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-focus-border)" }} />
        </div>
      )}
      {tree.map((n: any) => <TN key={n.path} node={n} depth={1} expanded={expanded} gl={extToLang} refreshDir={refreshDir} onToggle={(no: any) => { if (no.is_dir) toggle(no.path); else openf(no.path); }} />)}
      {treeCtx.menu}
    </div>
  );
}

function TN({ node, depth, expanded, gl, onToggle, refreshDir }: { node: any; depth: number; expanded: Set<string>; gl: (n: string) => string; onToggle: (n: any) => void; refreshDir: (path: string) => Promise<void> }) {
  const exp = expanded.has(node.path);
  const treeCtx = useContextMenu();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [_upd, forceUpdate] = useState(0);
  const root = useFileTreeStore((s) => s.root);

  // New file/folder creation state
  const [creatingType, setCreatingType] = useState<"file" | "dir" | null>(null);
  const [createVal, setCreateVal] = useState("");
  const createRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => { if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); } }, [renamingId]);
  useEffect(() => { if (creatingType && createRef.current) { createRef.current.focus(); } }, [creatingType]);

  const targetDir = node.is_dir ? node.path : (() => { const i = Math.max(node.path.lastIndexOf("\\"), node.path.lastIndexOf("/")); return i > 0 ? node.path.substring(0, i) : ""; })();

  // Drag-and-drop: move file/folder into a directory
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
    // 设置标志，防止拖拽后触发 click 导致折叠
    dragJustEnded = true;
  };

  const handleDragEnd = () => {
    // 不立即重置标志，等待下一次点击时重置
    // 这样可以确保拖拽结束后的所有 click 事件都被阻止
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!node.is_dir) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the element itself (not entering a child)
    if (e.currentTarget === e.target) setIsDragOver(false);
    else if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const srcPath = e.dataTransfer.getData("text/plain");
    if (!srcPath || !node.is_dir) return;
    // Can't drop into self or own child
    if (srcPath === node.path || node.path.startsWith(srcPath + "\\") || node.path.startsWith(srcPath + "/")) return;
    // Already in this directory?
    const sepIdx = Math.max(srcPath.lastIndexOf("\\"), srcPath.lastIndexOf("/"));
    const srcParent = sepIdx > 0 ? srcPath.substring(0, sepIdx) : "";
    if (normPath(srcParent) === normPath(node.path)) return;
    try {
      const newPath = await moveFileOrDir(srcPath, node.path);
      // 清除选中状态（拖拽的源已被移动）
      useFileTreeStore.getState().setSelectedPath(null);
      // Refresh source and destination directories
      if (srcParent) await refreshDir(srcParent);
      await refreshDir(node.path);
      // Update open document path if the moved file was open as a tab
      const normSrc = normPath(srcPath);
      const docs = useDocumentStore.getState().documents;
      for (const [id, doc] of docs) {
        if (doc.path && normPath(doc.path) === normSrc) {
          useDocumentStore.getState().updateDocumentPath(id, newPath);
          break;
        }
      }
      // Expand the target folder so user sees the moved file (refreshDir already loaded children)
      if (!useFileTreeStore.getState().expanded.has(node.path)) {
        useFileTreeStore.getState().toggleExpanded(node.path);
      }
    } catch (err) { console.error("移动失败:", err); alert(`移动失败: ${err}`); }
  };

  const doCreate = async () => {
    if (!creatingType || !createVal.trim()) { setCreatingType(null); setCreateVal(""); return; }
    try {
      const sep = targetDir.includes("/") && !targetDir.includes("\\") ? "/" : "\\";
      const newPath = `${targetDir}${sep}${createVal.trim()}`;
      if (creatingType === "file") {
        await createFile(newPath);
      } else {
        await createDirectory(newPath);
      }
      await refreshDir(targetDir);
      // Expand parent if collapsed, so user can see the new item (refreshDir already loaded children)
      if (node.is_dir && !useFileTreeStore.getState().expanded.has(node.path)) {
        useFileTreeStore.getState().toggleExpanded(node.path);
      }
    } catch (e) { console.error("创建失败:", e); }
    setCreatingType(null);
    setCreateVal("");
  };

  const doDelete = async () => {
    if (!confirm(`确定删除 ${node.is_dir ? "文件夹" : "文件"} "${node.name}" 吗？`)) return;
    try {
      await deleteFileOrDir(node.path);
      // 清除选中状态
      useFileTreeStore.getState().setSelectedPath(null);
      // 计算父目录（兼容 \\ 和 / 两种分隔符）
      const sepIdx = Math.max(node.path.lastIndexOf("\\"), node.path.lastIndexOf("/"));
      const parentDir = sepIdx > 0 ? node.path.substring(0, sepIdx) : "";
      if (parentDir) { await refreshDir(parentDir); }
      // 如果删除的是文件且已打开为 tab，关闭对应 tab
      if (!node.is_dir) {
        const normDel = normPath(node.path);
        const docs = useDocumentStore.getState().documents;
        for (const [id, doc] of docs) {
          if (doc.path && normPath(doc.path) === normDel) {
            useDocumentStore.getState().closeDocument(id);
            break;
          }
        }
      }
    } catch (e) { console.error("删除失败:", e); }
  };

  const doRename = async () => {
    if (!renamingId || !renameVal.trim()) { setRenamingId(null); return; }
    try {
      const newPath = await renameFile(node.path, renameVal.trim());
      const sepIdx = Math.max(newPath.lastIndexOf("\\"), newPath.lastIndexOf("/"));
      const parentDir = sepIdx > 0 ? newPath.substring(0, sepIdx) : "";
      if (parentDir) { await refreshDir(parentDir); }
      forceUpdate((v) => v + 1);
    } catch (e) { console.error("重命名失败:", e); }
    setRenamingId(null);
  };

  const doPaste = async () => {
    if (!clipboardPath || !node.is_dir) return;
    // Can't paste into self or own child
    if (clipboardPath === node.path || node.path.startsWith(clipboardPath + "\\") || node.path.startsWith(clipboardPath + "/")) return;
    try {
      if (clipboardIsCut) {
        const newPath = await moveFileOrDir(clipboardPath, node.path);
        // Refresh source directory
        const srcSep = Math.max(clipboardPath.lastIndexOf("\\"), clipboardPath.lastIndexOf("/"));
        const srcParent = srcSep > 0 ? clipboardPath.substring(0, srcSep) : "";
        if (srcParent) await refreshDir(srcParent);
        // Update open document path
        const normSrc = normPath(clipboardPath);
        for (const [id, doc] of useDocumentStore.getState().documents) {
          if (doc.path && normPath(doc.path) === normSrc) {
            useDocumentStore.getState().updateDocumentPath(id, newPath);
            break;
          }
        }
        clipboardPath = null;
        clipboardIsCut = false;
        useFileTreeStore.getState().setSelectedPath(null);
      } else {
        await copyFileOrDir(clipboardPath, node.path);
      }
      await refreshDir(node.path);
      // Expand target if collapsed (refreshDir already loaded children)
      if (!useFileTreeStore.getState().expanded.has(node.path)) {
        useFileTreeStore.getState().toggleExpanded(node.path);
      }
    } catch (e) { console.error("粘贴失败:", e); alert(`粘贴失败: ${e}`); }
  };

  return (
    <div>
      <div onClick={() => {
        if (dragJustEnded) {
          dragJustEnded = false;
          return;
        }
        useFileTreeStore.getState().setSelectedPath(node.path);
        onToggle(node);
      }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          useFileTreeStore.getState().setSelectedPath(node.path);
          const relativePath = root ? node.path.replace(root, "").replace(/^[\\/]/, "") : node.path;
          const items: ContextMenuItem[] = [
            { label: node.is_dir ? "展开/折叠" : "打开", onClick: () => onToggle(node) },
            ...(node.is_dir ? [
              { separator: true, label: "" },
              { label: "新建文件", onClick: () => { setCreatingType("file"); setCreateVal(""); } },
              { label: "新建文件夹", onClick: () => { setCreatingType("dir"); setCreateVal(""); } },
              { separator: true, label: "" },
              { label: "刷新", onClick: () => { refreshDir(node.path); } },
              ...(clipboardPath ? [{ label: clipboardIsCut ? "粘贴 (移动)" : "粘贴", onClick: doPaste }] : []),
            ] : []),
            { separator: true, label: "" },
            { label: "在文件管理器中显示", onClick: () => { revealInExplorer(node.path).catch(() => {}); } },
            { separator: true, label: "" },
            { label: "复制", shortcut: "Ctrl+C", onClick: () => { clipboardPath = node.path; clipboardIsCut = false; } },
            { label: "剪切", shortcut: "Ctrl+X", onClick: () => { clipboardPath = node.path; clipboardIsCut = true; } },
            { label: "复制路径", onClick: () => navigator.clipboard.writeText(node.path) },
            { label: "复制相对路径", onClick: () => navigator.clipboard.writeText(relativePath) },
            { label: "复制文件名", onClick: () => navigator.clipboard.writeText(node.name) },
            { separator: true, label: "" },
            { label: "重命名", onClick: () => { setRenamingId(node.path); setRenameVal(node.name); } },
            { label: "删除", onClick: doDelete },
          ];
          treeCtx.show(e, items);
        }}
        className="flex items-center gap-1 py-0.5 pr-2 cursor-pointer"
        style={{ paddingLeft: `${depth * 12 + 8}px`, color: "#ccc", fontSize: 13, backgroundColor: isDragOver ? "var(--accent-muted)" : undefined, outline: isDragOver ? "1px dashed var(--accent)" : undefined }}
        onMouseEnter={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "var(--sidebar-hover)"; }}
        onMouseLeave={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "transparent"; }}>
        {node.is_dir ? <span className="text-[10px] w-4 text-center" style={{ color: "var(--text-tertiary)" }}>{exp ? "\u25bc" : "\u25b6"}</span> : <span className="w-4" />}
        {node.is_dir ? <FolderIcon size={16} /> : <FileIcon languageId={gl(node.name)} />}
        {renamingId === node.path ? (
          <input ref={renameRef} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
            onBlur={doRename} onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenamingId(null); }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1 py-0 text-[13px] outline-none border rounded"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-focus-border)" }} />
        ) : (
          <span className="truncate" style={{ color: node.is_dir ? "var(--text-secondary)" : "var(--text-primary)", opacity: clipboardIsCut && clipboardPath === node.path ? 0.4 : 1 }}>{node.name}</span>
        )}
      </div>
      {/* Inline input for creating new file/folder under a directory */}
      {creatingType && node.is_dir && (
        <div style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }} className="flex items-center gap-1 py-0.5 pr-2">
          {creatingType === "file" ? <FileIcon languageId="plaintext" /> : <FolderIcon size={16} />}
          <input ref={createRef} value={createVal} onChange={(e) => setCreateVal(e.target.value)}
            onBlur={doCreate} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); if (e.key === "Escape") { setCreatingType(null); setCreateVal(""); } }}
            onClick={(e) => e.stopPropagation()}
            placeholder={creatingType === "file" ? "文件名" : "文件夹名"}
            className="flex-1 px-1 py-0 text-[13px] outline-none border rounded"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-focus-border)" }} />
        </div>
      )}
      {node.is_dir && exp && node.children && node.children.length === 0 && !creatingType && <div style={{ paddingLeft: `${(depth + 1) * 12 + 20}px`, color: "var(--text-tertiary)" }} className="text-[11px]">空目录</div>}
      {node.is_dir && exp && node.children && node.children.map((c: any) => <TN key={c.path} node={c} depth={depth + 1} expanded={expanded} gl={extToLang} onToggle={onToggle} refreshDir={refreshDir} />)}
      {treeCtx.menu}
    </div>
  );
}

// ===== Tabs =====
function TabBar() {
  const docs = useDocumentStore((s) => s.documents);
  const activeId = useDocumentStore((s) => s.activeDocumentId);
  const setActive = useDocumentStore((s) => s.setActiveDocument);
  const closeDoc = useDocumentStore((s) => s.closeDocument);
  const renameDoc = useDocumentStore((s) => s.renameDocument);
  const tabCtx = useContextMenu();
  const tabs = Array.from(docs.values());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); } }, [renamingId]);
  if (tabs.length === 0) return null;

  const closeOthers = (id: string) => { tabs.filter((t) => t.id !== id).forEach((t) => closeDoc(t.id)); };
  const closeRight = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx >= 0) tabs.slice(idx + 1).forEach((t) => closeDoc(t.id));
  };
  const startRename = (id: string, title: string) => { setRenamingId(id); setRenameVal(title); };
  const commitRename = () => { if (renamingId && renameVal.trim()) renameDoc(renamingId, renameVal.trim()); setRenamingId(null); };

  return (
    <div className="flex h-8 items-stretch overflow-x-auto flex-shrink-0" style={{ backgroundColor: "var(--bg-secondary)" }}>
      {tabs.map((doc) => {
        const act = doc.id === activeId;
        const isRenaming = doc.id === renamingId;
        const menuItems: ContextMenuItem[] = [
          { label: "关闭", shortcut: "Ctrl+W", onClick: () => closeDoc(doc.id) },
          { label: "关闭其他", onClick: () => closeOthers(doc.id) },
          { label: "关闭右侧", onClick: () => closeRight(doc.id) },
          { label: "关闭所有", onClick: () => tabs.forEach((t) => closeDoc(t.id)) },
          { separator: true, label: "" },
          { label: "重命名", onClick: () => startRename(doc.id, doc.title) },
          { label: "复制路径", onClick: () => doc.path && navigator.clipboard.writeText(doc.path) },
        ];
        return (
          <div key={doc.id} onClick={() => { if (!isRenaming) setActive(doc.id); }}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeDoc(doc.id); } }}
            onContextMenu={(e) => tabCtx.show(e, menuItems)}
            className="group flex items-center gap-1.5 px-2.5 cursor-pointer text-[13px] border-r select-none"
            style={{ backgroundColor: act ? "var(--tab-active-bg)" : "var(--tab-inactive-bg)", color: act ? "#e8e8e8" : "#aaa", borderBottom: act ? "2px solid var(--tab-border)" : "2px solid transparent", borderRightColor: "var(--border)" }}>
            <FileIcon languageId={doc.languageId} />
            {isRenaming ? (
              <input ref={renameRef} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                onClick={(e) => e.stopPropagation()}
                className="w-[90px] px-1 py-0 text-[13px] outline-none border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-focus-border)" }} />
            ) : (
              <span className="truncate max-w-[100px]">{doc.title}</span>
            )}
            {doc.isDirty && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--yellow)" }} />}
            <button onClick={(e) => { e.stopPropagation(); closeDoc(doc.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[rgba(255,255,255,0.1)]" style={{ color: "var(--text-tertiary)" }}>
              <X size={11} />
            </button>
          </div>
        );
      })}
      {tabCtx.menu}
    </div>
  );
}

// ===== Markdown Preview =====
// Configure marked with highlight.js
marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch { /* fallback */ }
      }
      return code;
    },
  })
);

function MarkdownPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    let raw = marked.parse(content) as string;
    // Post-process: wrap code blocks with header (language label + copy button)
    raw = raw.replace(
      /<pre><code class="hljs language-(\w*)">([\s\S]*?)<\/code><\/pre>/g,
      (_match, lang, code) => {
        const langLabel = lang ? `<span class="code-lang-label">${lang}</span>` : "";
        const encoded = btoa(unescape(encodeURIComponent(
          code.replace(/<span class="hljs-[^"]*">/g, "").replace(/<\/span>/g, "")
        )));
        return `<div class="code-block-wrapper">
          <div class="code-block-header">
            ${langLabel}
            <button class="copy-btn" data-code="${encoded}">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="4.5" y="4.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                <path d="M11.5 4.5V3c0-.83-.67-1.5-1.5-1.5H3c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5h1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              </svg>
              复制
            </button>
          </div>
          <pre><code class="hljs${lang ? ` language-${lang}` : ""}">${code}</code></pre>
        </div>`;
      }
    );
    return raw;
  }, [content]);

  // Handle copy button clicks
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const copyBtn = target.closest(".copy-btn");
    if (copyBtn) {
      const encoded = copyBtn.getAttribute("data-code");
      if (encoded) {
        try {
          const code = decodeURIComponent(atob(encoded));
          navigator.clipboard.writeText(code);
          const btn = copyBtn as HTMLElement;
          btn.classList.add("copied");
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6 11.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> 已复制';
          setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="4.5" y="4.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M11.5 4.5V3c0-.83-.67-1.5-1.5-1.5H3c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5h1" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg> 复制';
          }, 2000);
        } catch { /* noop */ }
      }
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto px-8 py-6"
      style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <div
        ref={containerRef}
        className="markdown-body max-w-[860px] mx-auto"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ===== Editor =====
function EditorSection({ onNewFile, onOpenFile }: { onNewFile: () => void; onOpenFile: () => void }) {
  const activeId = useDocumentStore((s) => s.activeDocumentId);
  const docs = useDocumentStore((s) => s.documents);
  const openFind = useUIStore((s) => s.openFindPanel);
  const findPanelOpen = useUIStore((s) => s.findPanelOpen);
  const globalSearchOpen = useUIStore((s) => s.globalSearchOpen);
  const setGlobalSearchOpen = useUIStore((s) => s.setGlobalSearchOpen);
  const previewDocId = useUIStore((s) => s.previewDocId);
  const togglePreview = useUIStore((s) => s.togglePreview);
  const editorCtx = useContextMenu();
  const docIds = Array.from(docs.keys());
  const activeDoc = activeId ? docs.get(activeId) : undefined;
  const isMd = activeDoc?.languageId === "markdown" || activeDoc?.path?.toLowerCase().endsWith(".md");
  const isPreview = activeId ? previewDocId === activeId : false;

  if (docs.size === 0) {
    return (
      <>
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: "var(--bg-primary)" }}
        onContextMenu={(e) => {
          e.preventDefault();
          editorCtx.show(e, [
            { label: "新建文件", shortcut: "Ctrl+N", onClick: onNewFile },
            { label: "打开文件", shortcut: "Ctrl+O", onClick: onOpenFile },
            { separator: true, label: "" },
            { label: "粘贴", shortcut: "Ctrl+V", onClick: () => document.execCommand("paste") },
          ]);
        }}>
        <div className="text-center max-w-sm">
          <div className="text-4xl font-light mb-2 tracking-tight" style={{ color: "var(--text-secondary)" }}>Textlume</div>
          <p className="text-[12px] mb-6" style={{ color: "var(--text-tertiary)" }}>轻量文本编辑器</p>
          <div className="space-y-1.5 mb-6">
            {[
              { keys: "Ctrl+N", label: "新建文件", action: onNewFile },
              { keys: "Ctrl+O", label: "打开文件", action: onOpenFile },
              { keys: "Ctrl+Shift+F", label: "搜索文件", action: () => setGlobalSearchOpen(true) },
            ].map(({ keys, label, action }) => (
              <div key={keys} onClick={action}
                className="flex items-center justify-between px-3 py-1.5 rounded cursor-pointer transition-colors"
                style={{ backgroundColor: "var(--bg-secondary)" }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--bg-secondary)"}>
                <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--bg-active)", color: "var(--text-tertiary)" }}>{keys}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)", opacity: 0.5 }}>Ctrl+B 切换侧边栏 · Ctrl+W 关闭标签</p>
        </div>
      </div>
      {editorCtx.menu}
      </>
    );
  }

  const editorMenu: ContextMenuItem[] = [
    { label: "撤销", shortcut: "Ctrl+Z", onClick: () => document.execCommand("undo") },
    { label: "重做", shortcut: "Ctrl+Y", onClick: () => document.execCommand("redo") },
    { separator: true, label: "" },
    { label: "全选", shortcut: "Ctrl+A", onClick: () => document.execCommand("selectAll") },
    { label: "复制", shortcut: "Ctrl+C", onClick: () => document.execCommand("copy") },
    { label: "剪切", shortcut: "Ctrl+X", onClick: () => document.execCommand("cut") },
    { label: "粘贴", shortcut: "Ctrl+V", onClick: () => document.execCommand("paste") },
    { separator: true, label: "" },
    { label: "查找", shortcut: "Ctrl+F", onClick: () => openFind(false) },
    { label: "全局搜索", shortcut: "Ctrl+Shift+F", onClick: () => setGlobalSearchOpen(true) },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" onContextMenu={(e) => editorCtx.show(e, editorMenu)}>
      <div className="flex items-center gap-0.5 px-1.5 flex-shrink-0 border-b" style={{ backgroundColor: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        {[
          { label: <><FileSearch size={12} className="inline mr-0.5" />文件内查找</>, title: "当前文件内查找 (Ctrl+F)", onClick: () => openFind(false) },
          { label: <><Replace size={12} className="inline mr-0.5" />替换</>, title: "查找并替换 (Ctrl+H)", onClick: () => openFind(true) },
          { label: <><Search size={12} className="inline mr-0.5" />全局搜索</>, title: "跨文件搜索内容 (Ctrl+Shift+F)", onClick: () => setGlobalSearchOpen(true) },
        ].map(({ label, title, onClick }) => (
          <button key={title} onClick={onClick} title={title} className="px-1.5 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-secondary)" }}>{label}</button>
        ))}
        <div className="flex-1" />
        {isMd && activeId && (
          <button onClick={() => togglePreview(activeId)}
            className="px-1.5 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
            style={{ color: isPreview ? "var(--accent)" : "var(--text-secondary)" }}>
            {isPreview ? "编辑" : "预览"}
          </button>
        )}
      </div>
      {/* Floating search panels */}
      {findPanelOpen && <FindPanel />}
      {globalSearchOpen && <MultiSearch onClose={() => setGlobalSearchOpen(false)} />}
      <div className="flex-1 overflow-hidden" onContextMenu={(e) => editorCtx.show(e, editorMenu)}>
        {isPreview && activeDoc ? (
          <MarkdownPreview content={activeDoc.content} />
        ) : (
          docIds.map((docId) => (
            <div key={docId} style={{ display: docId === activeId ? undefined : "none", height: "100%" }}
              onContextMenu={(e) => editorCtx.show(e, editorMenu)}>
              <EditorInstance docId={docId} onContextMenu={(e) => editorCtx.show(e, editorMenu)} />
            </div>
          ))
        )}
      </div>
      {editorCtx.menu}
    </div>
  );
}

const langMap: Record<string, () => any> = {
  javascript: () => javascript(), jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }), tsx: () => javascript({ jsx: true, typescript: true }),
  html: () => html(), css: () => css(), python: () => python(), rust: () => rust(),
  json: () => json(), markdown: () => markdown(), xml: () => xml(), sql: () => sql(), yaml: () => yaml(),
};

function EditorInstance({ docId, onContextMenu }: { docId: string; onContextMenu?: (e: MouseEvent) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const doc = useDocumentStore((s) => s.documents.get(docId));
  const updateContent = useDocumentStore((s) => s.updateContent);
  const setCursorPos = useUIStore((s) => s.setCursorPosition);
  const clearCursorPos = useUIStore((s) => s.clearCursorPosition);
  const settings = useSettingsStore((s) => s.settings);
  const jumpTarget = useUIStore((s) => s.searchJumpTarget);
  const setJump = useUIStore((s) => s.setSearchJumpTarget);

  // Use ref so the listener always calls the latest handler without re-subscribing
  const ctxRef = useRef(onContextMenu);
  useEffect(() => { ctxRef.current = onContextMenu; });

  // Capture-phase listener: fires BEFORE CodeMirror's own contextmenu handler,
  // which would otherwise call stopPropagation() and block our menu
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => { ctxRef.current?.(e); };
    el.addEventListener("contextmenu", handler, true);
    return () => el.removeEventListener("contextmenu", handler, true);
  }, []);

  useEffect(() => {
    if (!editorRef.current || !doc) return;
    const lang = langMap[doc.languageId];
    const large = doc.mode === "large-edit" || doc.mode === "large-readonly";
    const state = EditorState.create({
      doc: doc.content,
      extensions: [
        ...(settings.showLineNumbers ? [lineNumbers()] : []),
        highlightActiveLineGutter(),
        ...(doc.mode === "normal-edit" ? [foldGutter()] : []),
        ...(!large ? [bracketMatching(), closeBrackets()] : []),
        ...(doc.mode !== "large-readonly" ? [history()] : []),
        indentOnInput(), indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t"),
        ...(settings.wordWrap ? [EditorView.lineWrapping] : []),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...closeBracketsKeymap, ...completionKeymap]),
        ...(!large ? [autocompletion()] : []), rectangularSelection(), highlightSelectionMatches(),
        scrollPastEnd(),
        EditorView.domEventHandlers({
          contextmenu(e: MouseEvent) { ctxRef.current?.(e); return true; },
        }),
        EditorView.updateListener.of((upd) => {
          if (upd.docChanged) updateContent(docId, upd.state.doc.toString());
          const pos = upd.state.selection.main.head;
          const line = upd.state.doc.lineAt(pos);
          setCursorPos(docId, line.number, pos - line.from + 1);
        }),
        oneDark, ...(large ? [] : [lang?.() ?? []]).flat(),
        EditorView.editable.of(doc.mode !== "large-readonly" && !doc.isReadonly), placeholder(""),
        EditorView.theme({
          "&": { backgroundColor: "var(--bg-primary)" },
          ".cm-gutters": { backgroundColor: "var(--bg-primary) !important", borderRight: "1px solid var(--border) !important" },
          ".cm-activeLineGutter": { backgroundColor: "var(--accent-muted) !important" },
          ".cm-activeLine": { backgroundColor: "var(--accent-muted) !important" },
          ".cm-cursor": { borderLeftColor: "var(--accent) !important", borderLeftWidth: "2px" },
          ".cm-selectionBackground": { backgroundColor: "var(--accent-muted) !important" },
          ".cm-searchMatch": { backgroundColor: "var(--yellow-muted) !important", outline: "1px solid var(--yellow)" },
          ".cm-searchMatch.selected": { backgroundColor: "var(--yellow-muted) !important", outline: "2px solid var(--yellow)" },
          ".cm-lineNumbers .cm-gutterElement": { color: "var(--text-tertiary)", fontSize: "12px", padding: "0 6px" },
          ".cm-content": { padding: "4px 0" },
        }),
      ].flat(),
    });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    // Register as the active CodeMirror view for FindPanel
    activeCMView = view;
    // Report initial cursor position
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    setCursorPos(docId, line.number, pos - line.from + 1);
    return () => {
      if (activeCMView === view) activeCMView = null;
      view.destroy();
      viewRef.current = null;
      clearCursorPos(docId);
    };
  }, [docId, settings]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !doc) return;
    const cur = view.state.doc.toString();
    if (cur !== doc.content && !doc.isDirty) view.dispatch({ changes: { from: 0, to: cur.length, insert: doc.content } });
  }, [doc?.content, doc?.isDirty]);

  // 搜索结果跳转到指定行
  useEffect(() => {
    if (!jumpTarget || !doc?.path) return;
    if (normPath(doc.path) !== jumpTarget.docPath) return;
    const view = viewRef.current;
    if (!view) return;
    const line = Math.min(jumpTarget.line, view.state.doc.lines);
    const pos = view.state.doc.line(line).from;
    view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true });
    setJump(null);
  }, [jumpTarget, doc?.path]);

  return <div ref={editorRef} className="h-full w-full overflow-hidden" style={{ fontSize: `${settings.fontSize}px` }} />;
}

function FindPanel() {
  const ft = useUIStore((s) => s.findText); const rt = useUIStore((s) => s.replaceText);
  const rm = useUIStore((s) => s.replaceMode); const sft = useUIStore((s) => s.setFindText);
  const srt = useUIStore((s) => s.setReplaceText); const cp = useUIStore((s) => s.closeFindPanel);
  const [cs, setCs] = useState(false); const [ww, setWw] = useState(false); const [rx, setRx] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  // 关闭面板时清除搜索高亮
  const closePanel = () => {
    if (activeCMView) activeCMView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    cp();
  };

  // 实时搜索：每次输入变化自动触发
  const doNav = useCallback((dir: number) => {
    if (!activeCMView || !ft) return;
    activeCMView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: ft, caseSensitive: cs, wholeWord: ww, regexp: rx })) });
    if (dir > 0) findNext(activeCMView);
    else if (dir < 0) findPrevious(activeCMView);
  }, [ft, cs, ww, rx]);

  // 内容/选项变化时自动触发首次搜索
  useEffect(() => { doNav(1); }, [ft, cs, ww, rx, doNav]);

  const nav = (d: number) => {
    if (!activeCMView || !ft) return;
    activeCMView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: ft, caseSensitive: cs, wholeWord: ww, regexp: rx })) });
    if (d > 0) findNext(activeCMView); else findPrevious(activeCMView);
  };
  return (
    <div className="absolute left-4 right-4 top-8 z-40 shadow-lg border rounded-md animate-fade-in" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <div className="flex-1 flex flex-col gap-1">
          <input ref={ref} value={ft} onChange={(e) => sft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") nav(e.shiftKey ? -1 : 1); if (e.key === "Escape") closePanel(); }}
            placeholder="查找" autoFocus className="px-2 py-1 text-[13px] outline-none border rounded"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--input-focus-border)"} onBlur={(e) => e.currentTarget.style.borderColor = "var(--input-border)"} />
          {rm && <input value={rt} onChange={(e) => srt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (activeCMView) replaceNext(activeCMView); } if (e.key === "Escape") closePanel(); }}
            placeholder="替换为" className="px-2 py-1 text-[13px] outline-none border rounded"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--input-focus-border)"} onBlur={(e) => e.currentTarget.style.borderColor = "var(--input-border)"} />}
        </div>
        <div className="flex items-center gap-0.5">
          <FBtn onClick={() => nav(-1)}>{'\u25b2'}</FBtn>
          <FBtn onClick={() => nav(1)}>{'\u25bc'}</FBtn>
          {rm && <><FBtn onClick={() => { if (activeCMView) replaceNext(activeCMView); }}>替换</FBtn><FBtn onClick={() => { if (activeCMView) replaceAll(activeCMView); }}>全部</FBtn></>}
          <div className="w-px h-4 mx-0.5" style={{ backgroundColor: "var(--border)" }} />
          <FBtn active={cs} onClick={() => setCs((v) => !v)}>Aa</FBtn>
          <FBtn active={ww} onClick={() => setWw((v) => !v)}>W</FBtn>
          <FBtn active={rx} onClick={() => setRx((v) => !v)}>.*</FBtn>
          <FBtn onClick={closePanel}>X</FBtn>
        </div>
      </div>
    </div>
  );
}

function FBtn({ children, onClick, active, title }: { children: React.ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  return (
    <button onClick={onClick} title={title} className="px-1.5 py-1 text-[11px] transition-colors"
      style={{ color: active ? "#fff" : "var(--text-secondary)", backgroundColor: active ? "var(--accent)" : "transparent" }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}>{children}</button>
  );
}

function MultiSearch({ onClose }: { onClose: () => void }) {
  const fileTreeRoot = useFileTreeStore((s) => s.root);
  const [q, setQ] = useState(""); const [root, setRoot] = useState(fileTreeRoot);
  const [res, setRes] = useState<any[]>([]); const [rx, setRx] = useState(false);
  const [loading, setLoading] = useState(false);
  const openDoc = useDocumentStore((s) => s.openDocument);
  const setJump = useUIStore((s) => s.setSearchJumpTarget);

  // 自动填入文件树已打开的文件夹
  useEffect(() => { if (fileTreeRoot && !root) setRoot(fileTreeRoot); }, [fileTreeRoot]);

  const doSearch = async () => {
    if (!q.trim() || !root) return;
    setLoading(true);
    try {
      // 非正则模式：转义特殊字符
      const query = rx ? q.trim() : q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      setRes(await (await import("../../lib/ipc")).searchInFiles({ query, root }));
    } catch { setRes([]); }
    finally { setLoading(false); }
  };

  const openResult = async (fp: string, line: number) => {
    const normFp = normPath(fp);
    if (openingPaths.has(normFp)) return;
    const existing = Array.from(useDocumentStore.getState().documents.entries()).find(([, d]) => d.path && normPath(d.path) === normFp);
    if (existing) {
      useDocumentStore.getState().setActiveDocument(existing[0]);
      setJump({ docPath: normFp, line });
      return;
    }
    openingPaths.add(normFp);
    try {
      const info = await openFile(fp);
      const existing2 = Array.from(useDocumentStore.getState().documents.entries()).find(([, d]) => d.path && normPath(d.path) === normFp);
      if (existing2) { useDocumentStore.getState().setActiveDocument(existing2[0]); return; }
      const docId = `doc_${Date.now()}`;
      setJump({ docPath: normFp, line });
      openDoc({ id: docId, path: info.path, title: info.path.split("\\").pop()?.split("/").pop() ?? "?", content: info.content, encoding: (info.encoding as any) ?? "utf-8", lineEnding: (info.lineEnding as any) ?? "LF", languageId: info.languageId || detectLanguage(info.path), mode: "normal-edit", isDirty: false, isReadonly: info.isReadonly, isUntitled: false, fileSize: info.fileSize, lastSavedAt: info.lastModifiedAt, lastKnownModifiedAt: info.lastModifiedAt } as any);
      addRecentFile(info.path).catch(() => {});
    } catch { /* */ }
    finally { openingPaths.delete(normFp); }
  };
  const sel = async () => { try { const s = await dialogOpen({ directory: true, multiple: false }); if (s) setRoot(s as string); } catch { /* */ } };
  return (
    <div className="absolute left-4 right-4 top-8 z-40 shadow-lg border rounded-md animate-fade-in" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); if (e.key === "Escape") onClose(); }} placeholder="搜索内容（纯文本）" autoFocus
          className="flex-1 px-2 py-1 text-[13px] outline-none border rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
          onFocus={(e) => e.currentTarget.style.borderColor = "var(--input-focus-border)"} onBlur={(e) => e.currentTarget.style.borderColor = "var(--input-border)"} />
        <FBtn active={rx} onClick={() => setRx((v) => !v)} title="正则表达式模式">.*</FBtn>
        <button onClick={sel} className="px-2 py-1 text-[11px] border rounded whitespace-nowrap" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }} title={root || "选择搜索目录"}>
          {root ? root.split("\\").pop()?.split("/").pop() || "目录" : "选择目录"}
        </button>
        <button onClick={doSearch} disabled={!q.trim() || !root || loading} className="px-2.5 py-1 text-[11px] rounded" style={{ backgroundColor: "var(--accent)", color: "#fff", opacity: (!q.trim() || !root) ? 0.5 : 1 }}>
          {loading ? "..." : "搜索"}
        </button>
        <button onClick={onClose} className="p-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>X</button>
      </div>
      {res.length > 0 && (
        <div className="max-h-[220px] overflow-y-auto border-t" style={{ borderColor: "var(--border)" }}>
          {res.map((r, i) => (
            <div key={i} onClick={() => openResult(r.file, r.line)}
              className="flex items-center gap-2 px-3 py-0.5 text-[13px] cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
              <span className="truncate max-w-[140px]" style={{ color: "var(--text-primary)" }}>{r.file.split("\\").pop()?.split("/").pop()}</span>
              <span style={{ color: "var(--accent)" }}>:{r.line}</span>
              <span className="truncate opacity-60 flex-1 min-w-0">{r.content.slice(0, 100)}</span>
            </div>
          ))}
          <div className="px-3 py-0.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{res.length} 个结果</div>
        </div>
      )}
      {res.length === 0 && q.trim() && root && !loading && (
        <div className="px-3 py-2 text-[12px] border-t" style={{ color: "var(--text-tertiary)", borderColor: "var(--border)" }}>无结果</div>
      )}
    </div>
  );
}

function StatusBarComp() {
  const docs = useDocumentStore((s) => s.documents);
  const activeId = useDocumentStore((s) => s.activeDocumentId);
  const activeDoc = activeId ? docs.get(activeId) : undefined;
  const setLang = useDocumentStore((s) => s.setLanguage);
  const setEnc = useDocumentStore((s) => s.setEncoding);
  const setLineEnding = useDocumentStore((s) => s.setLineEnding);
  const cursorPos = useUIStore((s) => activeId ? s.cursorPositions[activeId] : undefined);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpenPicker(null); };
    if (openPicker) { document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }
  }, [openPicker]);

  const langs = ["plaintext","javascript","typescript","jsx","tsx","html","css","python","rust","json","markdown","xml","sql","yaml","go","java","c","cpp"];
  const encs = ["utf-8","utf-8-bom","utf-16le","utf-16be","gbk","latin1"];
  const lineEndings = ["LF","CRLF","CR"];

  const pickerBtn = (label: string, key: string) => (
    <span className="relative">
      <button
        onClick={() => setOpenPicker(openPicker === key ? null : key)}
        className="hover:bg-[var(--bg-hover)] px-1 py-0.5 rounded transition-colors"
        style={{ color: openPicker === key ? "var(--text-primary)" : "var(--text-secondary)" }}
      >{label}</button>
      {openPicker === key && (
        <div
          className="absolute bottom-full left-0 mb-1 py-1 min-w-[100px] shadow-lg rounded z-50"
          style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {(key === "lang" ? langs : key === "enc" ? encs : lineEndings).map((v) => (
            <button key={v}
              onClick={() => {
                if (activeId) {
                  if (key === "lang") setLang(activeId, v);
                  else if (key === "enc") setEnc(activeId, v as any);
                  else setLineEnding(activeId, v as any);
                }
                setOpenPicker(null);
              }}
              className="w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-secondary)" }}
            >{v}</button>
          ))}
        </div>
      )}
    </span>
  );

  return (
    <div ref={pickerRef} className="flex items-center justify-between h-[22px] px-3 text-[11px] flex-shrink-0 select-none"
      style={{ backgroundColor: "var(--status-bar)", color: "var(--text-secondary)" }}>
      <div className="flex items-center gap-3">
        {activeDoc ? (<>
          <span>行 {cursorPos?.line ?? 1}，列 {cursorPos?.col ?? 1}</span>
          <span className="opacity-50">|</span>
          <span>长度 {activeDoc.content.length}</span>
          <span className="opacity-50">|</span>
          {pickerBtn(activeDoc.encoding.toUpperCase(), "enc")}
          {pickerBtn(activeDoc.lineEnding, "le")}
          {pickerBtn(activeDoc.languageId, "lang")}
        </>) : <span>就绪</span>}
      </div>
      <div><span style={{ opacity: 0.6 }}>Textlume v0.1.0</span></div>
    </div>
  );
}
