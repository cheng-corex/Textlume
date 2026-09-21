import { useEffect, useCallback, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setCloseRequestHandler, useDocumentStore } from "./stores/documentStore";
import { useUIStore } from "./stores/uiStore";
import { useFileTreeStore } from "./stores/fileTreeStore";
import { openFile, getFileMetadata, saveFile, listDirectory, saveRecoveryDraft, listRecoveryDrafts, clearRecoveryDraft, addRecentFile, getRecentFiles, drainPendingFiles, getStartupFiles, saveSessionFiles, getSessionFiles, type FileInfo, type FileMetadata } from "./lib/ipc";
import { detectLanguage, nextUntitledTitle } from "./core/documents/documentManager";
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
  const reloadDocument = useDocumentStore((s) => s.reloadDocument);
  const keepExternalFileChange = useDocumentStore((s) => s.keepExternalFileChange);
  const updateFileMetadata = useDocumentStore((s) => s.updateFileMetadata);
  const setStatusMessage = useUIStore((s) => s.setStatusMessage);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [closeQueue, setCloseQueue] = useState<string[]>([]);
  const [closingWindow, setClosingWindow] = useState(false);
  const recoveryFlushRef = useRef<(() => Promise<void>) | null>(null);
  const [externalChange, setExternalChange] = useState<{ docId: string; metadata: FileMetadata } | null>(null);
  const [compareChange, setCompareChange] = useState<{ docId: string; file: FileInfo } | null>(null);
  const [fileStatusChange, setFileStatusChange] = useState<{ docId: string } | null>(null);
  const acknowledgedMissingFiles = useRef(new Set<string>());

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

  const openDocumentByPath = useCallback(async (filePath: string) => {
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
      if (selected) await openDocumentByPath(selected as string);
    } catch { setStatusMessage("打开文件失败"); }
  }, [openDocumentByPath, setStatusMessage]);

  const handleOpenRecent = useCallback(async (filePath: string) => {
    await openDocumentByPath(filePath);
  }, [openDocumentByPath]);

  const handleOpenFileByPath = openDocumentByPath;

  const saveDocument = useCallback(async (documentId: string): Promise<boolean> => {
    const doc = useDocumentStore.getState().documents.get(documentId);
    if (!doc) return false;
    try {
      if (doc.isUntitled || !doc.path) {
        const folderRoot = useFileTreeStore.getState().root;
        const defaultPath = folderRoot ? `${folderRoot}\\${doc.title || "untitled.txt"}` : undefined;
        const selected = await save({
          filters: [{ name: "所有文件", extensions: ["*"] }],
          defaultPath,
        });
        if (!selected) return false;
        const result = await saveFile({ path: selected, content: doc.content, encoding: doc.encoding, lineEnding: doc.lineEnding });
        markSaved(documentId, selected, result.lastModifiedAt, result.fileSize);
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
        const result = await saveFile({ path: doc.path, content: doc.content, encoding: doc.encoding, lineEnding: doc.lineEnding });
        markSaved(documentId, doc.path, result.lastModifiedAt, result.fileSize);
        setStatusMessage("文件已保存");
      }
      setExternalChange((pending) => pending?.docId === documentId ? null : pending);
      setCompareChange((pending) => pending?.docId === documentId ? null : pending);
      setFileStatusChange((pending) => pending?.docId === documentId ? null : pending);
      return true;
    } catch (e) { console.error("保存失败:", e); setStatusMessage("保存失败"); return false; }
  }, [markSaved, setStatusMessage]);

  const handleSaveFile = useCallback(async () => {
    if (activeDocumentId) await saveDocument(activeDocumentId);
  }, [activeDocumentId, saveDocument]);

  const handleReloadExternal = useCallback(async () => {
    if (!externalChange) return;
    const doc = useDocumentStore.getState().documents.get(externalChange.docId);
    if (!doc?.path) return;
    try {
      const file = await openFile(doc.path);
      reloadDocument(doc.id, {
        content: file.content,
        encoding: (file.encoding as TextEncoding) ?? doc.encoding,
        lineEnding: (file.lineEnding as LineEnding) ?? doc.lineEnding,
        languageId: file.languageId || doc.languageId,
        fileSize: file.fileSize,
        lastModifiedAt: file.lastModifiedAt,
        isReadonly: file.isReadonly,
      });
      setExternalChange(null);
      setCompareChange(null);
      setStatusMessage(`已重新加载: ${doc.title}`);
    } catch {
      setStatusMessage("重新加载外部文件失败");
    }
  }, [externalChange, reloadDocument, setStatusMessage]);

  const handleKeepExternal = useCallback(() => {
    if (!externalChange) return;
    const doc = useDocumentStore.getState().documents.get(externalChange.docId);
    if (!doc) return;
    keepExternalFileChange(doc.id, externalChange.metadata.lastModifiedAt, externalChange.metadata.fileSize, externalChange.metadata.isReadonly);
    setExternalChange(null);
    setCompareChange(null);
    setStatusMessage("已保留当前内容，文档标记为未保存");
  }, [externalChange, keepExternalFileChange, setStatusMessage]);

  const handleCompareExternal = useCallback(async () => {
    if (!externalChange) return;
    const doc = useDocumentStore.getState().documents.get(externalChange.docId);
    if (!doc?.path) return;
    try {
      const file = await openFile(doc.path);
      setCompareChange({ docId: doc.id, file });
    } catch {
      setStatusMessage("读取外部文件进行对比失败");
    }
  }, [externalChange, setStatusMessage]);

  // 只读取文件元数据，避免轮询时重复加载完整文件内容。
  useEffect(() => {
    const checking = new Set<string>();
    const checkExternalFiles = async () => {
      for (const doc of useDocumentStore.getState().documents.values()) {
        if (!doc.path || doc.lastKnownModifiedAt === undefined || checking.has(doc.id)) continue;
        checking.add(doc.id);
        try {
          const metadata = await getFileMetadata(doc.path);
          acknowledgedMissingFiles.current.delete(doc.id);
          const current = useDocumentStore.getState().documents.get(doc.id);
          if (!current || current.lastKnownModifiedAt === undefined) continue;
          if (metadata.isReadonly !== current.isReadonly) {
            updateFileMetadata(current.id, metadata.lastModifiedAt, metadata.fileSize, metadata.isReadonly);
            setStatusMessage(metadata.isReadonly ? `文件已变为只读: ${current.title}` : `文件已恢复可写: ${current.title}`);
          }
          const changed = metadata.lastModifiedAt !== current.lastKnownModifiedAt || metadata.fileSize !== current.fileSize;
          if (changed) {
            setExternalChange((pending) => pending?.docId === doc.id ? pending : { docId: doc.id, metadata });
          }
        } catch {
          if (!acknowledgedMissingFiles.current.has(doc.id)) {
            setFileStatusChange((pending) => pending?.docId === doc.id ? pending : { docId: doc.id });
          }
        }
        finally { checking.delete(doc.id); }
      }
    };
    checkExternalFiles();
    const timer = setInterval(checkExternalFiles, 2000);
    return () => clearInterval(timer);
  }, [setStatusMessage, updateFileMetadata]);

  const requestCloseDocument = useCallback((id: string) => {
    const doc = useDocumentStore.getState().documents.get(id);
    if (!doc) return;
    if (!doc.isDirty) {
      useDocumentStore.getState().closeDocumentImmediately(id);
      return;
    }
    setCloseQueue((queue) => queue.includes(id) ? queue : [...queue, id]);
  }, []);

  useEffect(() => {
    setCloseRequestHandler(requestCloseDocument);
    return () => setCloseRequestHandler(null);
  }, [requestCloseDocument]);

  const pendingCloseId = closeQueue[0];
  const pendingCloseDoc = pendingCloseId ? documents.get(pendingCloseId) : undefined;
  const externalDoc = externalChange ? documents.get(externalChange.docId) : undefined;
  const fileStatusDoc = fileStatusChange ? documents.get(fileStatusChange.docId) : undefined;
  const resolveClose = useCallback(async (action: "save" | "discard" | "cancel") => {
    const id = closeQueue[0];
    if (!id) return;
    if (action === "cancel") {
      setCloseQueue([]);
      setClosingWindow(false);
      return;
    }
    if (action === "discard") {
      setCloseQueue((queue) => queue.slice(1));
      useDocumentStore.getState().closeDocumentImmediately(id);
      return;
    }
    if (await saveDocument(id)) {
      setCloseQueue((queue) => queue.slice(1));
      useDocumentStore.getState().closeDocumentImmediately(id);
    } else {
      // 取消保存对话框或保存失败时，不继续处理批量关闭请求。
      setCloseQueue([]);
      setClosingWindow(false);
    }
  }, [closeQueue, saveDocument]);

  // 关闭窗口时复用标签关闭确认，所有未保存文档处理完才真正退出。
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      // 先等待防抖/兜底队列完成，确保最后一秒内的编辑也已进入恢复草稿。
      await recoveryFlushRef.current?.();
      const dirtyIds = Array.from(useDocumentStore.getState().documents.values())
        .filter((doc) => doc.isDirty)
        .map((doc) => doc.id);
      if (dirtyIds.length === 0) {
        setClosingWindow(false);
        await appWindow.destroy().catch(() => {});
        return;
      }
      setClosingWindow(true);
      setCloseQueue((queue) => Array.from(new Set([...queue, ...dirtyIds])));
    }).then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    }).catch(() => { /* 浏览器预览环境没有 Tauri 窗口上下文 */ });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!closingWindow || closeQueue.length > 0) return;
    setClosingWindow(false);
    getCurrentWindow().destroy().catch(() => {});
  }, [closingWindow, closeQueue.length]);

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
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const saveQueues = new Map<string, Promise<void>>();

    // 按文档串行化写入，避免较慢的旧写入覆盖较新的草稿内容。
    const persistDraft = (id: string) => {
      const previous = saveQueues.get(id) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        const doc = useDocumentStore.getState().documents.get(id);
        if (!doc) return;
        if (doc.isDirty) {
          try {
            await saveRecoveryDraft({
              id: doc.id, path: doc.path, content: doc.content,
              encoding: doc.encoding, line_ending: doc.lineEnding,
              language_id: doc.languageId, saved_at: Date.now(),
            });
            // 写入期间文档可能已被保存或关闭，避免旧写入把草稿重新留下。
            const current = useDocumentStore.getState().documents.get(id);
            if (!current || !current.isDirty) await clearRecoveryDraft(id);
          } catch { /* noop */ }
        } else {
          // 已保存的文件：清除草稿（如果之前有过恢复草稿）
          try { await clearRecoveryDraft(doc.id); } catch { /* noop */ }
        }
      }).finally(() => {
        if (saveQueues.get(id) === next) saveQueues.delete(id);
      });
      saveQueues.set(id, next);
    };

    const scheduleDraftSave = (id: string) => {
      const existing = debounceTimers.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        debounceTimers.delete(id);
        persistDraft(id);
      }, 1000);
      debounceTimers.set(id, timer);
    };

    recoveryFlushRef.current = async () => {
      const dirtyIds = Array.from(useDocumentStore.getState().documents.values())
        .filter((doc) => doc.isDirty)
        .map((doc) => doc.id);
      await Promise.all(dirtyIds.map((id) => persistDraft(id)));
    };

    // 内容变更后停止输入约 1 秒再保存，避免每次按键都触发磁盘写入。
    const unsubscribe = useDocumentStore.subscribe((state, previousState) => {
      for (const [id, doc] of state.documents) {
        const previous = previousState.documents.get(id);
        const changed = !previous
          || doc.isDirty !== previous.isDirty
          || doc.content !== previous.content
          || doc.path !== previous.path
          || doc.encoding !== previous.encoding
          || doc.lineEnding !== previous.lineEnding
          || doc.languageId !== previous.languageId;
        if (doc.isDirty && changed) scheduleDraftSave(id);
        else if (!doc.isDirty && previous?.isDirty) {
          const timer = debounceTimers.get(id);
          if (timer) clearTimeout(timer);
          debounceTimers.delete(id);
          persistDraft(id);
        }
      }

      for (const id of previousState.documents.keys()) {
        if (!state.documents.has(id)) {
          const timer = debounceTimers.get(id);
          if (timer) clearTimeout(timer);
          debounceTimers.delete(id);
          saveQueues.delete(id);
        }
      }
    });

    // 定时扫描作为兜底：连续输入时防抖计时器会一直推迟，但仍最多保留 5 秒窗口。
    const fallbackTimer = setInterval(() => {
      for (const doc of useDocumentStore.getState().documents.values()) {
        persistDraft(doc.id);
      }
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(fallbackTimer);
      recoveryFlushRef.current = null;
      for (const timer of debounceTimers.values()) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const drafts = await listRecoveryDrafts();
        if (drafts.length > 0) {
          for (const d of drafts) {
            const doc: OpenDocument = {
              id: d.id, path: d.path,
              // 有路径的用文件名，无路径的按"新文件 N"顺序编号，与新建文件不重名
              title: d.path ? d.path.split("\\").pop()?.split("/").pop() ?? nextUntitledTitle() : nextUntitledTitle(),
              content: d.content, encoding: (d.encoding as TextEncoding) ?? "utf-8",
              lineEnding: (d.line_ending as LineEnding) ?? "LF",
              languageId: d.language_id || "plaintext", mode: "normal-edit",
              isDirty: true, isReadonly: false, isUntitled: !d.path, lastSavedAt: d.saved_at,
            };
            useDocumentStore.getState().openDocument(doc);
          }
          // 草稿保留在磁盘上；5 秒自动保存会持续更新它们，
          // 直到用户显式保存（markSaved）或关闭标签（closeDocument）时删除对应草稿。
          useUIStore.getState().setStatusMessage(`已恢复 ${drafts.length} 个未保存文件`);
        }
      } catch { /* noop */ }
    })();
  }, []);

  // Load recent files on startup
  useEffect(() => {
    getRecentFiles().then(setRecentFiles).catch(() => {});
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

  // Save session when documents or editor view state changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveSessionSnapshot = () => {
      const state = useDocumentStore.getState();
      const ui = useUIStore.getState();
      const files = [];
      for (const doc of state.documents.values()) {
        if (doc.path && !doc.isUntitled) {
          files.push({
            path: doc.path,
            encoding: doc.encoding,
            line_ending: doc.lineEnding,
            language_id: doc.languageId,
            pinned: doc.isPinned,
            cursor: ui.cursorPositions[doc.id],
            selection: ui.selectionPositions[doc.id],
            scroll_top: ui.scrollPositions[doc.id],
          });
        }
      }
      const activeDoc = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : undefined;
      saveSessionFiles({ files, active_path: activeDoc?.path }).catch(() => {});
    };
    const scheduleSave = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        saveSessionSnapshot();
      }, 250);
    };

    const unsubDocuments = useDocumentStore.subscribe(() => scheduleSave());
    const unsubEditorState = useUIStore.subscribe((state, previousState) => {
      if (state.cursorPositions !== previousState.cursorPositions
        || state.selectionPositions !== previousState.selectionPositions
        || state.scrollPositions !== previousState.scrollPositions) {
        scheduleSave();
      }
    });
    return () => {
      unsubDocuments();
      unsubEditorState();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Restore session files and handle startup files (double-click / file association)
  useEffect(() => {
    (async () => {
      // 1. Restore previously open files from last session
      try {
        const session = await getSessionFiles();
        for (const file of session.files) {
          await handleOpenFileByPath(file.path);
        }
        for (const file of session.files) {
          const id = findExistingDoc(file.path);
          if (!id) continue;
          const store = useDocumentStore.getState();
          if (file.encoding) store.setEncoding(id, file.encoding as TextEncoding, false);
          if (file.line_ending) store.setLineEnding(id, file.line_ending as LineEnding, false);
          if (file.language_id) store.setLanguage(id, file.language_id);
          if (file.pinned) store.togglePinned(id);
          if (file.cursor) useUIStore.getState().setCursorPosition(id, file.cursor.line, file.cursor.col);
          if (file.selection) useUIStore.getState().setSelectionPosition(id, file.selection.anchor, file.selection.head);
          if (file.scroll_top !== undefined) useUIStore.getState().setScrollPosition(id, file.scroll_top);
        }
        if (session.active_path) {
          const activeId = findExistingDoc(session.active_path);
          if (activeId) useDocumentStore.getState().setActiveDocument(activeId);
        }
      } catch { /* noop */ }

      // 2. Handle files passed via command-line (double-click launch)
      try {
        const startupPaths = await getStartupFiles();
        for (const path of startupPaths) {
          await handleOpenFileByPath(path);
        }
      } catch { /* noop */ }
    })();
  }, [handleOpenFileByPath]);

  // Poll for pending files from other instances (app already running)
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const paths = await drainPendingFiles();
        if (paths.length > 0) {
          // 外部实例通过文件关联启动时，除了打开文件，还要把已存在的窗口带到前台。
          const appWindow = getCurrentWindow();
          await appWindow.unminimize().catch(() => {});
          await appWindow.show().catch(() => {});
          await appWindow.setFocus().catch(() => {});
        }
        for (const path of paths) {
          await handleOpenFileByPath(path);
        }
      } catch { /* noop */ }
    }, 1000);
    return () => clearInterval(iv);
  }, [handleOpenFileByPath]);

  return (
    <>
      <AppLayout onNewFile={handleNewFile} onOpenFile={handleOpenFile} onSaveFile={handleSaveFile} onOpenRecent={handleOpenRecent} recentFiles={recentFiles} />
      {pendingCloseDoc && (
        <CloseDocumentDialog
          key={pendingCloseDoc.id}
          doc={pendingCloseDoc}
          onSave={() => resolveClose("save")}
          onDiscard={() => resolveClose("discard")}
          onCancel={() => resolveClose("cancel")}
        />
      )}
      {externalDoc && externalChange && (
        <ExternalChangeDialog
          doc={externalDoc}
          onReload={handleReloadExternal}
          onKeep={handleKeepExternal}
          onCompare={handleCompareExternal}
        />
      )}
      {compareChange && externalDoc && (
        <ExternalCompareDialog
          doc={externalDoc}
          externalContent={compareChange.file.content}
          onReload={handleReloadExternal}
          onKeep={handleKeepExternal}
          onClose={() => setCompareChange(null)}
        />
      )}
      {fileStatusDoc && fileStatusChange && (
        <FileStatusDialog
          doc={fileStatusDoc}
          onKeep={() => { acknowledgedMissingFiles.current.add(fileStatusDoc.id); setFileStatusChange(null); setStatusMessage("已保留标签，文件当前不可访问"); }}
          onClose={() => { acknowledgedMissingFiles.current.add(fileStatusDoc.id); setFileStatusChange(null); useDocumentStore.getState().closeDocument(fileStatusDoc.id); }}
        />
      )}
    </>
  );
}

