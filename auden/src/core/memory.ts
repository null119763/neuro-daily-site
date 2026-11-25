/**
 * Detects explicit "remember" commands. The result is only a *proposal*:
 * the user must confirm it before it is used in context (MEMORY_SYSTEM.md).
 */
const PATTERNS: RegExp[] = [
  /^\s*(?:auden[,:]?\s*)?запомни(?:,|:)?\s*(?:что\s+)?(.+)$/is,
  /^\s*(?:auden[,:]?\s*)?remember(?:,|:)?\s*(?:that\s+)?(.+)$/is,
];

export const MAX_MEMORY_CHARS = 500;

export function detectMemoryProposal(message: string): string | null {
  for (const re of PATTERNS) {
    const m = re.exec(message);
    if (m?.[1]) {
      const fact = m[1].replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
      if (fact.length >= 3) return fact.slice(0, MAX_MEMORY_CHARS);
    }
  }
  return null;
}
