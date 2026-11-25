/**
 * Cheap token estimation without a tokenizer dependency.
 * Cyrillic text tokenizes less efficiently than Latin, so the ratio is lower.
 * Used for context budgeting and quota pre-checks; provider-reported usage wins when available.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cyrillic = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
  }
  const latin = text.length - cyrillic;
  return Math.ceil(latin / 4 + cyrillic / 2.5) + 1;
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  // ~4 tokens of per-message overhead in chat formats
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/** Truncate text to approximately `maxTokens`, keeping the beginning. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}
