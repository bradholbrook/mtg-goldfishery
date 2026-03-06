/**
 * MTG Goldfish Simulator - Effect Tag Detection
 *
 * Converts Scryfall oracle text into structured EffectTag objects.
 * All regex runs at enrichment time — never during simulation.
 *
 * Exported: detectEffectTags(oracleText, keywords, cardTypes) → EffectTag[]
 *
 * Architecture (Proposal F):
 *   Oracle text is split into ParsedAbility objects (triggered / activated / spell).
 *   Timing is detected from the TRIGGER/COST clause only.
 *   Draw patterns are matched against the EFFECT clause only.
 *   This prevents trigger-clause false positives (e.g. Sheoldred).
 */

// ─── Ability Parsing ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParsedAbility
 * @property {'triggered'|'activated'|'spell'} abilityType
 * @property {string|null} trigger  - condition clause for triggered; cost for activated; null for spell
 * @property {string}      effect   - the clause where effects happen
 * @property {string}      raw      - the full original block
 */

/**
 * Parse a single newline-delimited oracle text block into a ParsedAbility.
 * @param {string} block
 * @returns {ParsedAbility|null}
 */
function parseAbilityBlock(block) {
  if (!block) return null;

  // Strip ability word prefix (e.g. "Landfall — ", "Morbid — ", "Spell mastery — ")
  // Only strip if the prefix leads into a trigger word (When/Whenever/At).
  const normalized = block.replace(/^.+?—\s*(?=when(?:ever)?\b|at\b)/i, '');

  // Triggered ability: starts with When/Whenever/At
  // Use non-greedy trigger capture so "at beginning of upkeep, if X, draw" splits correctly:
  //   trigger = "beginning of upkeep"
  //   effect  = "if X, draw a card"
  const triggeredMatch = normalized.match(/^(when(?:ever)?|at)\s+(.+?),\s*(.+)$/is);
  if (triggeredMatch) {
    return {
      abilityType: 'triggered',
      trigger: triggeredMatch[2].trim(),
      effect: triggeredMatch[3].trim(),
      raw: block,
    };
  }

  // Activated ability: Cost: Effect — but not if block starts with a trigger/condition word
  if (!/^(when(?:ever)?|at|if)\b/i.test(normalized)) {
    const colonIdx = normalized.indexOf(': ');
    if (colonIdx > 0) {
      return {
        abilityType: 'activated',
        trigger: normalized.slice(0, colonIdx).trim(),
        effect: normalized.slice(colonIdx + 2).trim(),
        raw: block,
      };
    }
  }

  // Spell or static ability
  return {
    abilityType: 'spell',
    trigger: null,
    effect: normalized,
    raw: block,
  };
}

/**
 * Split preprocessed oracle text into ParsedAbility objects.
 * Splits on newlines (canonical) and also on ". When/Whenever/At" patterns
 * that appear in single-line oracle text (fallback for non-newline formats).
 * @param {string} text - reminder-text-stripped oracle text (newlines preserved)
 * @returns {ParsedAbility[]}
 */
function parseAbilities(text) {
  // Convert ". When/Whenever/At " sentence boundaries to newlines so they're
  // treated as separate ability blocks (handles single-line oracle text).
  const normalized = text.replace(/\.\s+(when(?:ever)?\s+|at\s+)/gi, '.\n$1');
  return normalized.split(/\n+/).map(block => parseAbilityBlock(block.trim())).filter(Boolean);
}

// ─── Timing Patterns ──────────────────────────────────────────────────────────
//
// These patterns match the TRIGGER CLAUSE only (the text after "When/Whenever/At",
// before the comma). "When/Whenever/At" prefixes are stripped by parseAbilityBlock.

