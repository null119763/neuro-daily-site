/**
 * Attachment intake: validates uploads and extracts plain text.
 *
 * Policy (AUDEN_MASTER: "text/PDF with limits and checks"; SECURITY: documents are untrusted):
 * - Only plain text, Markdown/CSV and PDF. The type is decided by content sniffing, not by the browser's MIME.
 * - Only the extracted text is stored, never the original file (data minimisation, no file storage needed).
 * - PDF parsing extracts text only (no rendering, no scripts), bounded by pages, characters and time.
 * - Extracted text reaches the model inside a clearly marked untrusted <document> block.
 */
export const ATTACHMENT_LIMITS = {
  /** Below typical serverless request limits (Netlify ~6 MB, Vercel ~4.5 MB). */
  maxBytes: 4 * 1024 * 1024,
  maxChars: 60_000,
  maxPdfPages: 150,
  perMessage: 3,
  perDay: 30,
  pdfTimeoutMs: 15_000,
} as const;

export type AttachmentMime = "text/plain" | "text/markdown" | "application/pdf";

export class AttachmentError extends Error {
  constructor(
    readonly code: "too_large" | "unsupported_type" | "empty_file" | "no_text" | "pdf_error" | "too_many_pages" | "binary_text",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ExtractedAttachment {
  name: string;
  mime: AttachmentMime;
  size: number;
  text: string;
  truncated: boolean;
}

const TEXT_EXT = /\.(txt|text|log|md|markdown|csv|tsv)$/i;
const MD_EXT = /\.(md|markdown)$/i;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[\u0000-\u001f\u007f<>"]/g, "").trim();
  return (clean || "file").slice(0, 120);
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by a little junk; the spec allows it within the first 1024 bytes.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

function decodeText(bytes: Uint8Array): string {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // UTF-8 BOM
  const body = bytes.subarray(start);
  if (body.includes(0)) throw new AttachmentError("binary_text", "The file looks binary, not text");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    // Legacy Russian text files are often Windows-1251.
    return new TextDecoder("windows-1251").decode(body);
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= ATTACHMENT_LIMITS.maxChars) return { text, truncated: false };
  return { text: text.slice(0, ATTACHMENT_LIMITS.maxChars), truncated: true };
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const { getDocumentProxy } = await import("unpdf");
  const work = (async () => {
    let doc;
    try {
      // Copy: pdf.js may transfer/detach the buffer it is given.
      doc = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true, verbosity: 0 });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      throw new AttachmentError("pdf_error", /password/i.test(msg) ? "Password-protected PDFs are not supported" : "Could not read the PDF");
    }
    try {
      if (doc.numPages > ATTACHMENT_LIMITS.maxPdfPages) throw new AttachmentError("too_many_pages");
      const pages: string[] = [];
      let total = 0;
      for (let i = 1; i <= doc.numPages && total <= ATTACHMENT_LIMITS.maxChars; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) {
          if ("str" in item) pageText += item.str + (item.hasEOL ? "\n" : "");
        }
        pages.push(pageText);
        total += pageText.length;
        page.cleanup();
      }
      return cap(normalize(pages.join("\n\n")));
    } finally {
      await doc.loadingTask.destroy();
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttachmentError("pdf_error", "PDF processing timed out")), ATTACHMENT_LIMITS.pdfTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function extractAttachment(fileName: string, bytes: Uint8Array): Promise<ExtractedAttachment> {
  const name = sanitizeFileName(fileName);
  if (bytes.byteLength === 0) throw new AttachmentError("empty_file");
  if (bytes.byteLength > ATTACHMENT_LIMITS.maxBytes) throw new AttachmentError("too_large");

  let mime: AttachmentMime;
  let result: { text: string; truncated: boolean };
  if (isPdf(bytes)) {
    mime = "application/pdf";
    result = await extractPdf(bytes);
  } else if (TEXT_EXT.test(name)) {
    mime = MD_EXT.test(name) ? "text/markdown" : "text/plain";
    result = cap(normalize(decodeText(bytes)));
  } else {
    throw new AttachmentError("unsupported_type");
  }
  if (!result.text.trim()) throw new AttachmentError("no_text", mime === "application/pdf" ? "No text layer (scanned PDF?)" : "The file is empty");
  return { name, mime, size: bytes.byteLength, ...result };
}
