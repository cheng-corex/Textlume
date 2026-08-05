export interface TextlumeCommand {
  id: string;
  title: string;
  category: string;
  keybind?: string;
  enabled?: () => boolean;
  run: (...args: unknown[]) => Promise<void> | void;
}

class CommandRegistry {
  private commands = new Map<string, TextlumeCommand>();

  register(command: TextlumeCommand): void {
    this.commands.set(command.id, command);
  }

  get(id: string): TextlumeCommand | undefined {
    return this.commands.get(id);
  }

  getAll(): TextlumeCommand[] {
    return Array.from(this.commands.values());
  }

  getByCategory(category: string): TextlumeCommand[] {
    return this.getAll().filter((c) => c.category === category);
  }

  async execute(id: string, ...args: unknown[]): Promise<void> {
    const command = this.commands.get(id);
    if (!command) {
      console.warn(`Command not found: ${id}`);
      return;
    }
    if (command.enabled && !command.enabled()) return;
    await command.run(...args);
  }
}

export const commandRegistry = new CommandRegistry();

// Pre-register stub commands — actual handlers are wired in App.tsx
export function registerDefaultCommands(): void {
  const stubs = [
    { id: "file.new", title: "新建", category: "File", keybind: "Ctrl+N" },
    { id: "file.open", title: "打开", category: "File", keybind: "Ctrl+O" },
    { id: "file.save", title: "保存", category: "File", keybind: "Ctrl+S" },
    { id: "search.find", title: "查找", category: "Search", keybind: "Ctrl+F" },
    { id: "search.replace", title: "替换", category: "Search", keybind: "Ctrl+H" },
  ];
  for (const s of stubs) {
    commandRegistry.register({ ...s, run: () => {} });
  }
}