const TIMING_PATTERNS = [
  // More specific ETB patterns must come before the broad 'etb' catch-all
  { timing: 'land_etb',     re: /\ba land\b[^,]*\benters\b|you play a land\b/i },
  { timing: 'creature_etb', re: /\b(?:a|another)\b[^,]*\bcreature\b[^,]*\benters\b/i },
  { timing: 'etb',          re: /\benters\b/i },
  { timing: 'upkeep',       re: /the beginning of your upkeep/i },
  { timing: 'cast',         re: /you cast\b/i },
  { timing: 'end_step',     re: /the beginning of (?:your|each|the) end step\b/i },
  // "at the beginning of your draw step" fires once per turn — simulatable.
  // "whenever you draw" is a triggered ability firing on each draw — on_draw (track_only).
  { timing: 'draw_step',    re: /the beginning of your draw step\b/i },
  { timing: 'on_draw',      re: /you draw\b/i },
  { timing: 'opponent_cast',re: /(?:an opponent|a player) casts?\b/i },
  { timing: 'opponent_draw',re: /(?:an opponent|a player) draws?\b/i },
  { timing: 'attack',       re: /\battacks\b/i },
  { timing: 'combat_damage',re: /\bdeals? combat damage\b/i },
  { timing: 'sacrifice',    re: /you sacrifice\b/i },
  { timing: 'death',        re: /\bdies\b/i },
];

/**
 * Detect timing from a parsed ability's trigger or cost clause.
 * @param {ParsedAbility} ability
 * @param {boolean} isInstantOrSorcery
 * @returns {string|null}
 */
function detectTimingFromAbility(ability, isInstantOrSorcery) {
  if (ability.abilityType === 'spell') {
    return isInstantOrSorcery ? 'on_resolution' : null;
  }

  if (ability.abilityType === 'activated') {
    const cost = ability.trigger ?? '';
    if (/\{T\}/i.test(cost))         return 'tap';
    if (/\bsacrifice\b/i.test(cost)) return 'sacrifice';
    return null; // pay-life, discard-cost, generic mana: not tracked
  }

  // Triggered: match trigger clause against TIMING_PATTERNS
  const trigger = ability.trigger ?? '';
  for (const { timing, re } of TIMING_PATTERNS) {
    if (re.test(trigger)) return timing;
  }
  return null;
}

/**
 * Split oracle text into sentences for cross-sentence pattern matching
 * within a single effect clause (e.g. "discard a card. If you do, draw a card.").
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return text
    .split(/\.\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ─── Trigger Filter Detection ─────────────────────────────────────────────────

/**
 * Detect spell-type filter keywords from a trigger or context string.
 * @param {string} trigger
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectSpellTypeFilter(trigger) {
  if (/noncreature spell/i.test(trigger))        return { spellTypes: null, excludeTypes: ['Creature'] };
  if (/creature spell/i.test(trigger))           return { spellTypes: ['Creature'] };
  if (/instant or sorcery spell/i.test(trigger)) return { spellTypes: ['Instant', 'Sorcery'] };
  if (/artifact spell/i.test(trigger))           return { spellTypes: ['Artifact'] };
  if (/enchantment spell/i.test(trigger))        return { spellTypes: ['Enchantment'] };
  return null;
}

/**
 * Detect cast trigger filter from the trigger clause.
 * Called only when timing === 'cast'.
 * @param {string} trigger
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectCastFilter(trigger) {
  if (/your commander/i.test(trigger)) return { spellTypes: null, isCommander: true };
  return detectSpellTypeFilter(trigger);
}

/**
 * Detect death trigger subject from the trigger clause.
 * Called when timing === 'death'.
 * @param {string} trigger
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectDeathFilter(trigger) {
  // "this" needs \b to avoid matching "thistle"; "~" is non-word so \b never fires after it
  if (/^this\b/i.test(trigger) || /^~/.test(trigger)) return { deathSubject: 'self' };
  if (/\b(?:a|another) (?:nontoken )?creature\b/i.test(trigger)) return { deathSubject: 'any_creature' };
  return null;
}

/**
 * Extract creature ETB condition filters from the trigger clause.
 * Called when timing === 'creature_etb'.
 * @param {string} trigger
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectCreatureEtbFilter(trigger) {
  const filter = {};
  const cmcMatch = trigger.match(/with (?:mana value|cmc)\s+(\d+)\s+or less/i);
  if (cmcMatch) filter.maxCmc = parseInt(cmcMatch[1], 10);
  const powerMatch = trigger.match(/with power\s+(\d+)\s+or less/i);
  if (powerMatch) filter.maxPower = parseInt(powerMatch[1], 10);
  if (/\bnontoken\b/i.test(trigger)) filter.nontoken = true;
  return Object.keys(filter).length > 0 ? filter : null;
}

/**
 * Detect the trigger filter for a given timing and trigger clause.
 * @param {string} timing
 * @param {string} trigger
 * @returns {import('./types.js').TriggerFilter|null}
 */
