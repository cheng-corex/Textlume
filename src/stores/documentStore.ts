import { create } from "zustand";
import type { DocumentId, OpenDocument, TextEncoding, LineEnding } from "../core/documents/documentTypes";
import { createUntitledDocument, detectLanguage } from "../core/documents/documentManager";
import { clearRecoveryDraft } from "../lib/ipc";

type CloseRequestHandler = (id: DocumentId) => void;
let closeRequestHandler: CloseRequestHandler | null = null;
const closedDocumentHistory: OpenDocument[] = [];
let accessCounter = Date.now();
const normalizePath = (path: string) => path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();

interface ReloadedDocument {
  content: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  languageId: string;
  fileSize: number;
  lastModifiedAt: number;
  isReadonly: boolean;
}

export function setCloseRequestHandler(handler: CloseRequestHandler | null) {
  closeRequestHandler = handler;
}

interface DocumentState {
  documents: Map<DocumentId, OpenDocument>;
  activeDocumentId: DocumentId | null;

  createDocument: (content?: string, title?: string) => DocumentId;
  openDocument: (doc: OpenDocument) => void;
  closeDocument: (id: DocumentId) => void;
  closeDocumentImmediately: (id: DocumentId) => void;
  setActiveDocument: (id: DocumentId) => void;
  reorderDocuments: (id: DocumentId, targetIndex: number) => void;
  togglePinned: (id: DocumentId) => void;
  getLastClosedDocument: () => OpenDocument | null;
  reopenLastClosedDocument: (replacement?: OpenDocument) => DocumentId | null;
  switchToRecentDocument: () => void;
  updateContent: (id: DocumentId, content: string) => void;
  markSaved: (id: DocumentId, path: string, lastModifiedAt?: number, fileSize?: number) => void;
  setEncoding: (id: DocumentId, encoding: TextEncoding, markDirty?: boolean) => void;
  setLineEnding: (id: DocumentId, lineEnding: LineEnding, markDirty?: boolean) => void;
  setLanguage: (id: DocumentId, languageId: string) => void;
  setTitle: (id: DocumentId, title: string) => void;
  reloadDocument: (id: DocumentId, file: ReloadedDocument) => void;
  keepExternalFileChange: (id: DocumentId, lastModifiedAt: number, fileSize: number, isReadonly: boolean) => void;
  updateFileMetadata: (id: DocumentId, lastModifiedAt: number, fileSize: number, isReadonly: boolean) => void;
  renameDocument: (id: DocumentId, title: string) => void;
  updateDocumentPath: (id: DocumentId, path: string) => void;
  getDocument: (id: DocumentId) => OpenDocument | undefined;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: new Map(),
  activeDocumentId: null,

  createDocument: (content = "", title?: string) => {
    const doc = createUntitledDocument();
    if (title) doc.title = title;
    if (content) doc.content = content;
    set((state) => {
      const docs = new Map(state.documents);
      docs.set(doc.id, { ...doc, lastAccessedAt: ++accessCounter });
      return { documents: docs, activeDocumentId: doc.id };
    });
    return doc.id;
  },

  openDocument: (doc) => {
    set((state) => {
      const docs = new Map(state.documents);
      docs.set(doc.id, { ...doc, lastAccessedAt: ++accessCounter });
      return { documents: docs, activeDocumentId: doc.id };
    });
  },

  closeDocument: (id) => {
    if (closeRequestHandler) {
      closeRequestHandler(id);
      return;
    }
    get().closeDocumentImmediately(id);
  },

