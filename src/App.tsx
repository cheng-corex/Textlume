import { useEffect, useCallback, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "./stores/documentStore";
import { useUIStore } from "./stores/uiStore";
import { useFileTreeStore } from "./stores/fileTreeStore";
import { openFile, saveFile, listDirectory, saveRecoveryDraft, listRecoveryDrafts, clearRecoveryDraft, clearAllRecoveryDrafts, addRecentFile, getRecentFiles, drainPendingFiles, getStartupFiles, saveSessionFiles, getSessionFiles } from "./lib/ipc";
import { detectLanguage } from "./core/documents/documentManager";
import type { OpenDocument, TextEncoding, LineEnding } from "./core/documents/documentTypes";
import AppLayout from "./components/layout/AppLayout";

// Track files being opened to prevent duplicate tabs from rapid clicks
const appOpeningPaths = new Set<string>();

export default function App() {
  const createDocument = useDocumentStore((s) => s.createDocument);
  const openDocument = useDocumentStore((s) => s.openDocument);
  const documents = useDocumentStore((s) => s.documents);
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId);
  const markSaved = useDocumentStore((s) => s.markSaved);
  const setStatusMessage = useUIStore((s) => s.setStatusMessage);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  const normalizePath = (p: string) => p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
  const findExistingDoc = (filePath: string): string | null => {
    const docs = useDocumentStore.getState().documents;
    const norm = normalizePath(filePath);
    for (const [id, doc] of docs) {
      if (doc.path && normalizePath(doc.path) === norm) return id;
    }
    return null;
  };

  const handleNewFile = useCallback(() => {
    createDocument();
    setStatusMessage("新文件已创建");
  }, [createDocument, setStatusMessage]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "所有文件", extensions: ["*"] },
          { name: "文本文件", extensions: ["txt", "md", "csv", "log"] },
          { name: "代码文件", extensions: ["js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "css", "html"] },
        ],
      });
      if (!selected) return;
      const fp = selected as string;
      const normFp = normalizePath(fp);
      if (appOpeningPaths.has(normFp)) return;
      const existingId = findExistingDoc(fp);
      if (existingId) {
        useDocumentStore.getState().setActiveDocument(existingId);
        setStatusMessage(`已切换到: ${fp.split("\\").pop()?.split("/").pop()}`);
        return;
      }
      appOpeningPaths.add(normFp);
      try {
        const fileInfo = await openFile(fp);
        // Re-check after async
        const existingId2 = findExistingDoc(fileInfo.path);
        if (existingId2) {
          useDocumentStore.getState().setActiveDocument(existingId2);
          setStatusMessage(`已切换到: ${fileInfo.path.split("\\").pop()?.split("/").pop()}`);
          return;
        }
        const doc: OpenDocument = {
          id: `doc_${Date.now()}`,
          path: fileInfo.path,
          title: fileInfo.path.split("\\").pop()?.split("/").pop() ?? "未知文件",
          content: fileInfo.content,
          encoding: (fileInfo.encoding as TextEncoding) ?? "utf-8",
          lineEnding: (fileInfo.lineEnding as LineEnding) ?? "LF",
          languageId: fileInfo.languageId || detectLanguage(fileInfo.path),
          mode: fileInfo.fileSize > 100_000_000 ? "large-readonly" : fileInfo.fileSize > 10_000_000 ? "large-edit" : "normal-edit",
          isDirty: false, isReadonly: fileInfo.isReadonly, isUntitled: false,
          fileSize: fileInfo.fileSize, lastSavedAt: fileInfo.lastModifiedAt, lastKnownModifiedAt: fileInfo.lastModifiedAt,
        };
        openDocument(doc);
        setStatusMessage(`已打开: ${doc.title}`);
        addRecentFile(fileInfo.path).catch(() => {});
        getRecentFiles().then(setRecentFiles).catch(() => {});
      } finally { appOpeningPaths.delete(normFp); }
    } catch { setStatusMessage("打开文件失败"); }
  }, [openDocument, setStatusMessage]);

  const handleOpenRecent = useCallback(async (filePath: string) => {
    try {
      const normFp = normalizePath(filePath);
      if (appOpeningPaths.has(normFp)) return;
      const existingId = findExistingDoc(filePath);
      if (existingId) {
        useDocumentStore.getState().setActiveDocument(existingId);
        setStatusMessage(`已切换到: ${filePath.split("\\").pop()?.split("/").pop()}`);
        return;
      }
      appOpeningPaths.add(normFp);
      try {
        const fileInfo = await openFile(filePath);
        const existingId2 = findExistingDoc(fileInfo.path);
        if (existingId2) {
          useDocumentStore.getState().setActiveDocument(existingId2);
          setStatusMessage(`已切换到: ${fileInfo.path.split("\\").pop()?.split("/").pop()}`);
          return;
        }
        const doc: OpenDocument = {
          id: `doc_${Date.now()}`,
          path: fileInfo.path,
          title: fileInfo.path.split("\\").pop()?.split("/").pop() ?? "未知文件",
          content: fileInfo.content,
          encoding: (fileInfo.encoding as TextEncoding) ?? "utf-8",
          lineEnding: (fileInfo.lineEnding as LineEnding) ?? "LF",
          languageId: fileInfo.languageId || detectLanguage(fileInfo.path),
          mode: fileInfo.fileSize > 100_000_000 ? "large-readonly" : fileInfo.fileSize > 10_000_000 ? "large-edit" : "normal-edit",
          isDirty: false, isReadonly: fileInfo.isReadonly, isUntitled: false,
          fileSize: fileInfo.fileSize, lastSavedAt: fileInfo.lastModifiedAt, lastKnownModifiedAt: fileInfo.lastModifiedAt,
        };
        openDocument(doc);
        setStatusMessage(`已打开: ${doc.title}`);
        addRecentFile(fileInfo.path).catch(() => {});
        getRecentFiles().then(setRecentFiles).catch(() => {});
      } finally { appOpeningPaths.delete(normFp); }
    } catch { setStatusMessage("打开文件失败"); }
  }, [openDocument, setStatusMessage]);

  const handleOpenFileByPath = useCallback(async (filePath: string) => {
    try {
      const normFp = normalizePath(filePath);
      if (appOpeningPaths.has(normFp)) return;
      const existingId = findExistingDoc(filePath);
      if (existingId) {
        useDocumentStore.getState().setActiveDocument(existingId);
        setStatusMessage(`已切换到: ${filePath.split("\\").pop()?.split("/").pop()}`);
        return;
      }
      appOpeningPaths.add(normFp);
      try {
        const fileInfo = await openFile(filePath);
        const existingId2 = findExistingDoc(fileInfo.path);
        if (existingId2) {
          useDocumentStore.getState().setActiveDocument(existingId2);
          setStatusMessage(`已切换到: ${fileInfo.path.split("\\").pop()?.split("/").pop()}`);
          return;
        }
        const doc: OpenDocument = {
          id: `doc_${Date.now()}`,
          path: fileInfo.path,
          title: fileInfo.path.split("\\").pop()?.split("/").pop() ?? "未知文件",
          content: fileInfo.content,
          encoding: (fileInfo.encoding as TextEncoding) ?? "utf-8",
          lineEnding: (fileInfo.lineEnding as LineEnding) ?? "LF",
          languageId: fileInfo.languageId || detectLanguage(fileInfo.path),
          mode: fileInfo.fileSize > 100_000_000 ? "large-readonly" : fileInfo.fileSize > 10_000_000 ? "large-edit" : "normal-edit",
          isDirty: false, isReadonly: fileInfo.isReadonly, isUntitled: false,
          fileSize: fileInfo.fileSize, lastSavedAt: fileInfo.lastModifiedAt, lastKnownModifiedAt: fileInfo.lastModifiedAt,
        };
        openDocument(doc);
        setStatusMessage(`已打开: ${doc.title}`);
        addRecentFile(fileInfo.path).catch(() => {});
        getRecentFiles().then(setRecentFiles).catch(() => {});
      } finally { appOpeningPaths.delete(normFp); }
    } catch { setStatusMessage("打开文件失败"); }
  }, [openDocument, setStatusMessage]);

  const handleSaveFile = useCallback(async () => {
    if (!activeDocumentId) return;
    const doc = documents.get(activeDocumentId);
    if (!doc) return;
    try {
      if (doc.isUntitled || !doc.path) {
        const folderRoot = useFileTreeStore.getState().root;
        const defaultPath = folderRoot ? `${folderRoot}\\${doc.title || "untitled.txt"}` : undefined;
        const selected = await save({
          filters: [{ name: "所有文件", extensions: ["*"] }],
          defaultPath,
        });
        if (!selected) return;
        await saveFile({ path: selected, content: doc.content, encoding: doc.encoding, lineEnding: doc.lineEnding });
        markSaved(activeDocumentId, selected);
        addRecentFile(selected).catch(() => {});
        setStatusMessage("文件已保存");
        // Refresh file tree if saved in the current folder
        if (folderRoot) {
          const savedParent = selected.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
          const rootNorm = folderRoot.replace(/\\/g, "/");
          if (savedParent === rootNorm || savedParent.startsWith(rootNorm + "/")) {
            try {
              const entries = await listDirectory(folderRoot);
              useFileTreeStore.getState().setTree(entries);
            } catch { /* ignore */ }
          }
        }
      } else {
        await saveFile({ path: doc.path, content: doc.content, encoding: doc.encoding, lineEnding: doc.lineEnding });
        markSaved(activeDocumentId, doc.path);
        setStatusMessage("文件已保存");
      }
    } catch (e) { console.error("保存失败:", e); setStatusMessage("保存失败"); }
  }, [activeDocumentId, documents, markSaved, setStatusMessage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "n") { e.preventDefault(); handleNewFile(); }
      else if (mod && e.key === "o") { e.preventDefault(); handleOpenFile(); }
      else if (mod && e.key === "s") { e.preventDefault(); handleSaveFile(); }
      else if (mod && e.key === "w") { e.preventDefault(); const s = useDocumentStore.getState(); if (s.activeDocumentId) s.closeDocument(s.activeDocumentId); }
      else if (mod && e.key === "b") { e.preventDefault(); useUIStore.getState().toggleSidebar(); }
      else if (mod && e.key === "f" && e.shiftKey) { e.preventDefault(); useUIStore.getState().setGlobalSearchOpen(true); }
      else if (mod && e.key === "f") { e.preventDefault(); useUIStore.getState().openFindPanel(false); }
      else if (mod && e.key === "h") { e.preventDefault(); useUIStore.getState().openFindPanel(true); }
      else if (e.key === "Escape") { const s = useUIStore.getState(); if (s.findPanelOpen) s.closeFindPanel(); }
      else if (mod && e.key === "Tab") {
        e.preventDefault();
        const s = useDocumentStore.getState();
        const ids = Array.from(s.documents.keys());
        if (ids.length > 1) {
          const idx = ids.indexOf(s.activeDocumentId!);
          const next = e.shiftKey ? (idx <= 0 ? ids[ids.length - 1] : ids[idx - 1]) : (idx >= ids.length - 1 ? ids[0] : ids[idx + 1]);
          s.setActiveDocument(next);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewFile, handleOpenFile, handleSaveFile]);

  useEffect(() => {
    const iv = setInterval(async () => {
      for (const doc of useDocumentStore.getState().documents.values()) {
        if (doc.isDirty) {
          try { await saveRecoveryDraft({ id: doc.id, path: doc.path, content: doc.content, encoding: doc.encoding, line_ending: doc.lineEnding, language_id: doc.languageId, saved_at: Date.now() }); }
          catch { /* noop */ }
        } else {
          try { await clearRecoveryDraft(doc.id); } catch { /* noop */ }
        }
      }
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const drafts = await listRecoveryDrafts();
        if (drafts.length > 0) {
          for (const d of drafts.slice(0, 5)) {
            const doc: OpenDocument = {
              id: d.id, path: d.path,
              title: d.path ? d.path.split("\\").pop()?.split("/").pop() ?? "恢复文件" : "恢复文件",
              content: d.content, encoding: (d.encoding as TextEncoding) ?? "utf-8",
              lineEnding: (d.line_ending as LineEnding) ?? "LF",
              languageId: d.language_id || "plaintext", mode: "normal-edit",
              isDirty: true, isReadonly: false, isUntitled: !d.path, lastSavedAt: d.saved_at,
            };
            useDocumentStore.getState().openDocument(doc);
          }
          // Immediately clear drafts from storage so they won't be restored again on next startup.
          // The auto-save interval will re-save them as long as the documents remain dirty.
          clearAllRecoveryDrafts().catch(() => {});
          useUIStore.getState().setStatusMessage(`已恢复 ${drafts.length} 个未保存文件`);
        }
      } catch { /* noop */ }
    })();
  }, []);

  // Load recent files on startup
  useEffect(() => {
    getRecentFiles().then(setRecentFiles).catch(() => {});
  }, []);

  // Clear recovery drafts when app closes normally
  useEffect(() => {
    const handler = () => { clearAllRecoveryDrafts().catch(() => {}); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Clear recovery draft when a document is closed
  useEffect(() => {
    const unsub = useDocumentStore.subscribe((state, prevState) => {
      for (const id of prevState.documents.keys()) {
        if (!state.documents.has(id)) {
          clearRecoveryDraft(id).catch(() => {});
        }
      }
    });
    return unsub;
  }, []);

  // Save session when documents change (open/close)
  useEffect(() => {
    const unsub = useDocumentStore.subscribe((state) => {
      const paths: string[] = [];
      for (const doc of state.documents.values()) {
        if (doc.path && !doc.isUntitled) {
          paths.push(doc.path);
        }
      }
      saveSessionFiles(paths).catch(() => {});
    });
    return unsub;
  }, []);

  // Restore session files and handle startup files (double-click / file association)
  useEffect(() => {
    (async () => {
      // 1. Restore previously open files from last session
      try {
        const sessionPaths = await getSessionFiles();
        for (const path of sessionPaths) {
          handleOpenFileByPath(path);
        }
      } catch { /* noop */ }

      // 2. Handle files passed via command-line (double-click launch)
      try {
        const startupPaths = await getStartupFiles();
        for (const path of startupPaths) {
          handleOpenFileByPath(path);
        }
      } catch { /* noop */ }
    })();
  }, [handleOpenFileByPath]);

  // Poll for pending files from other instances (app already running)
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const paths = await drainPendingFiles();
        for (const path of paths) {
          handleOpenFileByPath(path);
        }
      } catch { /* noop */ }
    }, 1000);
    return () => clearInterval(iv);
  }, [handleOpenFileByPath]);

  return <AppLayout onNewFile={handleNewFile} onOpenFile={handleOpenFile} onSaveFile={handleSaveFile} onOpenRecent={handleOpenRecent} recentFiles={recentFiles} />;
}
