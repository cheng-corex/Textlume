# Textlume

轻量、快速的跨平台文本编辑器。

基于 **Tauri v2** + **React** + **CodeMirror 6** 构建，原生性能，极简界面。

## ✨ 特性

- 🚀 **Tauri 原生** — Rust 后端，启动快、内存小
- 🎨 **6 套主题** — Dark+ / Light+ / One Dark Pro / Dracula / Monokai / Nord，一键切换
- 📂 **文件树** — 拖拽移动、复制粘贴（Ctrl+C/X/V）、右键菜单、新建/删除/重命名
- 🔍 **三种搜索** — 文件内查找替换、CodeMirror 原生搜索、全局跨文件正则搜索
- 📝 **Markdown 预览** — 编辑 .md 文件时实时预览
- 🛠 **文本工具** — 大小写转换、行排序、去重、JSON 格式化、Base64 编解码
- 📑 **多标签页** — Ctrl+Tab 切换、Ctrl+W 关闭
- 🪟 **Windows 文件关联** — 安装包仅关联常用文本文件；代码和网页文件仍可在 Textlume 中打开，但不会主动修改系统默认应用
- 💾 **会话恢复** — 启动时自动恢复上次打开的文件和编辑状态
- 🖥 **单实例** — 双击文件自动在已打开窗口中打开

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存 |
| `Ctrl+W` | 关闭标签 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+F` | 文件内查找 |
| `Ctrl+H` | 查找替换 |
| `Ctrl+Shift+F` | 全局搜索 |
| `Ctrl+Tab` | 切换标签 |
| `Ctrl+C / X / V` | 文件树复制/剪切/粘贴 |
| `Delete` | 删除选中文件 |

## 🛠 开发

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run tauri dev

# 生产构建
npm run tauri build
```

## 📦 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 (Rust) |
| 前端 | React 18 + TypeScript |
| 编辑器 | CodeMirror 6 |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS + CSS 变量 |
| 构建 | Vite |

## 📄 License

MIT

