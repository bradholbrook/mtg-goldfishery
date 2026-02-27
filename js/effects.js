/**
 * MTG Goldfish Simulator - Effect Tag Detection
 *
 * Converts Scryfall oracle text into structured EffectTag objects.
 * All regex runs at enrichment time — never during simulation.
 *
 * Exported: detectEffectTags(oracleText, keywords) → EffectTag[]
 */

// ─── Timing Patterns ──────────────────────────────────────────────────────────

const TIMING_PATTERNS = [
  { timing: 'etb',      re: /when\b[^.]*\benters\b/i },
  { timing: 'upkeep',   re: /at the beginning of your upkeep/i },
  { timing: 'tap',      re: /\{T\}\s*:/i },
  { timing: 'cast',     re: /when(?:ever)? you cast\b/i },
  { timing: 'draw_step',re: /when(?:ever)? you draw\b/i },
  { timing: 'death',    re: /when\b[^.]*\bdies\b/i },
];

/**
 * Split oracle text into sentences for localised pattern matching.
 * Handles em-dash abilities and bullet paragraphs.
 */
function splitSentences(text) {
  // Split on period followed by space/newline, or on newlines that start a new ability
  return text
    .split(/\.\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Determine the timing of an effect based on the sentence that contains the
 * effect pattern and the sentence immediately preceding it (trigger context).
 *
 * @param {string[]} sentences - All sentences of oracle text
 * @param {number}   matchIdx  - Index of the sentence containing the effect pattern
 * @returns {string} timing value
 */
function detectTiming(sentences, matchIdx) {
  // Check the sentence itself and the one before it
  const context = [
    sentences[matchIdx],
    matchIdx > 0 ? sentences[matchIdx - 1] : '',
  ].join(' ');

  for (const { timing, re } of TIMING_PATTERNS) {
    if (re.test(context)) return timing;
  }
  return 'passive';
}

// ─── Scaling Tap Draw ─────────────────────────────────────────────────────────

/**
 * Matches "{T}: Put a COUNTER counter on CARD, then draw a card for each COUNTER counter"
 * Captures the counter type name (e.g. "burden" for The One Ring).
 * Must be checked before the generic conditional draw patterns.
 */
const DRAW_SCALING_TAP_PATTERN = /\{T\}:[^.]*put (?:a|an?) (\w+) counter[^.]*draw a card for each \1 counter/i;

// ─── Draw Pattern Library ─────────────────────────────────────────────────────

const WORD_TO_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/**
 * Parse a numeric word or digit string to a number.
 * e.g. "two" → 2, "3" → 3
 */
function parseCount(str) {
  if (!str) return 1;
  const lower = str.toLowerCase();
  if (WORD_TO_NUM[lower] !== undefined) return WORD_TO_NUM[lower];
  const n = parseInt(str, 10);
  return isNaN(n) ? 1 : n;
}

/** Patterns that indicate an unconditional draw. Captures optional count. */
const DRAW_UNCONDITIONAL_PATTERNS = [
  // "draw a card" — value 1
  { re: /\bdraw a card\b/i, getValue: () => 1, conditional: false },
  // "draw two/three/four cards" — word count
  { re: /\bdraw (two|three|four|five|six|seven) cards?\b/i, getValue: m => parseCount(m[1]), conditional: false },
  // "draw N cards" — digit count
  { re: /\bdraw (\d+) cards?\b/i, getValue: m => parseCount(m[1]), conditional: false },
];

/** Patterns that indicate a conditional draw (requires extra check/cost/trigger). */
const DRAW_CONDITIONAL_PATTERNS = [
  // "you may draw a card"
  { re: /\byou may draw a card\b/i, getValue: () => 1, conditional: true, condition: 'may draw' },
  // "draw a card if ..."
  { re: /\bdraw a card if\b/i, getValue: () => 1, conditional: true, condition: 'conditional draw' },
  // "draw a card for each ..."
  { re: /\bdraw a card for each\b/i, getValue: () => null, conditional: true, condition: 'draw per condition' },
  // "draw X cards for each ..."  or "draw cards equal to ..."
  { re: /\bdraw (?:cards?|a card) equal to\b/i, getValue: () => null, conditional: true, condition: 'draw equal to' },
];

/** Loot pattern: "draw N cards, then discard N cards" */
const LOOT_PATTERN = /\bdraw (?:a|\d+|two|three) cards?,\s*(?:then\s*)?discard\b/i;

/** Cantrip draw — "draw a card" preceded by self-discard (loot variant check) */
// We check loot BEFORE unconditional draw to avoid double-tagging

// ─── Tag Builders ─────────────────────────────────────────────────────────────

/**
 * Assign a tier based on timing, conditional flag, value, and subtype.
 *
 * @param {string}  timing
 * @param {boolean} isConditional
 * @param {number|null} value
 * @param {string}  subtype
 * @returns {'simulatable'|'simulatable_soon'|'track_only'|'skip'}
 */
function assignTier(timing, isConditional, value, subtype) {
  // Scaling tap draw always simulatable (value is dynamic — tracked via counters)
  if (subtype === 'draw_scaling_tap') return 'simulatable';
  if (isConditional) return 'track_only';
  if (subtype === 'loot') return 'simulatable_soon';
  // ETB, upkeep, spell resolution, and unconditional tap draws of any value
  if (timing === 'etb'     && value !== null && value >= 1) return 'simulatable';
  if (timing === 'upkeep'  && value !== null && value >= 1) return 'simulatable';
  if (timing === 'passive' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'tap'     && value !== null && value >= 1) return 'simulatable';
  if (timing === 'cast') return 'simulatable_soon';
  if (timing === 'death') return 'simulatable_soon';
  return 'track_only';
}

/**
 * Build an EffectTag for a draw effect.
 */
function makeDrawTag(subtype, timing, value, isConditional, condition = null) {
  return {
    category: 'draw',
    subtype,
    timing,
    value,
    isConditional,
    condition,
    tier: assignTier(timing, isConditional, value, subtype),
    source: 'auto',
  };
}

// ─── Main Detection Function ──────────────────────────────────────────────────

/**
 * Detect effect tags from a card's oracle text and keyword list.
 *
 * Patterns are checked in priority order:
 *   1. Loot (draw + discard) — checked first to prevent double-tagging
 *   2. Unconditional draws
 *   3. Conditional draws
 *
 * @param {string|null} oracleText
 * @param {string[]}    [keywords=[]]
 * @returns {import('./types.js').EffectTag[]}
 */
export function detectEffectTags(oracleText, keywords = []) {
  const tags = [];
  if (!oracleText) return tags;

  const sentences = splitSentences(oracleText);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // ── 0. Scaling tap draw (e.g. The One Ring burden counters) ───────────────
    // Must run before the generic conditional-draw check since "draw a card for
    // each COUNTER counter" would otherwise be flagged as conditional.
    const scalingMatch = sentence.match(DRAW_SCALING_TAP_PATTERN);
    if (scalingMatch) {
      tags.push({
        category: 'draw',
        subtype: 'draw_scaling_tap',
        timing: 'tap',
        value: null,          // dynamic — tracked via BattlefieldCard.counters
        isConditional: false,
        condition: null,
        counterType: scalingMatch[1].toLowerCase(), // e.g. 'burden'
        tier: 'simulatable',
        source: 'auto',
      });
      continue;
    }

    // ── 1. Loot ──────────────────────────────────────────────────────────────
    const lootMatch = sentence.match(LOOT_PATTERN);
    if (lootMatch) {
      const timing = detectTiming(sentences, i);
      tags.push(makeDrawTag('loot', timing, null, false, null));
      continue; // Don't also tag this sentence as a plain draw
    }

    // ── 2. Unconditional draws ────────────────────────────────────────────────
    let foundDraw = false;
    for (const { re, getValue, conditional } of DRAW_UNCONDITIONAL_PATTERNS) {
      const m = sentence.match(re);
      if (m) {
        const value = getValue(m);
        const timing = detectTiming(sentences, i);
        tags.push(makeDrawTag('draw_n', timing, value, conditional));
        foundDraw = true;
        break; // Only one unconditional draw tag per sentence
      }
    }
    if (foundDraw) continue;

    // ── 3. Conditional draws ──────────────────────────────────────────────────
    for (const { re, getValue, conditional, condition } of DRAW_CONDITIONAL_PATTERNS) {
      const m = sentence.match(re);
      if (m) {
        const value = getValue(m);
        const timing = detectTiming(sentences, i);
        tags.push(makeDrawTag('draw_n', timing, value, conditional, condition));
        break;
      }
    }
  }

  return tags;
}

// ─── Utility: Filter by simulation tier ───────────────────────────────────────

/**
 * Return only tags that should fire during Phase 1 simulation.
 * @param {import('./types.js').EffectTag[]} tags
 * @returns {import('./types.js').EffectTag[]}
 */
export function getSimulatableTags(tags) {
  return tags.filter(t => t.tier === 'simulatable');
}

/**
 * Return tags that are tracked-only (fire in stats but not simulation).
 * @param {import('./types.js').EffectTag[]} tags
 * @returns {import('./types.js').EffectTag[]}
 */
export function getTrackOnlyTags(tags) {
  return tags.filter(t => t.tier === 'track_only');
}

/**
 * Check if a card has any draw effect (for stats labeling).
 * @param {import('./types.js').EffectTag[]} tags
 * @returns {boolean}
 */
export function hasDrawEffect(tags) {
  return tags.some(t => t.category === 'draw');
}
