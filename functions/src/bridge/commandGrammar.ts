// ─────────────────────────────────────────────────────────────────────
// Wugi — Bridge v1.3: inbound SMS command grammar + PM-verdict parsing
//
// Pure parsing functions, no Firebase/Twilio/GitHub/Asana deps, so they
// can be exercised by scripts/test-inbound-grammar.js without an
// emulator or live credentials. See that script for the grammar's test
// cases — treat it as the spec when changing anything here.
// ─────────────────────────────────────────────────────────────────────

export type InboundCommand =
  | { kind: 'MERGE'; prNumber: number }
  | { kind: 'MERGE_ALL' }
  | { kind: 'CONFIRM_YES' }
  | { kind: 'HOLD'; prNumber: number }
  | { kind: 'STATUS' }
  | { kind: 'REWORK'; prNumber: number; notes: string }
  | { kind: 'UNKNOWN'; raw: string };

/**
 * Parse one inbound SMS body into a command. Whitespace-tolerant,
 * case-insensitive on the verb. `REWORK <n> <notes>` requires non-empty
 * notes — free text is what gets posted as the @claude comment, so an
 * empty rework is treated as unknown rather than silently doing nothing.
 */
export function parseInboundCommand(rawBody: string): InboundCommand {
  const body = (rawBody ?? '').trim();
  const raw = body;

  if (/^yes$/i.test(body)) return { kind: 'CONFIRM_YES' };
  if (/^status$/i.test(body)) return { kind: 'STATUS' };
  if (/^merge\s+all$/i.test(body)) return { kind: 'MERGE_ALL' };

  const mergeMatch = body.match(/^merge\s+#?(\d+)$/i);
  if (mergeMatch) return { kind: 'MERGE', prNumber: Number(mergeMatch[1]) };

  const holdMatch = body.match(/^hold\s+#?(\d+)$/i);
  if (holdMatch) return { kind: 'HOLD', prNumber: Number(holdMatch[1]) };

  const reworkMatch = body.match(/^rework\s+#?(\d+)\s+(\S[\s\S]*)$/i);
  if (reworkMatch) return { kind: 'REWORK', prNumber: Number(reworkMatch[1]), notes: reworkMatch[2].trim() };

  return { kind: 'UNKNOWN', raw };
}

export interface PmVerdict {
  prNumber: number | null;
  verdict: 'APPROVE' | 'REWORK' | 'HOLD' | null;
  tscLine: string | null;
}

/** Does this Asana comment open the "PM CODE REVIEW" verdict block? */
export function isPmCodeReviewComment(text: string): boolean {
  return /^pm code review\b/i.test((text ?? '').trim());
}

/**
 * Pull PR#, VERDICT, and the tsc result line out of a "PM CODE REVIEW"
 * Asana comment. Loose regexes on purpose — the comment is free text
 * authored outside this codebase; missing fields degrade to null rather
 * than throwing, and the SMS composer falls back to an excerpt.
 */
export function parsePmVerdict(text: string): PmVerdict {
  const prMatch = text.match(/PR\s*#\s*(\d+)/i);
  const verdictMatch = text.match(/VERDICT:?\s*(APPROVE|REWORK|HOLD)/i);
  const tscMatch = text.match(/^.*\btsc\b.*$/im);
  return {
    prNumber: prMatch ? Number(prMatch[1]) : null,
    verdict: verdictMatch ? (verdictMatch[1].toUpperCase() as PmVerdict['verdict']) : null,
    tscLine: tscMatch ? tscMatch[0].trim() : null,
  };
}

/** Compressed verdict SMS body for Jarrod, per the v1.3 spec. */
export function composeVerdictSms(verdict: PmVerdict): string {
  const pr = verdict.prNumber !== null ? `PR #${verdict.prNumber}` : 'PR (number not found)';
  const v = verdict.verdict ?? 'UNKNOWN';
  const tsc = verdict.tscLine ? `\n${verdict.tscLine}` : '';
  const n = verdict.prNumber ?? '<n>';
  return `Wugi PM Review — ${pr}: ${v}${tsc}\nReply MERGE ${n} / HOLD ${n} / REWORK ${n} <notes>`;
}
