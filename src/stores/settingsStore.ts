import { create } from "zustand";
import type { AppSettings } from "../core/documents/documentTypes";

interface SettingsState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const defaultSettings: AppSettings = {
  theme: "dark",
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  showLineNumbers: true,
  showMinimap: false,
  defaultEncoding: "utf-8",
  defaultLineEnding: "LF",
  restoreSessionOnStartup: true,
  autoSaveRecoveryDraft: true,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),
  resetSettings: () => set({ settings: defaultSettings }),
}));
