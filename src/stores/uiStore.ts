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
  previewDocId: string | null;
  searchJumpTarget: { docPath: string; line: number } | null;

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
  togglePreview: (docId: string) => void;
  closePreview: () => void;
  setSearchJumpTarget: (target: { docPath: string; line: number } | null) => void;
}

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
  previewDocId: null,
  searchJumpTarget: null,

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
  togglePreview: (docId) =>
    set((s) => ({ previewDocId: s.previewDocId === docId ? null : docId })),
  closePreview: () => set({ previewDocId: null }),
  setSearchJumpTarget: (target) => set({ searchJumpTarget: target }),
}));
