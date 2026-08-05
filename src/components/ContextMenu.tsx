import { useState, useRef, useEffect, useCallback } from "react";

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const show = useCallback((e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const hide = useCallback(() => setMenu(null), []);

  const handlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  useEffect(() => {
    if (menu) {
      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest(".context-menu")) {
          hide();
        }
      };
      handlerRef.current = handler;
      // Delay to prevent immediate close
      setTimeout(() => document.addEventListener("mousedown", handler), 0);
      return () => {
        document.removeEventListener("mousedown", handler);
      };
    }
  }, [menu, hide]);

  const menuEl = menu ? (
    <ContextMenu
      items={menu.items}
      x={menu.x}
      y={menu.y}
      onClose={hide}
    />
  ) : null;

  return { show, hide, menu: menuEl };
}

function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const { innerWidth, innerHeight } = window;
      if (rect.right > innerWidth) ref.current.style.left = `${x - rect.width}px`;
      if (rect.bottom > innerHeight) ref.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="context-menu fixed z-[9999] min-w-[180px] py-1 rounded-lg shadow-2xl animate-fade-in"
      style={{
        left: x,
        top: y,
        backgroundColor: "var(--bg-elevated, #2d2d2d)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--border)" }} />;
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors"
            style={{
              color: item.disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
              cursor: item.disabled ? "default" : "pointer",
            }}
            onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            {item.icon && <span className="w-4 flex items-center justify-center" style={{ color: "var(--text-tertiary)" }}>{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
