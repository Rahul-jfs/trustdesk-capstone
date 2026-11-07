/**
 * Input pre-check for customer text. It flags instruction-like content so the trace records it and
 * the draft and action paths can respond. Customer text is untrusted; a flag is a signal, not a verdict.
 */

/** Flags that mean the customer is trying to change the AI's behavior or get protected information. */
export const SEVERE_FLAGS = ['instruction_override', 'secret_request', 'hide_from_reviewer', 'policy_bypass'];

const INPUT_RULES = [
  {
    flag: 'instruction_override',
    patterns: [
      /\bignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)?\s*(instructions|policies|policy|rules)\b/i,
      /\bsystem\s+override\b/i,
      /\byou\s+are\s+now\s+allowed\b/i,
      /\bthe\s+policy\s+has\s+changed\b/i,
    ],
  },
  {
    flag: 'secret_request',
    patterns: [
      /\b(print|reveal|show|send|dump)\b.{0,40}\b(system\s+prompt|hidden\s+(prompt|instructions)|api\s*key|internal\s+notes?|secrets?)\b/i,
      /\bapi[\s_-]?keys?\b/i,
      /\bhidden\s+system\s+prompt\b/i,
    ],
  },
  {
    flag: 'hide_from_reviewer',
    patterns: [
      /\b(do\s+not|don't|never)\s+(mention|tell|reveal|show)\b.{0,40}\b(human|reviewer|agent|specialist|support)\b/i,
      /\bhide\b.{0,40}\b(from|reviewer|human)\b/i,
    ],
  },
  {
    flag: 'policy_bypass',
    patterns: [
      /\bignore\s+(the\s+)?(identity|verification)\s+checks?\b/i,
      /\bskip\s+(the\s+)?(identity|verification|security)\s+checks?\b/i,
      /\bwithout\s+(verification|identity\s+checks?)\b/i,
    ],
  },
];

const SAFETY_PATTERNS = [
  /\bbattery\s+(is\s+)?(swell|bulg)/i,
  /\bswell(ing|s|ed)?\b/i,
  /\boverheat/i,
  /\bburning\s+smell\b/i,
  /\bexposed\s+wires?\b/i,
  /\belectric(al)?\s+shock\b/i,
  /\bsmoke\b/i,
  /\bsparks?\b/i,
];

/**
 * @param {string} text customer subject and body
 * @returns {{ flags: string[] }} the distinct flags found, in rule order
 */
export function precheckText(text) {
  const flags = INPUT_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.flag);
  return { flags };
}

/** True when the text describes a safety problem (for example battery swelling). Policy: escalate with urgent priority. */
export function detectSafetyConcern(text) {
  return SAFETY_PATTERNS.some((pattern) => pattern.test(text));
}
