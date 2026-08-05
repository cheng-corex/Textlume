import { create } from "zustand";
import type { DocumentId, OpenDocument, TextEncoding, LineEnding } from "../core/documents/documentTypes";
import { createUntitledDocument, detectLanguage } from "../core/documents/documentManager";
import { clearRecoveryDraft } from "../lib/ipc";

interface DocumentState {
  documents: Map<DocumentId, OpenDocument>;
  activeDocumentId: DocumentId | null;

  createDocument: (content?: string, title?: string) => DocumentId;
  openDocument: (doc: OpenDocument) => void;
  closeDocument: (id: DocumentId) => void;
  setActiveDocument: (id: DocumentId) => void;
  updateContent: (id: DocumentId, content: string) => void;
  markSaved: (id: DocumentId, path: string) => void;
  setEncoding: (id: DocumentId, encoding: TextEncoding) => void;
  setLineEnding: (id: DocumentId, lineEnding: LineEnding) => void;
  setLanguage: (id: DocumentId, languageId: string) => void;
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
      docs.set(doc.id, doc);
      return { documents: docs, activeDocumentId: doc.id };
    });
    return doc.id;
  },

  openDocument: (doc) => {
    set((state) => {
      const docs = new Map(state.documents);
      docs.set(doc.id, doc);
      return { documents: docs, activeDocumentId: doc.id };
    });
  },

  closeDocument: (id) => {
    // 用户明确关闭标签 = 放弃该文档内容，删除其恢复草稿
    clearRecoveryDraft(id).catch(() => {});
    set((state) => {
      const docs = new Map(state.documents);
      docs.delete(id);
      let nextActive = state.activeDocumentId;
      if (state.activeDocumentId === id) {
        const remaining = Array.from(docs.keys());
        nextActive = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return { documents: docs, activeDocumentId: nextActive };
    });
  },

  setActiveDocument: (id) => set({ activeDocumentId: id }),

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

  markSaved: (id, path) => {
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
          lastSavedAt: Date.now(),
          lastKnownModifiedAt: Date.now(),
          languageId: detectLanguage(pathFileName),
        });
      }
      return { documents: docs };
    });
  },

  setEncoding: (id, encoding) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, encoding, isDirty: true });
      return { documents: docs };
    });
  },

  setLineEnding: (id, lineEnding) => {
    set((state) => {
      const docs = new Map(state.documents);
      const doc = docs.get(id);
      if (doc) docs.set(id, { ...doc, lineEnding, isDirty: true });
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
