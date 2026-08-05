const fs = require("fs");
const svg = fs.readFileSync(
  "node_modules/@vscode/codicons/dist/codicon.svg",
  "utf8"
);
const ids = [
  "file", "file-text", "file-code", "code", "json",
  "symbol-method", "symbol-interface", "symbol-module", "symbol-color",
  "symbol-key", "symbol-class", "symbol-structure", "symbol-operator",
  "symbol-misc", "symbol-numeric", "symbol-field", "terminal", "note",
  "diff", "folder", "search",
];
const result = {};
for (const id of ids) {
  const re = new RegExp(
    '<symbol[^>]*?id="' + id + '"[^>]*?>([\\s\\S]*?)<\\/symbol>'
  );
  const m = svg.match(re);
  if (m) {
    const paths = m[1].match(/d="([^"]+)"/g);
    if (paths) result[id] = paths.map((x) => x.slice(2, -1));
  }
}
fs.writeFileSync("codicon-paths.json", JSON.stringify(result));
console.log("Extracted:", Object.keys(result).join(", "));
