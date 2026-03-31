/**
 * mullstat - Effect Tag Detection
 *
 * Detects three categories of effects from Scryfall oracle text:
 *   ramp:  mana rocks ({T}: Add {mana})
 *   draw:  card draw (draw N cards)
 *   tutor: library search (search your library for...)
 *
 * No timing detection — mulligan analysis cares what a card does, not when.
 * Category derivation (Ramp, Card Draw, Tutor, ...) happens in enrichment.js
 * via a simple effectTag.category → canonical category lookup.
 *
 * Exported: detectEffectTags(oracleText, opts), detectEtbTapped(oracleText)
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse total mana value from a mana cost string (e.g. "{2}{G}" → 3).
 * Generic mana digits count at face value; colored/colorless pips count as 1.
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

const WORD_TO_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

function parseDrawCount(str) {
  if (!str) return 1;
  const lower = str.trim().toLowerCase();
  if (WORD_TO_NUM[lower] !== undefined) return WORD_TO_NUM[lower];
  const n = parseInt(lower, 10);
  return isNaN(n) ? 1 : n;
}

// ─── Tutor Helpers ────────────────────────────────────────────────────────────

const BASIC_LAND_SUBTYPES = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp'];

/**
 * Parse a FetchConstraint from the tutor capture group text.
 * e.g. "a basic land"   → { supertype:'Basic', type:'Land' }
 *      "any"            → { any:true }
 *      "a creature"     → { type:'Creature' }
 */
function parseFetchConstraint(captureText) {
  const t = captureText
    .replace(/\bup to \w+\b/gi, '')
    .replace(/\bany number of\b/gi, '')
    .replace(/\btarget\b/gi, '')
    .replace(/\bnontoken\b/gi, '')
    .trim();

  if (/\bany\b/i.test(t) || /^(?:a|an)?\s*cards?$/.test(t.trim())) {
    return { any: true, nonland: false, supertype: null, type: null, subtypes: null };
  }

  const nonland   = /\bnonland\b/i.test(t);
  const supertype = /\bbasic\b/i.test(t)    ? 'Basic'
    : /\blegendary\b/i.test(t) ? 'Legendary'
    : /\bsnow\b/i.test(t)      ? 'Snow'
    : null;

  const foundSubtypes = BASIC_LAND_SUBTYPES.filter(s => new RegExp(`\\b${s}\\b`, 'i').test(t));
  const subtypes = foundSubtypes.length > 0 ? foundSubtypes : null;

  let type = null;
  if      (subtypes)                                type = 'Land';
  else if (/\bland\b/i.test(t))                    type = 'Land';
  else if (/\bcreature\b/i.test(t))                type = 'Creature';
  else if (/\bartifact or enchantment\b/i.test(t)) type = 'ArtifactOrEnchantment';
  else if (/\bartifact\b/i.test(t))                type = 'Artifact';
  else if (/\benchantment\b/i.test(t))             type = 'Enchantment';
  else if (/\bplaneswalker\b/i.test(t))            type = 'Planeswalker';
  else if (/\binstant or sorcery\b/i.test(t))      type = 'InstantOrSorcery';
  else if (/\binstant\b/i.test(t))                 type = 'Instant';
  else if (/\bsorcery\b/i.test(t))                 type = 'Sorcery';
  else if (/\bpermanent\b/i.test(t))               type = 'Permanent';

  if (!nonland && !supertype && !type && !subtypes) {
    return { any: true, nonland: false, supertype: null, type: null, subtypes: null };
  }

  return { any: false, nonland, supertype, type, subtypes };
}

// ─── Main Detection ───────────────────────────────────────────────────────────

/**
 * Detect effect tags from a card's oracle text.
 * Returns at most one tag per subtype (mana_rock, draw_n, tutor).
 *
 * @param {string|null}   oracleText
 * @param {Object}        [opts]
 * @param {string[]}      [opts.keywords=[]]   - Scryfall keyword array (e.g. ['Flying','Ravenous'])
 * @param {string[]}      [opts.cardTypes=[]]  - Card type array (e.g. ['Land','Creature'])
 * @returns {import('./types.js').EffectTag[]}
 */
export function detectEffectTags(oracleText, { keywords = [], cardTypes = [] } = {}) {
  if (!oracleText) return [];
  const tags = [];
  const isLand = cardTypes.includes('Land');
  const isRavenous = keywords.some(k => k.toLowerCase() === 'ravenous');

  // Strip reminder text; collapse whitespace
  const clean = oracleText.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Mana rock: {T}: Add {mana} ───────────────────────────────────────────
  // Skip for Land types — their mana abilities are the land itself, not ramp
  if (!isLand) {
    const manaRockRe = /\{T\}[^:]*:\s*Add\s+((?:\{[^}]+\})+)/gi;
    let m;
    while ((m = manaRockRe.exec(clean)) !== null) {
      tags.push({ category: 'ramp', subtype: 'mana_rock', value: parseManaValue(m[1]), source: 'auto' });
    }
    if (!tags.some(t => t.subtype === 'mana_rock') &&
        /\{T\}[^:]*:\s*Add\s+(?:one mana of any|mana of any color)/i.test(clean)) {
      tags.push({ category: 'ramp', subtype: 'mana_rock', value: 1, source: 'auto' });
    }
  }

  // ── Tutor: search your library ────────────────────────────────────────────
  // Skip for Land types — fetch lands search for lands as part of their land ability
  if (!isLand) {
    const tutorMatch = clean.match(/search your library for (.+?) cards?\b/i);
    if (tutorMatch) {
      const fetchType = parseFetchConstraint(tutorMatch[1]);
      let putWhere = 'hand';
      if (/put it onto the battlefield\b/i.test(clean))  putWhere = 'battlefield';
      else if (/on top of your library\b/i.test(clean))  putWhere = 'top_of_library';
      tags.push({ category: 'tutor', subtype: 'tutor', value: null, fetchType, putWhere, source: 'auto' });
    }
  }

  // ── Draw N cards ──────────────────────────────────────────────────────────
  // Skip for Ravenous keyword — draw is conditional on kicker, not a reliable effect
  if (!isRavenous) {
    let maxDraw = 0;
    const drawRe = /\bdraw (a|an|one|two|three|four|five|six|seven|\d+) cards?\b/gi;
    let m;
    while ((m = drawRe.exec(clean)) !== null) {
      maxDraw = Math.max(maxDraw, parseDrawCount(m[1]));
    }
    if (maxDraw > 0) {
      tags.push({ category: 'draw', subtype: 'draw_n', value: maxDraw, source: 'auto' });
    }
  }

  return tags;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * True if the oracle text indicates the land enters tapped.
 * Used by enrichment.js for display/heuristic purposes.
 */
export function detectEtbTapped(oracleText) {
  if (!oracleText) return false;
  // Shock lands: "If you don't, [CardName] enters the battlefield tapped" — goldfish always pays
  if (/if you don't,.+enters the battlefield tapped/i.test(oracleText)) return false;
  // "unless you control two or more opponents" — always true in multiplayer Commander
  if (/enters the battlefield tapped unless you control two or more opponents/i.test(oracleText)) return false;
  return /enters(?: the battlefield)? tapped\b/i.test(oracleText);
}