function detectTriggerFilter(timing, trigger) {
  if (timing === 'cast')          return detectCastFilter(trigger);
  if (timing === 'opponent_cast') return detectSpellTypeFilter(trigger);
  if (timing === 'death')         return detectDeathFilter(trigger);
  if (timing === 'creature_etb')  return detectCreatureEtbFilter(trigger);
  return null;
}

// ─── Scaling Tap Draw ─────────────────────────────────────────────────────────

/**
 * Effect-clause-only version of the scaling tap draw pattern.
 * Matches "put a COUNTER counter on CARD, then draw a card for each COUNTER counter".
 * Used after the {T} cost has been identified separately by parseAbilityBlock.
 */
const DRAW_SCALING_EFFECT_PATTERN = /put (?:a|an?) (\w+) counter[^.]*draw a card for each \1 counter/i;

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
  // "draw an additional card" — e.g. on_draw triggers; value 1
  { re: /\bdraw an? additional cards?\b/i, getValue: () => 1, conditional: false },
  // "draw two/three/four cards" — word count
  { re: /\bdraw (two|three|four|five|six|seven) cards?\b/i, getValue: m => parseCount(m[1]), conditional: false },
  // "draw N cards" — digit count
  { re: /\bdraw (\d+) cards?\b/i, getValue: m => parseCount(m[1]), conditional: false },
  // "put that card into your hand" — Dark Confidant, Atris, etc.
  { re: /\bput (?:that|it|the(?:m|se)?)?\s*(?:card|cards)? (?:into|in) your hand\b/i, getValue: () => 1, conditional: false },
];

