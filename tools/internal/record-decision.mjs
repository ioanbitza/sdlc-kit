// The writer behind `review.mjs decide`: validates the human's accept and reject lists against the rendered cycle and
// writes docs/review/<cycle>/decisions.json. It asks nothing: review.mjs decide asks on the terminal before calling it,
// and the kit's own tests call it directly. It is not a CLI and the guards refuse the file it writes to every agent.
import { join } from 'node:path';
import { readState, writeState, writeFile, expandFids, REVIEW_DIR, STATE_FILE, MAX_CYCLE } from '../review.mjs';

export function recordDecision(root, cycle, options = {}) {
  const state = readState(root);
  if (!state || state.cycle !== cycle || !state.rendered) return { ok: false, lines: [`Decision refused: cycle ${cycle} is not the rendered cycle in ${STATE_FILE}.`] };
  const confirmed = (state.confirmed ?? []).map((f) => f.fid);
  const accepted = expandFids(options.accept);
  const rejected = expandFids(options.reject);
  const bad = [...accepted, ...rejected].filter((id) => !confirmed.includes(id));
  if (bad.length) return { ok: false, lines: [`Decision refused: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not confirmed in cycle ${cycle} (confirmed: ${confirmed.join(', ') || 'none'}).`] };
  const twice = accepted.filter((id) => rejected.includes(id));
  if (twice.length) return { ok: false, lines: [`Decision refused: ${twice.join(', ')} in both lists; each F-id goes in exactly one.`] };
  const missing = confirmed.filter((id) => !accepted.includes(id) && !rejected.includes(id));
  if (missing.length) return { ok: false, lines: [`Decision refused: ${missing.join(', ')} not decided; every confirmed F-id goes in --accept or --reject.`] };
  const decisions = { cycle, accepted, rejected, note: options.note ?? '', decidedAt: new Date().toISOString() };
  writeFile(join(root, REVIEW_DIR, String(cycle), 'decisions.json'), JSON.stringify(decisions, null, 2) + '\n');
  writeState(root, { ...state, decisions });
  return {
    ok: true,
    decisions,
    lines: [
      `decided  cycle ${cycle}: ${accepted.length} accepted (${accepted.join(', ') || 'none'}), ${rejected.length} rejected (${rejected.join(', ') || 'none'})${options.note ? `; note: ${options.note}` : ''}`,
      `next     fix the accepted ones in their slices, then: /sdlc-kit:review-change --cycle ${cycle + 1}${cycle >= MAX_CYCLE ? ' is not available (last cycle); the human ships or reopens as a requirement' : ''}`,
    ],
  };
}