function CloseDocumentDialog({
  doc, onSave, onDiscard, onCancel,
}: {
  doc: OpenDocument;
  onSave: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const run = async (action: () => void | Promise<void>) => {
    if (working) return;
    setWorking(true);
    await action();
    setWorking(false);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="w-[380px] rounded-lg shadow-2xl p-5" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-[14px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>保存未保存的更改？</h3>
        <p className="text-[13px] mb-5" style={{ color: "var(--text-secondary)" }}>
          文档“{doc.title}”有未保存的更改。关闭前要保存吗？
        </p>
        <div className="flex justify-end gap-2">
          <button disabled={working} onClick={() => run(onCancel)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>取消</button>
          <button disabled={working} onClick={() => run(onDiscard)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>不保存</button>
          <button disabled={working} onClick={() => run(onSave)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "#fff", backgroundColor: "var(--accent)" }}>保存</button>
        </div>
      </div>
    </div>
  );
}

function ExternalChangeDialog({
  doc, onReload, onKeep, onCompare,
}: {
  doc: OpenDocument;
  onReload: () => void | Promise<void>;
  onKeep: () => void | Promise<void>;
  onCompare: () => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const run = async (action: () => void | Promise<void>) => {
    if (working) return;
    setWorking(true);
    await action();
    setWorking(false);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="w-[430px] rounded-lg shadow-2xl p-5" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-[14px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>文件已在外部修改</h3>
        <p className="text-[13px] mb-5" style={{ color: "var(--text-secondary)" }}>
          “{doc.title}”已被其他程序修改。请选择如何处理当前内容。
        </p>
        <div className="flex justify-end gap-2">
          <button disabled={working} onClick={() => run(onCompare)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>对比</button>
          <button disabled={working} onClick={() => run(onKeep)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>保留当前内容</button>
          <button disabled={working} onClick={() => run(onReload)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "#fff", backgroundColor: "var(--accent)" }}>重新加载</button>
        </div>
      </div>
    </div>
  );
}

function ExternalCompareDialog({
  doc, externalContent, onReload, onKeep, onClose,
}: {
  doc: OpenDocument;
  externalContent: string;
  onReload: () => void | Promise<void>;
  onKeep: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const run = async (action: () => void | Promise<void>) => {
    if (working) return;
    setWorking(true);
    await action();
    setWorking(false);
  };

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div className="w-[min(1000px,90vw)] h-[min(700px,85vh)] rounded-lg shadow-2xl p-4 flex flex-col" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>对比外部修改：{doc.title}</h3>
          <button disabled={working} onClick={onClose} className="px-2 py-1 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>返回</button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">
          <div className="min-w-0 flex flex-col">
            <div className="text-[11px] px-2 py-1" style={{ color: "var(--text-tertiary)", backgroundColor: "var(--bg-secondary)" }}>当前内容</div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-2 text-[12px]" style={{ color: "var(--text-primary)", backgroundColor: "var(--bg-primary)" }}>{doc.content}</pre>
          </div>
          <div className="min-w-0 flex flex-col">
            <div className="text-[11px] px-2 py-1" style={{ color: "var(--text-tertiary)", backgroundColor: "var(--bg-secondary)" }}>磁盘内容</div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-2 text-[12px]" style={{ color: "var(--text-primary)", backgroundColor: "var(--bg-primary)" }}>{externalContent}</pre>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button disabled={working} onClick={() => run(onKeep)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>保留当前内容</button>
          <button disabled={working} onClick={() => run(onReload)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "#fff", backgroundColor: "var(--accent)" }}>重新加载磁盘内容</button>
        </div>
      </div>
    </div>
  );
}

function FileStatusDialog({ doc, onKeep, onClose }: { doc: OpenDocument; onKeep: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="w-[430px] rounded-lg shadow-2xl p-5" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-[14px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>文件无法访问</h3>
        <p className="text-[13px] mb-5" style={{ color: "var(--text-secondary)" }}>
          “{doc.title}”可能已被删除、重命名或移动。可以暂时保留标签，待文件恢复后继续处理。
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onKeep} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}>保留标签</button>
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "#fff", backgroundColor: "var(--accent)" }}>关闭标签</button>
        </div>
      </div>
    </div>
  );
}