/** Patterns that indicate a conditional draw (requires extra check/cost/trigger). */
const DRAW_CONDITIONAL_PATTERNS = [
  // "you may draw a card" or "you may draw N cards" — always conditional (e.g. Consecrated Sphinx)
  { re: /\byou may draw (two|three|four|five|six|seven|\d+) cards?\b/i, getValue: m => parseCount(m[1]), conditional: true, condition: 'may draw' },
  { re: /\byou may draw a card\b/i, getValue: () => 1, conditional: true, condition: 'may draw' },
  // "draw a card if ..."
  { re: /\bdraw a card if\b/i, getValue: () => 1, conditional: true, condition: 'conditional draw' },
  // "draw a card for each ..."
  { re: /\bdraw a card for each\b/i, getValue: () => null, conditional: true, condition: 'draw per condition' },
  // "draw X cards for each ..."  or "draw cards equal to ..."
  { re: /\bdraw (?:cards?|a card) equal to\b/i, getValue: () => null, conditional: true, condition: 'draw equal to' },
  // "draw X cards" / "draws X cards" — variable amount like Blue Sun's Zenith, Stroke of Genius
  { re: /\bdraws? X cards?\b/i, getValue: () => null, conditional: true, condition: 'draw X' },
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

/**
 * Parse total mana value from a mana cost string (e.g. "{2}{G}" → 3, "{G}{G}" → 2).
 * Generic mana digits count at face value; colored/colorless pips count as 1 each.
 * @param {string} manaStr
 * @returns {number}
 */
function parseManaValue(manaStr) {
  let total = 0;
  for (const token of (manaStr.match(/\{([^}]+)\}/g) || [])) {
    const inner = token.slice(1, -1);
    const n = parseInt(inner, 10);
    total += isNaN(n) ? 1 : n;
  }
  return Math.max(1, total);
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
  if (timing === 'creature_etb' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'upkeep'       && value !== null && value >= 1) return 'simulatable';
  if (timing === 'draw_step'    && value !== null && value >= 1) return 'simulatable';
  if (timing === 'end_step'     && value !== null && value >= 1) return 'simulatable';
  if (timing === 'on_resolution' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'tap'           && value !== null && value >= 1) return 'simulatable';
  if (timing === 'cast'          && value !== null && value >= 1) return 'simulatable';
  if (timing === 'opponent_draw' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'opponent_cast' && value !== null && value >= 1) return 'simulatable';
  if (timing === 'death') return 'track_only';
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
 * Uses ability-clause separation (Proposal F):
 *   1. Oracle text split into ParsedAbility objects (triggered/activated/spell)
 *   2. Timing detected from trigger/cost clause only
 *   3. Draw patterns matched against effect clause only
 *
 * Effect patterns checked in priority order within each ability's effect clause:
 *   1. Loot (draw + discard) — checked first to prevent double-tagging
 *   2. Conditional draws — checked before unconditional to prevent false positives
 *   3. Unconditional draws
 *
 * @param {string|null} oracleText
 * @param {string[]}    [keywords=[]]
 * @param {string[]}    [cardTypes=[]]  - Card types array (e.g. ['Instant'] or ['Creature', 'Artifact'])
 * @returns {import('./types.js').EffectTag[]}
 */
export function detectEffectTags(oracleText, keywords = [], cardTypes = []) {
  const tags = [];
  if (!oracleText) return tags;

  const isInstantOrSorcery = cardTypes.includes('Instant') || cardTypes.includes('Sorcery');

  // Strip reminder text (parenthetical notes) before matching to avoid false positives.
  // Preserve newlines — each line is a separate ability paragraph.
  const cleanText = oracleText
    .replace(/\([^)]*\)/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  for (const ability of parseAbilities(cleanText)) {
    // ── Mana rock: activated {T}: Add {mana} ────────────────────────────────
    // Must run before draw detection so "{T}: Add {G}" doesn't fall through.
    if (ability.abilityType === 'activated' && /\{T\}/i.test(ability.trigger ?? '')) {
      const addMatch = ability.effect.match(/^Add\s+((?:\{[^}]+\})+)/i);
      if (addMatch) {
        tags.push({
          category: 'ramp',
          subtype: 'mana_rock',
          timing: 'tap',
          value: parseManaValue(addMatch[1]),
          isConditional: false,
          condition: null,
          triggerFilter: null,
          tier: 'simulatable',
          source: 'auto',
        });
        continue;
      }
      if (/^Add\s+(?:one mana of any|mana of any color)/i.test(ability.effect)) {
        tags.push({
          category: 'ramp',
          subtype: 'mana_rock',
          timing: 'tap',
          value: 1,
          isConditional: false,
          condition: null,
          triggerFilter: null,
          tier: 'simulatable',
          source: 'auto',
        });
        continue;
      }
    }

    const timing = detectTimingFromAbility(ability, isInstantOrSorcery);
    const triggerFilter = timing ? detectTriggerFilter(timing, ability.trigger ?? '') : null;

    // Split the effect clause into sentences for cross-sentence pattern matching
    // (e.g. "discard a card. If you do, draw a card." spans two sentences).
    const effectSentences = splitSentences(ability.effect);

    for (let i = 0; i < effectSentences.length; i++) {
      const sentence = effectSentences[i];

      // ── 0. Scaling tap draw (e.g. The One Ring burden counters) ──────────
      // Checked before generic draws since "draw a card for each counter" is
      // otherwise flagged as a conditional draw-per-condition.
      if (timing === 'tap') {
        const scalingMatch = sentence.match(DRAW_SCALING_EFFECT_PATTERN);
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
      }

      // ── 1a. Additional cost discard (cross-sentence) ──────────────────────
      // "As an additional cost to cast this spell, discard N cards. Draw M cards."
      // Current sentence has the discard cost; next sentence has the draw.
      if (ADDITIONAL_COST_DISCARD_PATTERN.test(sentence)) {
        if (timing === null) continue;
        const discardCount = parseDiscardCount(sentence);
        let drawCount = 1;
        if (i + 1 < effectSentences.length) {
          drawCount = parseDrawCount(effectSentences[i + 1]);
          i++; // consume the draw sentence
        }
        tags.push(makeLootTag(timing, drawCount, discardCount, true, triggerFilter));
        continue;
      }

      // ── 1b. If-you-do draw (cross-sentence rummage) ───────────────────────
      // "...you may discard a card. If you do, draw a card."
      if (IF_YOU_DO_DRAW_PATTERN.test(sentence)) {
        const prevSentence = i > 0 ? effectSentences[i - 1] : '';
        if (/\bdiscard\b/i.test(prevSentence) && timing !== null) {
          const discardCount = parseDiscardCount(prevSentence);
          const drawCount = parseDrawCount(sentence);
          tags.push(makeLootTag(timing, drawCount, discardCount, false, triggerFilter));
          continue;
        }
        // If prev sentence doesn't mention discard, fall through to draw patterns
      }

      // ── 1c. Rummage: "discard N, then draw M" (same sentence) ────────────
      if (RUMMAGE_SINGLE_PATTERN.test(sentence)) {
        if (timing === null) continue;
        tags.push(makeLootTag(timing, parseDrawCount(sentence), parseDiscardCount(sentence), false, triggerFilter));
        continue;
      }

      // ── 1d. Standard loot: "draw N, then discard M" (same sentence) ──────
      if (LOOT_PATTERN.test(sentence)) {
        if (timing === null) continue;
        tags.push(makeLootTag(timing, parseDrawCount(sentence), parseDiscardCount(sentence), false, triggerFilter));
        continue;
      }

      // ── 2. Conditional draws ──────────────────────────────────────────────
      // Must run before unconditional: "You may draw a card." contains "draw a card"
      // and would otherwise be mis-tagged as unconditional.
      let foundConditional = false;
      for (const { re, getValue, conditional, condition } of DRAW_CONDITIONAL_PATTERNS) {
        const m = sentence.match(re);
        if (m) {
          if (timing === null) { foundConditional = true; break; }
          const value = getValue(m);
          tags.push(makeDrawTag('draw_n', timing, value, conditional, condition, triggerFilter));
          foundConditional = true;
          break;
        }
      }
      if (foundConditional) continue;

      // ── 3. Unconditional draws ────────────────────────────────────────────
      for (const { re, getValue, conditional } of DRAW_UNCONDITIONAL_PATTERNS) {
        const m = sentence.match(re);
        if (m) {
          if (timing === null) break;
          const value = getValue(m);
          tags.push(makeDrawTag('draw_n', timing, value, conditional, null, triggerFilter));
          break; // Only one unconditional draw tag per sentence
        }
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
 * Also accepts legacy `simulatable_soon` from old saves (treated as track_only).
 * @param {import('./types.js').EffectTag[]} tags
 * @returns {import('./types.js').EffectTag[]}
 */
export function getTrackOnlyTags(tags) {
  return tags.filter(t => t.tier === 'track_only' || t.tier === 'simulatable_soon');
}

/**
 * Check if a card has any draw effect (for stats labeling).
 * @param {import('./types.js').EffectTag[]} tags
 * @returns {boolean}
 */
export function hasDrawEffect(tags) {
  return tags.some(t => t.category === 'draw');
}
