import { create } from "zustand";

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: TreeNode[];
}

interface FileTreeState {
  root: string;
  tree: TreeNode[];
  expanded: Set<string>;
  selectedPath: string | null;

  setRoot: (root: string) => void;
  setTree: (tree: TreeNode[]) => void;
  toggleExpanded: (path: string) => void;
  setChildren: (path: string, children: TreeNode[]) => void;
  setSelectedPath: (path: string | null) => void;
  clear: () => void;
}

export const useFileTreeStore = create<FileTreeState>((set) => ({
  root: "",
  tree: [],
  expanded: new Set(),
  selectedPath: null,

  setRoot: (root) => set({ root }),
  setTree: (tree) => set({ tree }),

  toggleExpanded: (path) =>
    set((s) => {
      const norm = path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
      // Find the actual stored path that matches (case-insensitive)
      const findPath = (nodes: TreeNode[], target: string): string | null => {
        for (const n of nodes) {
          const nNorm = n.path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
          if (nNorm === target) return n.path;
          if (n.children) { const f = findPath(n.children, target); if (f) return f; }
        }
        return null;
      };
      const actualPath = findPath(s.tree, norm) ?? path;
      const next = new Set(s.expanded);
      if (next.has(actualPath)) {
        next.delete(actualPath);
        const clearChildren = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) =>
            n.path === actualPath ? { ...n, children: undefined } : n.children ? { ...n, children: clearChildren(n.children) } : n
          );
        return { expanded: next, tree: clearChildren(s.tree) };
      } else {
        next.add(actualPath);
        return { expanded: next };
      }
    }),

  setChildren: (path, children) =>
    set((s) => {
      const norm = path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
      const update = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          const nNorm = n.path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
          if (nNorm === norm) return { ...n, children };
          return n.children ? { ...n, children: update(n.children) } : n;
        });
      return { tree: update(s.tree) };
    }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  clear: () => set({ root: "", tree: [], expanded: new Set(), selectedPath: null }),
}));

// 导出便捷函数：直接获取选中路径
export function getSelectedPath(): string | null {
  return useFileTreeStore.getState().selectedPath;
}