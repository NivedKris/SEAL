/**
 * Identifier masking applied to every prompt before a model call (plan §7).
 * The data is synthetic, but the layer is real: Emirates IDs, MRNs, member numbers,
 * phone numbers and e-mails are replaced with stable placeholders.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b784-\d{4}-\d{7}-\d\b/g, "[EMIRATES_ID]"],
  [/\b\d{3}-\d{4}-\d{7}-\d\b/g, "[EMIRATES_ID]"],
  [/\bMRN-?\d{5,}\b/gi, "[MRN]"],
  [/\b(?:\+971|00971|0)5\d[ -]?\d{3}[ -]?\d{4}\b/g, "[PHONE]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[EMAIL]"],
  [/\b[A-Z]{2,4}-\d{6,}-\d{2}\b/g, "[MEMBER_NO]"],
];

export function maskIdentifiers(text: string): string {
  return PATTERNS.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

/** True when no known identifier pattern survives in the text. */
export function maskingPassed(text: string): boolean {
  return PATTERNS.every(([re]) => {
    re.lastIndex = 0;
    return !re.test(text);
  });
}
