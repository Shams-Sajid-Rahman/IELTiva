/**
 * What may be uploaded, decided from the file's real bytes and never from its name or the browser's claim.
 * That means a script renamed to report.pdf is refused.
 */
export type DocumentType = { contentType: string; extension: string; matches: (data: Buffer) => boolean };

const DOCUMENT_TYPES: DocumentType[] = [
  { contentType: "application/pdf", extension: "pdf", matches: (d) => d.subarray(0, 5).toString("latin1") === "%PDF-" },
  { contentType: "image/png", extension: "png", matches: (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: "image/jpeg", extension: "jpg", matches: (d) => d.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
];

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function detectDocumentType(data: Buffer) {
  return DOCUMENT_TYPES.find((type) => type.matches(data)) ?? null;
}

/** Keeps a download's name readable while removing anything that could change a path or break a header. */
export function safeFileName(name: string, extension: string) {
  const base = name
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "file"}.${extension}`;
}
