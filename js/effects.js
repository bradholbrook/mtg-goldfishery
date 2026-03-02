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
  // More specific ETB patterns must come before the broad 'etb' catch-all
  { timing: 'land_etb',     re: /when(?:ever)?\b[^.]*\ba land\b[^.]*\benters\b|when(?:ever)? you play a land\b/i },
  { timing: 'creature_etb', re: /when(?:ever)?\b[^.]*\b(?:a|another)\b[^.]*\bcreature\b[^.]*\benters\b/i },
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
 * Build the context string for timing/filter detection:
 * the current sentence joined with the one before it (trigger context).
 *
 * @param {string[]} sentences
 * @param {number}   idx
 * @returns {string}
 */
function buildContext(sentences, idx) {
  return [sentences[idx], idx > 0 ? sentences[idx - 1] : ''].join(' ');
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
  const context = buildContext(sentences, matchIdx);
  for (const { timing, re } of TIMING_PATTERNS) {
    if (re.test(context)) return timing;
  }
  return 'passive';
}

/**
 * Detect the cast trigger filter from context text.
 * Called only when timing === 'cast'; returns null for "any spell" triggers.
 *
 * @param {string} context - sentence + preceding sentence
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectCastFilter(context) {
  if (!/when(?:ever)? you cast\b/i.test(context)) return null;
  if (/noncreature spell/i.test(context))        return { spellTypes: null, excludeTypes: ['Creature'] };
  if (/creature spell/i.test(context))           return { spellTypes: ['Creature'] };
  if (/instant or sorcery spell/i.test(context)) return { spellTypes: ['Instant', 'Sorcery'] };
  if (/artifact spell/i.test(context))           return { spellTypes: ['Artifact'] };
  if (/enchantment spell/i.test(context))        return { spellTypes: ['Enchantment'] };
  if (/your commander/i.test(context))           return { spellTypes: null, isCommander: true };
  return null; // "any spell" — no filter needed
}

// ─── Scaling Tap Draw ─────────────────────────────────────────────────────────

/**
 * Matches "{T}: Put a COUNTER counter on CARD, then draw a card for each COUNTER counter"
 * Captures the counter type name (e.g. "burden" for The One Ring).
 * Must be checked before the generic conditional draw patterns.
 */
const DRAW_SCALING_TAP_PATTERN = /\{T\}:[^.]*put (?:a|an?) (\w+) counter[^.]*draw a card for each \1 counter/i;

// ─── Loot Pattern Library ─────────────────────────────────────────────────────

/**
 * Standard loot: "draw N cards, then discard M cards" (same sentence).
 * e.g. Faithless Looting: "Draw two cards, then discard two cards."
 */
const LOOT_PATTERN = /\bdraw (?:a|\d+|two|three|four) cards?,\s*(?:then\s*)?discard\b/i;

/**
 * Rummage: "discard N cards, then draw M cards" (same sentence, discard first).
 * e.g. "Discard a card, then draw a card."
 */
const RUMMAGE_SINGLE_PATTERN = /\bdiscard (?:a|\d+|two|three|four) cards?,\s*(?:then\s*)?draw\b/i;

/**
 * Additional cost discard: "as an additional cost to cast this spell, discard N cards"
 * The draw is in the NEXT sentence. e.g. Tormenting Voice, Cathartic Reunion.
 */
const ADDITIONAL_COST_DISCARD_PATTERN =
  /\bas an additional cost to cast this spell,?\s*discard (?:a|\d+|two|three|four) cards?\b/i;

/**
 * Cross-sentence rummage: "If you do, draw N cards" following a sentence with "discard".
 * e.g. Hazoret's Monument: "...you may discard a card. If you do, draw a card."
 */
const IF_YOU_DO_DRAW_PATTERN = /\bif you do,?\s*draw\b/i;

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

/** Extract discard count from a sentence containing "discard N cards" */
function parseDiscardCount(sentence) {
  const m = sentence.match(/\bdiscard (a|\d+|two|three|four) cards?\b/i);
  return m ? parseCount(m[1]) : 1;
}

/** Extract draw count from a sentence containing "draw N cards" */
function parseDrawCount(sentence) {
  const m = sentence.match(/\bdraw (a|\d+|two|three|four) cards?\b/i);
  return m ? parseCount(m[1]) : 1;
}

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
  // Loot is now fully simulatable via resolveLootEffects + selectCardToDiscard
  if (subtype === 'loot') return 'simulatable';
  // ETB, upkeep, spell resolution, tap, and cast draws are all simulatable
  if (timing === 'etb'          && value !== null && value >= 1) return 'simulatable';
  if (timing === 'land_etb'     && value !== null && value >= 1) return 'simulatable';
  if (timing === 'creature_etb' && value !== null && value >= 1) return 'simulatable_soon';
  if (timing === 'upkeep'  && value !== null && value >= 1) return 'simulatable';
  if (timing === 'passive' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'tap'     && value !== null && value >= 1) return 'simulatable';
  if (timing === 'cast'    && value !== null && value >= 1) return 'simulatable';
  if (timing === 'death') return 'simulatable_soon';
  return 'track_only';
}

/**
 * Build an EffectTag for a draw effect.
 * @param {string}  subtype
 * @param {string}  timing
 * @param {number|null} value
 * @param {boolean} isConditional
 * @param {string|null} [condition]
 * @param {import('./types.js').TriggerFilter|null} [triggerFilter]
 */
