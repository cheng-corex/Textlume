import { X } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import type { TextEncoding, LineEnding } from "../core/documents/documentTypes";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.updateSettings);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        className="w-[480px] max-h-[80vh] overflow-y-auto rounded-lg shadow-2xl"
        style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>设置</span>
          <button onClick={onClose} className="p-0.5 hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-tertiary)" }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Editor Settings */}
          <Section title="编辑器">
            <Row label="字体大小">
              <input
                type="number" min={10} max={32} value={settings.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                className="w-20 px-2 py-1 text-[13px] text-right border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
              />
            </Row>
            <Row label="Tab 大小">
              <select
                value={settings.tabSize}
                onChange={(e) => update({ tabSize: Number(e.target.value) })}
                className="px-2 py-1 text-[13px] border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
              >
                {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Row>
            <Row label="使用空格缩进">
              <Toggle checked={settings.insertSpaces} onChange={(v) => update({ insertSpaces: v })} />
            </Row>
            <Row label="自动换行">
              <Toggle checked={settings.wordWrap} onChange={(v) => update({ wordWrap: v })} />
            </Row>
            <Row label="显示行号">
              <Toggle checked={settings.showLineNumbers} onChange={(v) => update({ showLineNumbers: v })} />
            </Row>
          </Section>

          {/* File Settings */}
          <Section title="文件">
            <Row label="默认编码">
              <select
                value={settings.defaultEncoding}
                onChange={(e) => update({ defaultEncoding: e.target.value as TextEncoding })}
                className="px-2 py-1 text-[13px] border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
              >
                {["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gbk", "latin1"].map((e) => (
                  <option key={e} value={e}>{e.toUpperCase()}</option>
                ))}
              </select>
            </Row>
            <Row label="默认行尾">
              <select
                value={settings.defaultLineEnding}
                onChange={(e) => update({ defaultLineEnding: e.target.value as LineEnding })}
                className="px-2 py-1 text-[13px] border rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--text-primary)", borderColor: "var(--input-border)" }}
              >
                {["LF", "CRLF", "CR"].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </Row>
          </Section>

          {/* Session Settings */}
          <Section title="会话">
            <Row label="启动时恢复会话">
              <Toggle checked={settings.restoreSessionOnStartup} onChange={(v) => update({ restoreSessionOnStartup: v })} />
            </Row>
            <Row label="自动保存恢复草稿">
              <Toggle checked={settings.autoSaveRecoveryDraft} onChange={(v) => update({ autoSaveRecoveryDraft: v })} />
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-2 uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-8 h-4 rounded-full transition-colors"
      style={{ backgroundColor: checked ? "var(--accent)" : "var(--bg-hover)" }}
    >
      <span
        className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
        style={{ left: checked ? "calc(100% - 14px)" : "2px" }}
      />
    </button>
  );
}