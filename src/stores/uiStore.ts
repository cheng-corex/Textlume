import { create } from "zustand";

export type ThemeName = "dark-plus" | "light-plus" | "one-dark-pro" | "dracula" | "monokai" | "nord";

export const themes: { id: ThemeName; label: string }[] = [
  { id: "dark-plus", label: "Dark+ (默认深色)" },
  { id: "light-plus", label: "Light+ (默认浅色)" },
  { id: "one-dark-pro", label: "One Dark Pro" },
  { id: "dracula", label: "Dracula" },
  { id: "monokai", label: "Monokai" },
  { id: "nord", label: "Nord" },
];

interface UIState {
  theme: ThemeName;
  sidebarOpen: boolean;
  sidebarView: "files" | "folder";
  findPanelOpen: boolean;
  replaceMode: boolean;
  findText: string;
  replaceText: string;
  globalSearchOpen: boolean;
  statusMessage: string;
  cursorPositions: Record<string, { line: number; col: number }>;
  selectionPositions: Record<string, { anchor: number; head: number }>;
  scrollPositions: Record<string, number>;
  previewDocId: string | null;
  searchJumpTarget: { docPath: string; line: number } | null;
  symbolListOpen: boolean;
  findHistory: string[];
  replaceHistory: string[];
  bookmarks: Record<string, number[]>;
  macroRecording: boolean;
  macroSteps: Array<{ changes: Array<{ from: number; to: number; insert: string }> }>;

  setTheme: (theme: ThemeName) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarView: (v: "files" | "folder") => void;
  openFindPanel: (replaceMode?: boolean) => void;
  closeFindPanel: () => void;
  setGlobalSearchOpen: (open: boolean) => void;
  setFindText: (text: string) => void;
  setReplaceText: (text: string) => void;
  setStatusMessage: (msg: string) => void;
  setCursorPosition: (docId: string, line: number, col: number) => void;
  clearCursorPosition: (docId: string) => void;
  setSelectionPosition: (docId: string, anchor: number, head: number) => void;
  setScrollPosition: (docId: string, scrollTop: number) => void;
  togglePreview: (docId: string) => void;
  closePreview: () => void;
  setSearchJumpTarget: (target: { docPath: string; line: number } | null) => void;
  toggleSymbolList: () => void;
  addFindHistory: (find: string, replace: string) => void;
  toggleBookmark: (docId: string, line: number) => void;
  clearBookmarks: (docId: string) => void;
  stashDocumentState: (docId: string) => void;
  restoreDocumentState: (docId: string) => void;
  transferDocumentState: (fromDocId: string, toDocId: string) => void;
  setMacroRecording: (recording: boolean) => void;
  addMacroStep: (step: { changes: Array<{ from: number; to: number; insert: string }> }) => void;
  clearMacroSteps: () => void;
}

type DocumentViewState = {
  cursor?: { line: number; col: number };
  selection?: { anchor: number; head: number };
  scrollTop?: number;
  bookmarks?: number[];
  preview: boolean;
};

const closedDocumentViewStates = new Map<string, DocumentViewState>();

