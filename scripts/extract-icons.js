const fs = require("fs");
const svg = fs.readFileSync(
  "node_modules/@vscode/codicons/dist/codicon.svg",
  "utf8"
);

const needed = [
  "file", "file-text", "file-code", "file-binary", "code", "json",
  "symbol-method", "symbol-interface", "symbol-module", "symbol-color",
  "symbol-key", "symbol-class", "symbol-structure", "symbol-operator",
  "symbol-misc", "symbol-numeric", "symbol-field", "terminal", "note",
  "diff", "folder", "folder-opened", "search", "files",
];

const result = {};
for (const id of needed) {
  const re = new RegExp(
    `<symbol[^>]*?id="${id}"[^>]*?>([\\s\\S]*?)<\\/symbol>`
  );
  const m = svg.match(re);
  if (m) {
    const paths = m[1].match(/<path[^>]*\/>/g);
    if (paths) {
      result[id] = paths;
    }
  }
}

fs.writeFileSync("codicon-paths.json", JSON.stringify(result, null, 2));
console.log("Extracted:", Object.keys(result).join(", "));