  closeDocumentImmediately: (id) => {
    // 用户明确关闭标签 = 放弃该文档内容，删除其恢复草稿
    clearRecoveryDraft(id).catch(() => {});
    set((state) => {
      const docs = new Map(state.documents);
      const closed = docs.get(id);
      if (closed) {
        closedDocumentHistory.push(closed);
        if (closedDocumentHistory.length > 20) closedDocumentHistory.shift();
      }
      docs.delete(id);
      let nextActive = state.activeDocumentId;
      if (state.activeDocumentId === id) {
        const remaining = Array.from(docs.keys());
        nextActive = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return { documents: docs, activeDocumentId: nextActive };
    });
  },

  setActiveDocument: (id) => set((state) => {
    const docs = new Map(state.documents);
    const doc = docs.get(id);
    if (!doc) return state;
    docs.set(id, { ...doc, lastAccessedAt: ++accessCounter });
    return { documents: docs, activeDocumentId: id };
  }),

  reorderDocuments: (id, targetIndex) => set((state) => {
    const entries = Array.from(state.documents.entries());
    const sourceIndex = entries.findIndex(([docId]) => docId === id);
    if (sourceIndex < 0) return state;
    const [entry] = entries.splice(sourceIndex, 1);
    const boundedIndex = Math.max(0, Math.min(targetIndex, entries.length));
    entries.splice(boundedIndex, 0, entry);
    return { documents: new Map(entries) };
  }),

  togglePinned: (id) => set((state) => {
    const docs = new Map(state.documents);
    const doc = docs.get(id);
    if (doc) docs.set(id, { ...doc, isPinned: !doc.isPinned });
    return { documents: docs };
  }),

  getLastClosedDocument: () => closedDocumentHistory[closedDocumentHistory.length - 1] ?? null,

  reopenLastClosedDocument: (replacement) => {
    const doc = closedDocumentHistory.pop();
    if (!doc) return null;
    let reopenedId: DocumentId = replacement?.id ?? doc.id;
    set((state) => {
      const docs = new Map(state.documents);
      const existing = doc.path
        ? Array.from(docs.entries()).find(([, current]) => current.path && normalizePath(current.path) === normalizePath(doc.path!))
        : undefined;
      if (existing) {
        const [existingId, existingDoc] = existing;
        reopenedId = existingId;
        docs.set(existingId, { ...existingDoc, lastAccessedAt: ++accessCounter });
        return { documents: docs, activeDocumentId: existingId };
      }
      const reopened = replacement ?? doc;
      docs.set(reopened.id, { ...reopened, lastAccessedAt: ++accessCounter });
      return { documents: docs, activeDocumentId: reopened.id };
    });
    return reopenedId;
  },

  switchToRecentDocument: () => set((state) => {
    const docs = Array.from(state.documents.values()).sort((a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0));
    if (docs.length < 2) return state;
    const next = docs[0].id === state.activeDocumentId ? docs[1] : docs[0];
    const map = new Map(state.documents);
    map.set(next.id, { ...next, lastAccessedAt: ++accessCounter });
    return { documents: map, activeDocumentId: next.id };
  }),

  updateContent: (id, content) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        docs.set(id, { ...doc, content, isDirty: true });
      }
      return { documents: docs };
    });
  },

  markSaved: (id, path, lastModifiedAt, fileSize) => {
    // 用户显式保存文件 = 内容已落盘，删除该文档的恢复草稿
    clearRecoveryDraft(id).catch(() => {});
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        const pathFileName = path.split("\\").pop()?.split("/").pop() ?? doc.title;
        // Only update title from path when saving a new untitled file for the first time.
        // Otherwise, preserve any title the user may have set via rename.
        const title = doc.isUntitled ? pathFileName : doc.title;
        docs.set(id, {
          ...doc,
          path,
          title,
          isDirty: false,
          isUntitled: false,
          fileSize: fileSize ?? doc.fileSize,
          lastSavedAt: lastModifiedAt ?? Date.now(),
          lastKnownModifiedAt: lastModifiedAt ?? Date.now(),
          languageId: detectLanguage(pathFileName),
        });
      }
      return { documents: docs };
    });
  },

  setEncoding: (id, encoding, markDirty = true) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, encoding, isDirty: markDirty ? true : doc.isDirty });
      return { documents: docs };
    });
  },

  setLineEnding: (id, lineEnding, markDirty = true) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, lineEnding, isDirty: markDirty ? true : doc.isDirty });
      return { documents: docs };
    });
  },

  setLanguage: (id, languageId) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, languageId });
      return { documents: docs };
    });
  },

  setTitle: (id, title) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, title });
      return { documents: docs };
    });
  },

  reloadDocument: (id, file) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        docs.set(id, {
          ...doc,
          content: file.content,
          encoding: file.encoding,
          lineEnding: file.lineEnding,
          languageId: file.languageId,
          fileSize: file.fileSize,
          isReadonly: file.isReadonly,
          isDirty: false,
          lastSavedAt: file.lastModifiedAt,
          lastKnownModifiedAt: file.lastModifiedAt,
        });
      }
      return { documents: docs };
    });
  },

  keepExternalFileChange: (id, lastModifiedAt, fileSize, isReadonly) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        docs.set(id, { ...doc, fileSize, isReadonly, lastKnownModifiedAt: lastModifiedAt, isDirty: true });
      }
      return { documents: docs };
    });
  },

  updateFileMetadata: (id, lastModifiedAt, fileSize, isReadonly) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, fileSize, isReadonly, lastKnownModifiedAt: lastModifiedAt });
      return { documents: docs };
    });
  },

  renameDocument: (id, title) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        docs.set(id, { ...doc, title, languageId: detectLanguage(title), isDirty: doc.path ? doc.isDirty : true });
      }
      return { documents: docs };
    });
  },

  updateDocumentPath: (id, path) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) {
        const fileName = path.split("\\").pop()?.split("/").pop() ?? doc.title;
        docs.set(id, { ...doc, path, title: fileName, languageId: detectLanguage(fileName) });
      }
      return { documents: docs };
    });
  },

  getDocument: (id) => get().documents.get(id),
}));