function makeDrawTag(subtype, timing, value, isConditional, condition = null, triggerFilter = null) {
  return {
    category: 'draw',
    subtype,
    timing,
    value,
    isConditional,
    condition,
    triggerFilter,
    tier: assignTier(timing, isConditional, value, subtype),
    source: 'auto',
  };
}

/**
 * Build an EffectTag for a loot effect (draw + discard).
 * @param {string}  timing
 * @param {number}  drawCount
 * @param {number}  discardCount
 * @param {boolean} [isAdditionalCost]  - true for "as an additional cost, discard N" spells
 * @param {import('./types.js').TriggerFilter|null} [triggerFilter]
 */
function makeLootTag(timing, drawCount, discardCount, isAdditionalCost = false, triggerFilter = null) {
  return {
    category: 'draw',
    subtype: 'loot',
    timing,
    value: drawCount,
    discardCount,
    isAdditionalCost,
    isConditional: false,
    condition: null,
    triggerFilter,
    tier: 'simulatable',
    source: 'auto',
  };
}

// ─── Main Detection Function ──────────────────────────────────────────────────

/**
 * Detect effect tags from a card's oracle text and keyword list.
 *
 * Patterns are checked in priority order:
 *   1. Loot (draw + discard) — checked first to prevent double-tagging
 *   2. Conditional draws — checked before unconditional to prevent false positives
 *      (e.g. "You may draw a card." must not match the bare "draw a card" pattern)
 *   3. Unconditional draws
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
    // Compute context once for this sentence; shared by detectTiming and detectCastFilter.
    const context = buildContext(sentences, i);

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
        triggerFilter: null,
        counterType: scalingMatch[1].toLowerCase(), // e.g. 'burden'
        tier: 'simulatable',
        source: 'auto',
      });
      continue;
    }

    // ── 1a. Additional cost discard (cross-sentence) ──────────────────────────
    // "As an additional cost to cast this spell, discard N cards. Draw M cards."
    // Sentence i has the discard cost; sentence i+1 has the draw.
    if (ADDITIONAL_COST_DISCARD_PATTERN.test(sentence)) {
      const timing = detectTiming(sentences, i);
      const discardCount = parseDiscardCount(sentence);
      let drawCount = 1;
      if (i + 1 < sentences.length) {
        drawCount = parseDrawCount(sentences[i + 1]);
        i++; // consume the draw sentence
      }
      const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
      tags.push(makeLootTag(timing, drawCount, discardCount, true, triggerFilter));
      continue;
    }

    // ── 1b. If-you-do draw (cross-sentence rummage) ───────────────────────────
    // "...you may discard a card. If you do, draw a card."
    // sentence[i] = "If you do, draw a card"; sentence[i-1] has the discard.
    if (IF_YOU_DO_DRAW_PATTERN.test(sentence)) {
      const prevSentence = i > 0 ? sentences[i - 1] : '';
      if (/\bdiscard\b/i.test(prevSentence)) {
        const timing = detectTiming(sentences, i); // picks up trigger from sentence[i-1]
        const discardCount = parseDiscardCount(prevSentence);
        const drawCount = parseDrawCount(sentence);
        const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
        tags.push(makeLootTag(timing, drawCount, discardCount, false, triggerFilter));
        continue;
      }
      // If prev sentence doesn't mention discard, fall through to draw patterns
    }

    // ── 1c. Rummage: "discard N, then draw M" (same sentence) ────────────────
    if (RUMMAGE_SINGLE_PATTERN.test(sentence)) {
      const timing = detectTiming(sentences, i);
      const discardCount = parseDiscardCount(sentence);
      const drawCount = parseDrawCount(sentence);
      const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
      tags.push(makeLootTag(timing, drawCount, discardCount, false, triggerFilter));
      continue;
    }

    // ── 1d. Standard loot: "draw N, then discard M" (same sentence) ──────────
    if (LOOT_PATTERN.test(sentence)) {
      const timing = detectTiming(sentences, i);
      const drawCount = parseDrawCount(sentence);
      const discardCount = parseDiscardCount(sentence);
      const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
      tags.push(makeLootTag(timing, drawCount, discardCount, false, triggerFilter));
      continue;
    }

    // ── 2. Conditional draws ──────────────────────────────────────────────────
    // Must run before unconditional: "You may draw a card." contains "draw a card"
    // and would otherwise be mis-tagged as unconditional.
    let foundConditional = false;
    for (const { re, getValue, conditional, condition } of DRAW_CONDITIONAL_PATTERNS) {
      const m = sentence.match(re);
      if (m) {
        const value = getValue(m);
        const timing = detectTiming(sentences, i);
        const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
        tags.push(makeDrawTag('draw_n', timing, value, conditional, condition, triggerFilter));
        foundConditional = true;
        break;
      }
    }
    if (foundConditional) continue;

    // ── 3. Unconditional draws ────────────────────────────────────────────────
    for (const { re, getValue, conditional } of DRAW_UNCONDITIONAL_PATTERNS) {
      const m = sentence.match(re);
      if (m) {
        const value = getValue(m);
        const timing = detectTiming(sentences, i);
        const triggerFilter = timing === 'cast' ? detectCastFilter(context) : null;
        tags.push(makeDrawTag('draw_n', timing, value, conditional, null, triggerFilter));
        break; // Only one unconditional draw tag per sentence
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
