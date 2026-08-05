import { useDocumentStore } from "../stores/documentStore";

export function toUpperCase(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  useDocumentStore.getState().updateContent(documentId, doc.content.toUpperCase());
}

export function toLowerCase(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  useDocumentStore.getState().updateContent(documentId, doc.content.toLowerCase());
}

export function removeDuplicateLines(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const lines = doc.content.split("\n");
  const seen = new Set<string>();
  const result = lines.filter((l) => {
    const trimmed = l.trim();
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
  useDocumentStore.getState().updateContent(documentId, result.join("\n"));
}

export function sortLines(documentId: string, desc = false) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const lines = doc.content.split("\n");
  lines.sort(desc ? (a, b) => b.localeCompare(a) : (a, b) => a.localeCompare(b));
  useDocumentStore.getState().updateContent(documentId, lines.join("\n"));
}

export function removeEmptyLines(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const lines = doc.content.split("\n").filter((l) => l.trim().length > 0);
  useDocumentStore.getState().updateContent(documentId, lines.join("\n"));
}

export function reverseLines(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const lines = doc.content.split("\n").reverse();
  useDocumentStore.getState().updateContent(documentId, lines.join("\n"));
}

export function joinLines(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const lines = doc.content.split("\n").map((l) => l.trim());
  useDocumentStore.getState().updateContent(documentId, lines.join(" "));
}

export function formatJson(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  try {
    const parsed = JSON.parse(doc.content);
    useDocumentStore.getState().updateContent(documentId, JSON.stringify(parsed, null, 2));
  } catch {
    // noop
  }
}

export function minifyJson(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  try {
    const parsed = JSON.parse(doc.content);
    useDocumentStore.getState().updateContent(documentId, JSON.stringify(parsed));
  } catch {
    // noop
  }
}

export function encodeBase64(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  useDocumentStore.getState().updateContent(documentId, btoa(doc.content));
}

export function decodeBase64(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  try {
    useDocumentStore.getState().updateContent(documentId, atob(doc.content));
  } catch {
    // noop
  }
}

export function toTitleCase(documentId: string) {
  const doc = useDocumentStore.getState().documents.get(documentId);
  if (!doc) return;
  const result = doc.content.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
  useDocumentStore.getState().updateContent(documentId, result);
}