export const useUIStore = create<UIState>((set) => ({
  theme: "dark-plus",
  sidebarOpen: true,
  sidebarView: "files",
  findPanelOpen: false,
  replaceMode: false,
  findText: "",
  replaceText: "",
  globalSearchOpen: false,
  statusMessage: "",
  cursorPositions: {},
  selectionPositions: {},
  scrollPositions: {},
  previewDocId: null,
  searchJumpTarget: null,
  symbolListOpen: false,
  findHistory: [],
  replaceHistory: [],
  bookmarks: {},
  macroRecording: false,
  macroSteps: [],

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarView: (v) => set({ sidebarView: v }),
  openFindPanel: (replaceMode = false) => set({ findPanelOpen: true, replaceMode }),
  closeFindPanel: () => set({ findPanelOpen: false, findText: "", replaceText: "" }),
  setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
  setFindText: (text) => set({ findText: text }),
  setReplaceText: (text) => set({ replaceText: text }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setCursorPosition: (docId, line, col) =>
    set((s) => ({ cursorPositions: { ...s.cursorPositions, [docId]: { line, col } } })),
  clearCursorPosition: (docId) =>
    set((s) => {
      const next = { ...s.cursorPositions };
      delete next[docId];
      return { cursorPositions: next };
    }),
  setSelectionPosition: (docId, anchor, head) =>
    set((s) => ({ selectionPositions: { ...s.selectionPositions, [docId]: { anchor, head } } })),
  setScrollPosition: (docId, scrollTop) =>
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [docId]: scrollTop } })),
  togglePreview: (docId) =>
    set((s) => ({ previewDocId: s.previewDocId === docId ? null : docId })),
  closePreview: () => set({ previewDocId: null }),
  setSearchJumpTarget: (target) => set({ searchJumpTarget: target }),
  toggleSymbolList: () => set((s) => ({ symbolListOpen: !s.symbolListOpen })),
  addFindHistory: (find, replace) => set((s) => ({
    findHistory: find ? [find, ...s.findHistory.filter((item) => item !== find)].slice(0, 20) : s.findHistory,
    replaceHistory: replace ? [replace, ...s.replaceHistory.filter((item) => item !== replace)].slice(0, 20) : s.replaceHistory,
  })),
  toggleBookmark: (docId, line) => set((s) => {
    const current = s.bookmarks[docId] ?? [];
    const next = current.includes(line) ? current.filter((item) => item !== line) : [...current, line].sort((a, b) => a - b);
    return { bookmarks: { ...s.bookmarks, [docId]: next } };
  }),
  clearBookmarks: (docId) => set((s) => {
    const next = { ...s.bookmarks };
    delete next[docId];
    return { bookmarks: next };
  }),
  stashDocumentState: (docId) => set((s) => {
    closedDocumentViewStates.delete(docId);
    closedDocumentViewStates.set(docId, {
      cursor: s.cursorPositions[docId],
      selection: s.selectionPositions[docId],
      scrollTop: s.scrollPositions[docId],
      bookmarks: s.bookmarks[docId],
      preview: s.previewDocId === docId,
    });
    while (closedDocumentViewStates.size > 20) {
      const oldest = closedDocumentViewStates.keys().next().value;
      if (oldest) closedDocumentViewStates.delete(oldest);
      else break;
    }
    const cursorPositions = { ...s.cursorPositions };
    const selectionPositions = { ...s.selectionPositions };
    const scrollPositions = { ...s.scrollPositions };
    const bookmarks = { ...s.bookmarks };
    delete cursorPositions[docId];
    delete selectionPositions[docId];
    delete scrollPositions[docId];
    delete bookmarks[docId];
    return { cursorPositions, selectionPositions, scrollPositions, bookmarks, previewDocId: s.previewDocId === docId ? null : s.previewDocId };
  }),
  restoreDocumentState: (docId) => set((s) => {
    const saved = closedDocumentViewStates.get(docId);
    if (!saved) return s;
    closedDocumentViewStates.delete(docId);
    return {
      cursorPositions: saved.cursor ? { ...s.cursorPositions, [docId]: saved.cursor } : s.cursorPositions,
      selectionPositions: saved.selection ? { ...s.selectionPositions, [docId]: saved.selection } : s.selectionPositions,
      scrollPositions: saved.scrollTop !== undefined ? { ...s.scrollPositions, [docId]: saved.scrollTop } : s.scrollPositions,
      bookmarks: saved.bookmarks ? { ...s.bookmarks, [docId]: saved.bookmarks } : s.bookmarks,
      previewDocId: saved.preview ? docId : s.previewDocId,
    };
  }),
  transferDocumentState: (fromDocId, toDocId) => set((s) => {
    const saved = closedDocumentViewStates.get(fromDocId);
    if (!saved) return s;
    closedDocumentViewStates.delete(fromDocId);
    return {
      cursorPositions: saved.cursor ? { ...s.cursorPositions, [toDocId]: saved.cursor } : s.cursorPositions,
      selectionPositions: saved.selection ? { ...s.selectionPositions, [toDocId]: saved.selection } : s.selectionPositions,
      scrollPositions: saved.scrollTop !== undefined ? { ...s.scrollPositions, [toDocId]: saved.scrollTop } : s.scrollPositions,
      bookmarks: saved.bookmarks ? { ...s.bookmarks, [toDocId]: saved.bookmarks } : s.bookmarks,
      previewDocId: saved.preview ? toDocId : s.previewDocId,
    };
  }),
  setMacroRecording: (recording) => set({ macroRecording: recording, ...(recording ? { macroSteps: [] } : {}) }),
  addMacroStep: (step) => set((s) => s.macroRecording ? ({ macroSteps: [...s.macroSteps, step] }) : s),
  clearMacroSteps: () => set({ macroSteps: [] }),
}));
