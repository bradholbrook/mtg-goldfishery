/**
 * mullstat — Calculate Tab
 *
 * Pure hypergeometric probability analysis. No simulation required.
 * Results update instantly from deck data.
 */

import { logBinom, hypgeomAtLeast, expectedValue } from '../hypergeometric.js';
import { CARD_TYPES, CANONICAL_CATEGORIES } from '../types.js';
import { escapeHtml, TYPE_COLORS, tagColor } from './shared.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';

// ─── Module-level Lab State ───────────────────────────────────────────────────

let _labN      = 3;
let _labTarget = 'Land';

export function setLabN(n)      { _labN = n; }
export function setLabTarget(t) { _labTarget = t; }

// Selected turn for color-by-turn analysis (null = use commander CMC)
let _colorTurn = null;
export function setColorTurn(t) { _colorTurn = t; }

// Per-deck "effective commander cost" overrides for the castability chart.
// Each entry: { cmcDelta: number, colors: string[] | null }
// `colors` null = use commander's own colors; array = user-chosen set.
const _costOverrides = new Map();

export function getCostOverride(deckId) {
  return _costOverrides.get(deckId) ?? { cmcDelta: 0, colors: null };
}
export function setCostCmcDelta(deckId, delta) {
  const cur = _costOverrides.get(deckId) ?? { cmcDelta: 0, colors: null };
  _costOverrides.set(deckId, { ...cur, cmcDelta: delta });
}
export function toggleCostColor(deckId, color, defaultColors) {
  const cur = _costOverrides.get(deckId) ?? { cmcDelta: 0, colors: null };
  const base = cur.colors ?? [...defaultColors];
  const next = base.includes(color) ? base.filter(c => c !== color) : [...base, color];
  _costOverrides.set(deckId, { ...cur, colors: next });
}
export function resetCostOverride(deckId) {
  _costOverrides.delete(deckId);
}
export function isCostOverrideActive(override, commanderColors) {
  if (override.cmcDelta !== 0) return true;
  if (!override.colors) return false;
  if (override.colors.length !== commanderColors.length) return true;
  const set = new Set(override.colors);
  return !commanderColors.every(c => set.has(c));
}


// Last castability info text — set during render, read by window.__cast.showInfo()
let _castInfoText = '';
export function getCastInfoText() { return _castInfoText; }

// ─── Effect Lab State ─────────────────────────────────────────────────────────

let _activeSubTab = 'top_n';
const _openEffectIds = new Set(); // IDs of <details> currently open

export function setActiveSubTab(tab) { _activeSubTab = tab; }
export function setEffectOpen(id, open) {
  if (open) _openEffectIds.add(id); else _openEffectIds.delete(id);
}

// ─── Cascade/Discover State ──────────────────────────────────────────────────

let _cascadeMV = 5;
let _cascadeMode = 'cascade'; // 'cascade' | 'discover'
let _cascadeSort = 'value'; // 'value' | 'alpha'
let _cascadeFilter = null; // null = all types

export function setCascadeMV(n) { _cascadeMV = n; }
export function setCascadeMode(m) { _cascadeMode = m; }
export function setCascadeSort(s) { _cascadeSort = s; }
export function setCascadeFilter(f) { _cascadeFilter = f; }

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function buildCalculateTab(deck) {
  return `
    <div style="padding:0 2px">
      ${buildSubTabBar()}
      ${_activeSubTab === 'top_n' ? buildTopNTab(deck) : buildCascadeTab(deck)}
    </div>`;
}

// ─── Oracle Text Mana Helpers ─────────────────────────────────────────────────

function countManaSymbols(str) {
  return (str.match(/\{[^}]+\}/g) ?? []).length;
}

/**
 * Parse how much mana a ramp card produces per activation from its oracle text.
 * Covers tap abilities, rituals, variable-output dorks, and "add one mana" phrasing.
 *
 * @param {import('../types.js').Card} card
 * @param {{ commanderColorCount?: number }} [opts]
 */
function getManaValue(card, { commanderColorCount = 0 } = {}) {
  const oracle = card.oracleText ?? '';
  // Strip reminder text for cleaner matching
  const clean = oracle.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // Tap ability with concrete symbols: {T}: Add {C}{C}
  const tapMatch = clean.match(/\{T\}[^.]*?:\s*Add\s*((?:\{[^}]+\}\s*)+)/i);
  if (tapMatch) return countManaSymbols(tapMatch[1]);

  // ── Variable mana producers (must come before "add one mana" fallback) ────

  // "for each color among permanents you control, add one mana of that color"
  // e.g. Bloom Tender, Faeburrow Elder
  // Estimate: by the turn you'd tap this for your commander, ~60% of identity colors in play
  if (/for each color among permanents you control/i.test(clean)) {
    return Math.max(1, Math.min(3, commanderColorCount));
  }

  // "{T}: Add X mana of any one color, where X is the number of [type]"
  // e.g. Sanctum Weaver, Serra's Sanctum (lands excluded by caller)
  if (/add (?:\w+ )?mana.*(?:where X is|equal to) the number of/i.test(clean)) {
    return 3; // conservative board-state estimate
  }

  // "Add {C} for each [type] you control" / "{T}: Add {G} for each creature"
  // e.g. Gaea's Cradle (land, excluded), Priest of Titania, Circle of Dreams Druid
  if (/\badd\b[^.]*\{[^}]+\}[^.]*\bfor each\b/i.test(clean)) {
    return 3; // conservative board-state estimate
  }

  // "add an amount of mana of that color equal to your devotion"
  // e.g. Nykthos (land, excluded by caller); creature variants possible
  if (/\badd an amount of mana\b/i.test(clean)) {
    return 3;
  }

  // ── Concrete non-tap patterns ─────────────────────────────────────────────

  // Ritual / burst: "Add {B}{B}{B}." — no tap cost
  const addMatch = clean.match(/\bAdd\s+((?:\{[^}]+\}\s*)+)/i);
  if (addMatch) return countManaSymbols(addMatch[1]);

  // "Add one mana of any color"
  if (/\badd one mana\b/i.test(clean)) return 1;

  // "Add mana equal to…" — approximate (catch-all for remaining "equal to" patterns)
  if (/\badd.*mana equal to\b/i.test(clean)) return 2;

  return 1; // fallback
}

// ─── Ramp Classification & Bucketing ─────────────────────────────────────────

function isRitual(card) {
  const types = card.types ?? [];
  if (!types.includes('Instant') && !types.includes('Sorcery')) return false;
  return /\bAdd\s*\{/i.test(card.oracleText ?? '');
}

function isRamp(card) {
  return card.categories?.some(c => ['Ramp', 'Mana Rock', 'Mana Dork'].includes(c)) || isRitual(card);
}

function isDork(card) {
  return card.categories?.includes('Mana Dork') ?? false;
}

/**
 * P(can cast a ramp card by its own CMC turn) based on colored pip availability
 * AND total mana availability for expensive ramp (CMC ≥ 3).
 *
 * Colorless cards with CMC ≤ 2 return 1.0 (nearly always castable on curve).
 * For CMC ≥ 3, multiplies by P(≥cmc mana sources by turn cmc) to capture
 * the chance you simply don't have enough mana to deploy expensive ramp.
 */
function cardCastability(card, N, colorSources, landCount) {
  const cmc = card.cmc ?? 0;
  const n = 7 + cmc; // cards in hand on the turn you'd cast it

  // Color castability
  const pipColors = parsePipColors(card.manaCost);
  let pColor = pipColors.reduce((p, color) => {
    const sources = colorSources[color] ?? 0;
    return p * hypgeomAtLeast(1, N, sources, n);
  }, 1.0);

  // Mana-availability castability for expensive ramp (CMC ≥ 3)
  // For cheap ramp (CMC 0–2), P(enough lands) is ~95%+ and not worth penalizing
  if (cmc >= 3 && landCount > 0) {
    const pMana = hypgeomAtLeast(cmc, N, landCount, n);
    pColor *= pMana;
  }

  return pColor;
}

/**
 * Group ramp cards into CMC×type buckets.
 * Tracks weighted-average mana value AND castability (color + mana availability) per bucket.
 *
 * @param {import('../types.js').Card[]} rampCards
 * @param {number} N
 * @param {Object} colorSources
 * @param {number} landCount
 * @param {number} commanderColorCount - number of colors in commander's cost
 */
function buildRampBuckets(rampCards, N, colorSources, landCount, commanderColorCount) {
  const map = new Map(); // `${cmc}_d|r` → { cmc, count, totalValue, totalCastability, isDork }
  for (const card of rampCards) {
    const cmc   = card.cmc ?? 0;
    const dork  = isDork(card);
    const key   = `${cmc}_${dork ? 'd' : 'r'}`;
    const val   = getManaValue(card, { commanderColorCount });
    const cast  = cardCastability(card, N, colorSources, landCount);
    if (map.has(key)) {
      const b = map.get(key);
      b.totalValue       += val  * card.quantity;
      b.totalCastability += cast * card.quantity;
      b.count            += card.quantity;
    } else {
      map.set(key, {
        cmc, isDork: dork, count: card.quantity,
        totalValue: val * card.quantity,
        totalCastability: cast * card.quantity,
      });
    }
  }
  return [...map.values()].map(b => ({
    cmc: b.cmc,
    count: b.count,
    value: b.totalValue / b.count,
    castability: b.totalCastability / b.count,
    isDork: b.isDork,
  }));
}

/**
 * Expected mana contribution of one ramp piece from this bucket on turn T,
 * weighted by the probability you can actually cast it (color availability).
 *
 * T < cmc  → 0 (can't cast yet)
 * T = cmc  → max(0, value − cmc) for rocks (cast+tap same turn); 0 for dorks (summoning sickness)
 * T > cmc  → value (freely taps; dorks untap the turn after they were cast)
 * All cases multiplied by castability (P(right colors available by turn cmc)).
 */
function effectiveValue(bucket, T) {
  const { cmc, value, isDork, castability = 1 } = bucket;
  let rawEv;
  if (T < cmc) return 0;
  if (T === cmc) {
    if (isDork) rawEv = 0;
    else rawEv = Math.max(0, value - cmc);
  } else {
    rawEv = value;
  }
  return rawEv * castability;
}

// ─── Deck Profile Extraction ──────────────────────────────────────────────────

export function extractDeckProfile(deck) {
  const allCards  = deck.cards;
  const commander = allCards.find(c => c.isCommander) ?? null;
  const nonCmdr   = allCards.filter(c => !c.isCommander);
  const N         = nonCmdr.reduce((s, c) => s + c.quantity, 0);

  const lands           = nonCmdr.filter(c => c.types?.includes('Land'));
  const landCount       = lands.reduce((s, c) => s + c.quantity, 0);
  const tappedLandCount = lands.filter(c => c.etbTapped).reduce((s, c) => s + c.quantity, 0);
  const untappedLandCount = landCount - tappedLandCount;

  // Color sources must be computed before ramp buckets (castability depends on them)
  const colorSources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  // Land-only color sources for the "colors by turn" chart (no ramp — rocks/dorks
  // need to be cast first, so simple hypergeometric draw doesn't apply to them)
  const landColorSources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of nonCmdr) {
    const produced = getProducedColors(card);
    const isLand = card.types?.includes('Land');
    for (const c of produced) {
      if (c in colorSources) {
        colorSources[c] += card.quantity;
        if (isLand) landColorSources[c] += card.quantity;
      }
    }
  }

  const commanderCmc    = commander?.cmc ?? 0;
  const commanderColors = parsePipColors(commander?.manaCost);
  // Color identity may include colors not in mana cost (e.g. ability pips, partner commanders)
  const commanderColorIdentity = [...new Set(
    (commander?.colorIdentity?.length ? commander.colorIdentity : commanderColors)
      .filter(c => 'WUBRG'.includes(c))
  )];

  const rampCards   = nonCmdr.filter(c => !c.types?.includes('Land') && isRamp(c));
  const rampBuckets = buildRampBuckets(rampCards, N, colorSources, landCount, commanderColors.length);
  const rampCount   = rampCards.reduce((s, c) => s + c.quantity, 0);

  return {
    deckId: deck.id,
    N, commander, commanderCmc, commanderColors, commanderColorIdentity,
    landCount, untappedLandCount, tappedLandCount,
    rampCount, rampBuckets, colorSources, landColorSources,
    nonCmdrCards: nonCmdr,  // needed for inclusion-exclusion color calc
    tagsStatus: deck.tagsStatus ?? 'ready',
  };
}

/**
 * P(castable on curve) for a single non-commander card, given the deck's mana profile.
 * Uses the same model as commander castability: lands + ramp on turn = card.cmc.
 * Returns null for colorless spells, lands, or cards with no CMC.
 */
export function computeCardCastability(card, profile) {
  if (!card.cmc || card.cmc <= 0) return null;
  if (card.types?.includes('Land')) return null;
  const cardColors = parsePipColors(card.manaCost);
  const cardProfile = { ...profile, commanderCmc: card.cmc, commanderColors: cardColors };
  return pCastOnTurn(card.cmc, cardProfile);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract WUBRG colors a card can produce. */
function getProducedColors(card) {
  if (card.producedMana?.length > 0) {
    return card.producedMana.filter(c => 'WUBRG'.includes(c));
  }
  if (card.types?.includes('Land') && card.supertypes?.includes('Basic')) {
    const map = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    for (const sub of (card.subtypes ?? [])) {
      if (map[sub]) return [map[sub]];
    }
  }
  return [];
}

/** Parse unique colored pips from a mana cost string like "{2}{G}{G}" → ['G'] */
function parsePipColors(manaCost) {
  if (!manaCost) return [];
  const seen = new Set();
  for (const m of manaCost.matchAll(/\{([WUBRG])\}/g)) seen.add(m[1]);
  return [...seen];
}

// ─── Tapped Land Mana Helper ─────────────────────────────────────────────────

/**
 * Effective mana from lands on turn T, given u untapped and t tapped lands drawn.
 *
 * Optimal play: play tapped lands on early turns (T1, T2, …) so they untap,
 * save untapped lands for the curve turn (turn T) where you need mana immediately.
 *
 * - If played < T: all lands were played on earlier turns → all produce mana on T.
 * - If played === T: one land per turn. If we have an untapped land left for turn T,
 *   all T lands produce mana. If forced to play tapped on T, mana = T − 1.
 */
function effectiveLandMana(u, t, T) {
  const played = Math.min(u + t, T);
  if (played < T) return played; // all played before T, all untapped by now
  // played === T: check if we can play an untapped land on turn T
  const tappedEarly = Math.min(t, T - 1); // tapped lands used on turns 1..T-1
  const untappedEarly = Math.max(0, (T - 1) - tappedEarly); // untapped filling remaining early slots
  const untappedLeft = u - untappedEarly; // untapped available for turn T
  return untappedLeft > 0 ? T : T - 1;
}

// ─── Inclusion-Exclusion Color Probability ──────────────────────────────────

/**
 * P(at least 1 source of every required commander color in n draws).
 *
 * Uses exact inclusion-exclusion instead of independence approximation.
 * This correctly handles the positive correlation from dual/tri/5-color lands:
 * drawing one Command Tower satisfies multiple color requirements simultaneously.
 *
 * Formula: P(all colors) = 1 − P(miss ≥ 1 color)
 * where P(miss ≥ 1) = Σ|S|=1 P(miss S) − Σ|S|=2 P(miss S) + Σ|S|=3 P(miss S) − …
 * and P(miss S) = C(cards producing none of S, n) / C(N, n)
 *
 * @param {string[]} commanderColors - required pip colors (e.g. ['W','U','B','R','G'])
 * @param {import('../types.js').Card[]} nonCmdrCards - all non-commander cards
 * @param {number} N - library size
 * @param {number} n - cards drawn
 */
function pAllColors(commanderColors, nonCmdrCards, N, n) {
  if (commanderColors.length === 0) return 1;

  // Precompute: for each card, which of the required colors does it produce?
  const cardColorSets = nonCmdrCards.map(card => {
    const produced = new Set(getProducedColors(card));
    return { colors: commanderColors.filter(c => produced.has(c)), qty: card.quantity };
  });

  const numColors = commanderColors.length;
  const logDenom = logBinom(N, n);
  let pMissAny = 0;

  // Iterate all non-empty subsets of commanderColors (2^numColors − 1 terms, max 31 for 5c)
  for (let mask = 1; mask < (1 << numColors); mask++) {
    // Build the subset of colors for this term
    const subset = [];
    for (let i = 0; i < numColors; i++) {
      if (mask & (1 << i)) subset.push(commanderColors[i]);
    }

    // Count cards that produce NONE of the colors in this subset
    let nonProducerCount = 0;
    for (const { colors, qty } of cardColorSets) {
      if (!colors.some(c => subset.includes(c))) {
        nonProducerCount += qty;
      }
    }

    // Inclusion-exclusion sign: odd |S| → +, even |S| → −
    const sign = (subset.length % 2 === 1) ? 1 : -1;
    const pMissSubset = Math.exp(logBinom(nonProducerCount, n) - logDenom);
    pMissAny += sign * pMissSubset;
  }

  return Math.max(0, Math.min(1, 1 - pMissAny));
}

// ─── Multivariate Hypergeometric Castability ──────────────────────────────────

/**
 * P(can cast commander by turn T).
 *
 * Enumerates all hand compositions (untapped lands, tapped lands, ramp buckets, filler)
 * using the multivariate hypergeometric formula, then multiplies by exact color probability.
 *
 * Land model: untapped/tapped split with optimal sequencing — play tapped lands early,
 * save untapped for curve turn. A tapped land on the curve turn costs 1 effective mana.
 *
 * Color model: inclusion-exclusion over all required colors, properly accounting for
 * dual/tri/5-color lands that satisfy multiple requirements simultaneously.
 *
 * Winning condition: effectiveLandMana(u, t, T) + Σ(rᵢ × effectiveValue(bucketᵢ, T)) ≥ commanderCmc
 */
function pCastOnTurn(T, profile) {
  const { N, commanderCmc, untappedLandCount, tappedLandCount, landCount,
          rampBuckets, commanderColors, nonCmdrCards } = profile;
  if (!commanderCmc || commanderCmc <= 0 || N < 7) return 0;

  const n = 7 + T; // opening hand + draw on each of T turns (draw on T1 in Commander)

  // Pre-compute effective values; skip buckets that can't be cast by turn T
  const buckets = rampBuckets
    .map(b => ({ ...b, ev: effectiveValue(b, T) }))
    .filter(b => b.cmc <= T);

  const totalRampInBuckets = buckets.reduce((s, b) => s + b.count, 0);
  const fillerCount = Math.max(0, N - landCount - totalRampInBuckets);
  const logDenom = logBinom(N, n);

  let totalP = 0;

  // Outer loops: untapped lands (u) and tapped lands (t)
  for (let u = 0; u <= Math.min(untappedLandCount, n); u++) {
    const logU = logBinom(untappedLandCount, u);
    const nAfterU = n - u;

    for (let t = 0; t <= Math.min(tappedLandCount, nAfterU); t++) {
      const landMana = effectiveLandMana(u, t, T);
      const remaining = nAfterU - t;
      const logLandProb = logU + logBinom(tappedLandCount, t);

      // Inner recursion: enumerate ramp bucket draws
      function enumerate(bucketIdx, rem, manaAccum, logProb) {
        if (bucketIdx === buckets.length) {
          if (rem < 0 || rem > fillerCount) return;
          if (landMana + manaAccum < commanderCmc) return;
          const logP = logProb + logBinom(fillerCount, rem) - logDenom;
          totalP += Math.exp(logP);
          return;
        }

        const bucket = buckets[bucketIdx];
        const rMax = Math.min(bucket.count, rem);
        for (let r = 0; r <= rMax; r++) {
          enumerate(
            bucketIdx + 1,
            rem - r,
            manaAccum + r * bucket.ev,
            logProb + logBinom(bucket.count, r),
          );
        }
      }

      enumerate(0, remaining, 0, logLandProb);
    }
  }

  // Color requirement — exact inclusion-exclusion
  const pColors = pAllColors(commanderColors, nonCmdrCards, N, n);

  return Math.min(1, totalP * pColors);
}

/**
 * Count cards in deck (non-commander) matching a target label.
 * Target is either a card type (Land, Creature…) or a category (Ramp, Card Draw…).
 */
function countTarget(deck, target) {
  const nonCmdr = deck.cards.filter(c => !c.isCommander);
  const isType = CARD_TYPES.includes(target);
  return nonCmdr.reduce((s, c) => {
    const match = isType
      ? c.types?.includes(target)
      : c.categories?.includes(target);
    return match ? s + c.quantity : s;
  }, 0);
}

// ─── Section 1: Commander Castability ────────────────────────────────────────

export function buildCastabilitySection(profile) {
  const { commander, commanderCmc: baseCmc, commanderColors: baseColors, colorSources,
          N, landCount, rampCount, rampBuckets, tappedLandCount, tagsStatus, deckId } = profile;

  if (!commander) {
    return `
      <div class="section-label" style="display:flex;align-items:center;gap:8px">
        Commander Castability
      </div>
      <p class="muted" style="font-size:12px">No commander found in deck.</p>`;
  }

  if (!commander.enriched) {
    return `
      <div class="section-label" style="display:flex;align-items:center;gap:8px">
        Commander Castability
      </div>
      <p class="muted" style="font-size:12px">
        Import deck to fetch Scryfall data and see castability analysis.
      </p>`;
  }

  if (tagsStatus === 'pending') {
    return `
      <div class="section-label" style="display:flex;align-items:center;gap:8px">
        Commander Castability
      </div>
      <div class="tags-loading-state">
        <span class="tags-loading-spinner"></span>
        <span class="muted" style="font-size:12px">Fetching oracle tags…</span>
      </div>`;
  }

  if (tagsStatus === 'failed') {
    return `
      <div class="section-label" style="display:flex;align-items:center;gap:8px">
        Commander Castability
      </div>
      <p class="muted" style="font-size:12px">
        Oracle tag fetch timed out or failed — castability requires ramp data from Scryfall Tagger.
        Try re-importing the deck.
      </p>`;
  }

  // Apply user's effective-cost override (cmc delta + color set)
  const override = getCostOverride(deckId);
  const baseGeneric = parseGenericCost(commander.manaCost);
  const effectiveGeneric = Math.max(0, baseGeneric + override.cmcDelta);
  const commanderColors = override.colors ?? baseColors;
  // Treat each unique color as 1 pip (limitation: multi-pip like {G}{G}{G} collapses to 1).
  // Fall back to baseCmc when override is inactive so we don't alter un-touched decks.
  const overrideActive = isCostOverrideActive(override, baseColors);
  const commanderCmc = overrideActive
    ? Math.max(1, Math.min(20, effectiveGeneric + commanderColors.length))
    : baseCmc;
  const effectiveProfile = { ...profile, commanderCmc, commanderColors };

  // Compute badge
  const _turns = [1, 2, 3, 4, 5, 6, 7, 8];
  const _probs = _turns.map(T => pCastOnTurn(T, effectiveProfile));
  const _thresh80 = _turns.find(T => Math.round(_probs[T - 1] * 100) >= 80) ?? null;
  const _badgeDelta = _thresh80 === null ? Infinity : _thresh80 - commanderCmc;
  const _badgeClass = _badgeDelta <= 0 ? 'good' : _badgeDelta === 1 ? 'warn' : 'bad';
  const _badgeText  = _thresh80 ? `Turn ${_thresh80}` : 'Turn 9+';

  const { untappedLandCount, rampBuckets: rb, nonCmdrCards } = profile;

  // Turn probabilities T1..T8
  const turns = [1, 2, 3, 4, 5, 6, 7, 8];
  const probs = turns.map(T => pCastOnTurn(T, effectiveProfile));

  const maxProb = Math.max(...probs, 0.01);
  const bars = turns.map((T, i) => {
    const pct = probs[i];
    const barH = Math.round((pct / maxProb) * 100);
    const color = Math.round(pct * 100) >= 80 ? 'var(--green)' : pct >= 0.50 ? 'var(--yellow)' : 'var(--red)';
    return `
      <div class="mc-col">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barH}%;background:${color}">
            <span class="mc-col-count mc-col-count--above" style="color:${color}">${(pct * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div class="mc-col-label">T${T}</div>
      </div>`;
  }).join('');

  // Info text
  const bucketSummary = rampBuckets.length > 0
    ? rampBuckets.map(b => `${b.count}× CMC${b.cmc} ${b.isDork ? 'dork' : 'rock'}(${b.value.toFixed(1)}, ${(b.castability * 100).toFixed(0)}% castable)`).join(', ')
    : 'no ramp detected';
  const landLabel = tappedLandCount > 0
    ? `${untappedLandCount}+${tappedLandCount} tapped lands`
    : `${landCount} lands`;
  _castInfoText = [
    `Probability of having enough mana + the right colors to cast your commander on each turn.`,
    ``,
    `Factors included:`,
    `• Lands: ${landLabel} (tapped lands modeled as 1-turn delay)`,
    `• Ramp: ${rampCount} pieces — mana rocks (tap same turn for net mana), mana dorks (tap turn after), and rituals (burst mana on cast turn)`,
    `• Colors: inclusion-exclusion over all required pips; dual/tri-color lands satisfy multiple colors simultaneously`,
    ``,
    `Ramp detection uses Moxfield categories (#mana-rock, #mana-dork, #ramp) and oracle text patterns. These are estimates based on opening hand draw probability and do not model advanced board states.`,
    ``,
    `Ramp details: ${bucketSummary}`,
  ].join('\n');

  // Recommendation line: what would it take to reach 80% on curve?
  const onCurveP = probs[commanderCmc - 1] ?? 0;
  let recLine = '';
  if (commanderCmc >= 1 && commanderCmc <= 8 && Math.round(onCurveP * 100) < 80) {
    // Try adding hypothetical untapped lands until 80% is hit
    let extraNeeded = null;
    for (let extra = 1; extra <= 30; extra++) {
      const modProfile = {
        ...effectiveProfile,
        N: N + extra,
        landCount: landCount + extra,
        untappedLandCount: (profile.untappedLandCount ?? landCount) + extra,
      };
      const p = pCastOnTurn(commanderCmc, modProfile);
      if (Math.round(p * 100) >= 80) { extraNeeded = extra; break; }
    }

    // Find weakest color (lowest P(≥1 source) at curve turn draws)
    const curveDraw = 7 + commanderCmc;
    let weakestColor = null;
    let weakestP = 1;
    for (const c of commanderColors) {
      const src = profile.landColorSources?.[c] ?? 0;
      const p = src > 0 ? hypgeomAtLeast(1, N, src, curveDraw) : 0;
      if (p < weakestP) { weakestP = p; weakestColor = c; }
    }

    const parts = [];
    if (extraNeeded !== null) {
      parts.push(`+${extraNeeded} mana source${extraNeeded > 1 ? 's' : ''} for 80% on turn ${commanderCmc}`);
    } else {
      parts.push(`80% on curve may require significant changes`);
    }
    if (weakestColor && weakestP < 0.80) {
      const COLOR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
      parts.push(`${COLOR_NAMES[weakestColor] ?? weakestColor} is your weakest color (${(weakestP * 100).toFixed(0)}%)`);
    }
    recLine = `<div class="cast-rec-line">${parts.join(' · ')}</div>`;
  }

  // ── Effective-cost override row (stepper + color pips) ──────────────────────
  const WUBRG = ['W', 'U', 'B', 'R', 'G'];
  const activeColorSet = new Set(commanderColors);
  const pipButtons = WUBRG.map(c => {
    const active = activeColorSet.has(c);
    return `<button type="button"
      class="cost-color-pip color-pip color-pip--${c} ${active ? 'cost-color-pip--on' : 'cost-color-pip--off'}"
      onclick="window.__cast.toggleColor('${c}')"
      title="${active ? 'Remove' : 'Add'} ${c}">${c}</button>`;
  }).join('');
  const resetBtn = overrideActive
    ? `<button type="button" class="cost-reset-btn" onclick="window.__cast.resetCost()" title="Reset to commander's actual cost">↺ reset</button>`
    : '';
  const overrideRow = `
    <div class="cast-cost-override${overrideActive ? ' cast-cost-override--active' : ''}">
      <span class="cast-cost-label">Cost</span>
      <div class="calc-stepper">
        <button class="calc-stepper-btn" onclick="window.__cast.costDec()">−</button>
        <span class="calc-stepper-value">${effectiveGeneric}</span>
        <button class="calc-stepper-btn" onclick="window.__cast.costInc()">+</button>
      </div>
      <div class="cost-color-pips">${pipButtons}</div>
      ${resetBtn}
    </div>`;

  return `
    <div class="section-label" style="display:flex;align-items:center;gap:8px">
      Commander Castability
      <span class="cast-threshold-badge cast-threshold-badge--${_badgeClass}">80% by ${_badgeText}</span>
      <button class="info-icon-btn" onclick="window.__cast.showInfo()" title="Calculation details">ℹ</button>
    </div>
    ${overrideRow}
    <div class="mc-col-chart mc-col-chart--cast">${bars}</div>
    ${recLine}`;
}

/** Sum of {N} generic symbols in a mana cost like "{3}{G}{U}" → 3. */
export function parseGenericCost(manaCost) {
  if (!manaCost) return 0;
  let total = 0;
  for (const m of manaCost.matchAll(/\{(\d+)\}/g)) total += parseInt(m[1], 10);
  return total;
}

/** Mana analysis — color sources by turn. No dependency on tags/ramp. */
export function buildManaAnalysisSection(profile) {
  const colorAnalysis = buildColorByTurnRows(profile);
  if (!colorAnalysis) return '';
  return `
    <div class="section-label">Mana Analysis</div>
    ${colorAnalysis}`;
}

/** Color source analysis with per-turn picker and "+X more for 80%" recommendations. */
function buildColorByTurnRows(profile) {
  const { commanderColorIdentity, commanderColors, commanderCmc, landColorSources, nonCmdrCards, N } = profile;
  const WUBRG = ['W', 'U', 'B', 'R', 'G'];
  const rawColors = commanderColorIdentity ?? commanderColors;
  const colors = [...rawColors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  if (!colors.length) return '';

  const selectedT = _colorTurn ?? commanderCmc;

  // Turn stepper with +/− buttons
  const pickerRow = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span class="muted" style="font-size:10px;white-space:nowrap">by turn</span>
      <div class="calc-stepper">
        <button class="calc-stepper-btn" onclick="window.__cast.setColorTurn(Math.max(1,${selectedT}-1))">−</button>
        <span class="calc-stepper-value">${selectedT}</span>
        <button class="calc-stepper-btn" onclick="window.__cast.setColorTurn(Math.min(15,${selectedT}+1))">+</button>
      </div>
    </div>`;

  const n = 7 + selectedT; // cards in hand on turn selectedT

  // Minimum sources for 80% P(≥1 in n draws)
  function sourcesFor80(N, n) {
    for (let k = 1; k <= N; k++) {
      if (hypgeomAtLeast(1, N, k, n) >= 0.80) return k;
    }
    return Infinity;
  }

  // Per-color rows — land sources only (rocks/dorks need casting first)
  const colorRows = colors.map(c => {
    const sources = landColorSources[c] ?? 0;
    const pBy = hypgeomAtLeast(1, N, sources, n);
    const pct = (pBy * 100).toFixed(0);
    const pctColor = pBy >= 0.80 ? 'var(--green)' : pBy >= 0.50 ? 'var(--yellow)' : 'var(--red)';
    const needed = sourcesFor80(N, n);
    const extra = needed === Infinity ? null : Math.max(0, needed - sources);
    // Only show recommendation when not already at 80%
    const recText = extra && extra > 0
      ? `<span style="color:var(--yellow);font-size:10px">+${extra} for 80%</span>`
      : '';
    return `
      <div class="color-source-row">
        <span class="color-pip color-pip--${c}">${c}</span>
        <span style="font-size:11px">${sources} lands</span>
        <span style="font-size:11px;color:${pctColor}">${pct}%</span>
        ${recText}
      </div>`;
  }).join('');

  // All-colors joint row — land sources only (consistent with per-color rows)
  // Pass ALL cards so non-lands are counted as non-producers in the hypergeometric model,
  // but strip producedMana from non-lands so only land color sources are counted.
  const landOnlyColorCards = nonCmdrCards.map(c =>
    c.types?.includes('Land') ? c : { ...c, producedMana: [] }
  );
  const pAllJoint = commanderColors.length >= 2
    ? pAllColors(commanderColors, landOnlyColorCards, N, n) : null;
  const allColorsRow = pAllJoint !== null ? (() => {
    const allPct = (pAllJoint * 100).toFixed(0);
    const allColor = pAllJoint >= 0.80 ? 'var(--green)' : pAllJoint >= 0.50 ? 'var(--yellow)' : 'var(--red)';
    return `
    <div class="color-source-row" style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px">
      <span class="color-pip-spacer"></span>
      <span style="font-size:11px;font-weight:500">All ${commanderColors.length}c</span>
      <span style="font-size:11px;color:${allColor}">${allPct}%</span>
    </div>`;
  })() : '';

  return `
    ${pickerRow}
    <div>${colorRows}${allColorsRow}</div>`;
}

// ─── Effect Lab: Sub-tab Bar ──────────────────────────────────────────────────

function buildSubTabBar() {
  return `
    <div class="calc-subtab-bar">
      <button class="calc-subtab-btn ${_activeSubTab === 'top_n' ? 'calc-subtab-btn--active' : ''}"
        onclick="window.__calc.setSubTab('top_n')">Cards Off the Top</button>
      <button class="calc-subtab-btn ${_activeSubTab === 'cascade' ? 'calc-subtab-btn--active' : ''}"
        onclick="window.__calc.setSubTab('cascade')">Cascade / Discover</button>
    </div>`;
}

function buildCascadeTab(deck) {
  const allCards = deck.cards.filter(c => !c.isCommander);
  const mv = _cascadeMV;
  const mode = _cascadeMode;
  const profile = extractDeckProfile(deck);

  // Cascade: non-land cards with CMC strictly less than MV
  // Discover: non-land cards with CMC less than or equal to MV
  const isHit = mode === 'cascade'
    ? c => !c.types?.includes('Land') && (c.cmc ?? 0) < mv
    : c => !c.types?.includes('Land') && (c.cmc ?? 0) <= mv;
  const hits = allCards.filter(isHit);
  const totalHits = hits.reduce((s, c) => s + c.quantity, 0);

  const modeLabel = mode === 'cascade' ? 'Cascade' : 'Discover';
  const mvCompare = mode === 'cascade' ? '<' : '≤';

  // Mode toggle
  const modeToggle = `
    <div class="view-toggle" style="margin-bottom:10px">
      <button class="view-toggle-btn ${mode === 'cascade' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setMode('cascade')">Cascade</button>
      <button class="view-toggle-btn ${mode === 'discover' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setMode('discover')">Discover</button>
    </div>`;

  // MV stepper
  const mvStepper = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
      <span class="muted" style="font-size:11px;white-space:nowrap">MV</span>
      <div class="calc-stepper">
        <button class="calc-stepper-btn" onclick="window.__cascade.setMV(Math.max(1,${mv}-1))">−</button>
        <span class="calc-stepper-value">${mv}</span>
        <button class="calc-stepper-btn" onclick="window.__cascade.setMV(Math.min(16,${mv}+1))">+</button>
      </div>
      <span class="muted" style="font-size:11px">non-land with CMC ${mvCompare} ${mv}</span>
    </div>`;

  // ── Breakdown: Type or Tag view ──────────────────────────────────────────────
  const isTypeView = _cascadeFilter !== 'tag';

  const filterToggle = `
    <div class="view-toggle" style="margin-bottom:6px">
      <button class="view-toggle-btn ${isTypeView ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setFilter(null)">Type</button>
      <button class="view-toggle-btn ${!isTypeView ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setFilter('tag')">Tag</button>
    </div>`;

  const sortToggle = `
    <div class="view-toggle" style="margin-bottom:6px">
      <button class="view-toggle-btn ${_cascadeSort === 'value' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setSort('value')">Value</button>
      <button class="view-toggle-btn ${_cascadeSort === 'alpha' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__cascade.setSort('alpha')">Alpha</button>
    </div>`;

  let breakdownEntries;
  if (isTypeView) {
    const typeCounts = {};
    for (const card of hits) {
      const type = CARD_TYPES.find(t => t !== 'MDFC' && card.types?.includes(t)) || 'Other';
      typeCounts[type] = (typeCounts[type] || 0) + card.quantity;
    }
    breakdownEntries = CARD_TYPES
      .filter(t => t !== 'MDFC' && t !== 'Unknown' && (typeCounts[t] || 0) > 0)
      .map(t => ({ label: t, count: typeCounts[t], color: TYPE_COLORS[t] || TYPE_COLORS.Other || '#6b7280' }));
  } else {
    const tagCounts = {};
    for (const card of hits) {
      const tags = card.moxTags || [];
      if (!tags.length) {
        tagCounts['(untagged)'] = (tagCounts['(untagged)'] || 0) + card.quantity;
      } else {
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + card.quantity;
        }
      }
    }
    breakdownEntries = Object.entries(tagCounts).map(([tag, count]) => ({
      label: tag,
      count,
      color: tag === '(untagged)' ? '#6b7280' : tagColor(tag),
    }));
  }

  // Sort
  breakdownEntries = _cascadeSort === 'alpha'
    ? [...breakdownEntries].sort((a, b) => a.label.localeCompare(b.label))
    : [...breakdownEntries].sort((a, b) => b.count - a.count);

  const maxCount = Math.max(1, ...breakdownEntries.map(e => e.count));
  const breakdownRows = breakdownEntries.map(({ label, count, color }) => {
    const pct = totalHits > 0 ? (count / totalHits * 100) : 0;
    const barPct = Math.round((count / maxCount) * 100);
    return `
      <div class="hand-chart-row">
        <div class="hand-chart-label">
          <span class="legend-dot" style="background:${color}"></span>
          ${escapeHtml(label)}
        </div>
        <div class="hand-chart-bar-track">
          <div class="hand-chart-bar" style="width:${barPct}%;background:${color}"></div>
        </div>
        <div class="hand-chart-value">${count} <span class="muted" style="font-size:10px">(${pct.toFixed(0)}%)</span></div>
      </div>`;
  }).join('');

  const breakdownChart = totalHits > 0
    ? `<div class="hand-chart">${breakdownRows}</div>`
    : `<p class="muted" style="font-size:11px">No valid targets at MV ${mvCompare} ${mv}.</p>`;

  // ── Sample card pile (overlapping stack like overview tab) ────────────────────
  const sampleSize = Math.min(15, hits.length);
  const shuffled = [...hits].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  const sampleCards = sample.map((card, idx) => {
    const isLast = idx === sample.length - 1;
    const imgUrl = escapeHtml(card.imageUrl || '');
    const tags = card.moxTags || [];
    const tagsAttr = JSON.stringify(tags).replace(/"/g, '&quot;');
    const castPct = computeCardCastability(card, profile);
    const castAttr = castPct !== null ? ` data-castability="${Math.round(castPct * 100)}"` : '';

    if (card.imageUrl) {
      return `
        <div class="card-stack-item cascade-stack-item${isLast ? ' card-stack-item--last' : ''}"
          data-image-url="${imgUrl}"
          data-tags="${tagsAttr}"${castAttr}
          onmouseenter="window.__pileCard?.show(this.dataset.imageUrl, this); window.__preview?.showTagsWithMeta(JSON.parse(this.dataset.tags || '[]'), this.dataset.castability ? {label:'On curve',value:this.dataset.castability+'%'} : null, this)"
          onmouseleave="window.__pileCard?.hide(); window.__preview?.hide()">
          <img src="${imgUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
        </div>`;
    }
    return `
      <div class="card-stack-item card-stack-item--noimage cascade-stack-item${isLast ? ' card-stack-item--last' : ''}"
        data-tags="${tagsAttr}"${castAttr}
        onmouseenter="window.__preview?.showTagsWithMeta(JSON.parse(this.dataset.tags || '[]'), this.dataset.castability ? {label:'On curve',value:this.dataset.castability+'%'} : null, this)"
        onmouseleave="window.__preview?.hide()">
        <span class="card-stack-name">${escapeHtml(card.name)}</span>
      </div>`;
  }).join('');

  const sampleHTML = totalHits > 0
    ? `<div class="cascade-card-pile">${sampleCards}</div>`
    : `<p class="muted" style="font-size:11px">No targets to sample.</p>`;

  return `
    <div class="section">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${modeToggle}
      </div>
      ${mvStepper}
      <div class="muted" style="font-size:11px;margin-bottom:16px">
        ${totalHits} valid ${modeLabel.toLowerCase()} target${totalHits !== 1 ? 's' : ''} in deck (non-land, CMC ${mvCompare} ${mv})
      </div>
      <div class="cast-mana-row">
        <div class="cast-mana-col">
          <div class="section-label">Target Breakdown</div>
          <div class="card-browser-controls">${filterToggle}${sortToggle}</div>
          ${breakdownChart}
        </div>
        <div class="cast-mana-col">
          <div class="section-label" style="display:flex;align-items:center;gap:8px">
            Sample Targets
            <button class="btn-secondary btn-sm" style="padding:1px 8px;font-size:10px" onclick="window.__cascade.resample()">Resample</button>
          </div>
          ${sampleHTML}
        </div>
      </div>
    </div>`;
}

// ─── Effect Lab: Top-N Tab ────────────────────────────────────────────────────

function buildTopNTab(deck) {
  const defs = deck.effectDefs || [];
  const defsHTML = defs.map((def, i) => buildEffectSection(deck, def, i)).join('');

  return `
    <div class="section">
      <div class="section-label">Cards Off the Top</div>
      <p class="muted" style="font-size:12px;margin-bottom:12px">
        Analyze probability of finding specific cards when looking at the top N of your library (scry, surveil, impulse draw, etc.).
      </p>
      ${defs.length === 0
        ? `<p class="muted" style="font-size:12px;margin-bottom:10px">No effects defined. Add one below.</p>`
        : defsHTML}
      <button class="btn-secondary btn-sm" onclick="window.__calc.addEffect()">+ Add Effect</button>
    </div>`;
}

// ─── Effect Lab: Single Effect Section ───────────────────────────────────────

function buildEffectSection(deck, def, defIdx) {
  const criteria = def.criteria || [];
  const K        = countMatchingCombined(deck, criteria);
  const lookAtN  = def.lookAtN  || 3;
  const hitTarget = Math.min(def.hitTarget || 1, lookAtN);
  const canCalc  = K > 0 && hitTarget <= K && hitTarget <= lookAtN;
  const currentPct = canCalc
    ? Math.round(hypgeomAtLeast(hitTarget, 99, K, lookAtN) * 100) : 0;
  const pctClass = K === 0 ? 'def-pct--none'
    : currentPct >= 60 ? 'def-pct--good'
    : currentPct >= 40 ? 'def-pct--warn' : 'def-pct--bad';

  // N stepper
  const stepper = `
    <div class="calc-stepper">
      <button class="calc-stepper-btn" onclick="window.__calc.decrementN('${def.id}')">−</button>
      <span class="calc-stepper-value">${lookAtN}</span>
      <button class="calc-stepper-btn" onclick="window.__calc.incrementN('${def.id}')">+</button>
    </div>`;

  // Hit-target picker (shown when N > 1)
  const hitSampleBtn = canCalc
    ? `<button class="btn-secondary btn-sm" style="margin-top:6px;padding:2px 8px;font-size:10px"
        onclick="window.__calc.showHitSample('${def.id}')">Show sample</button>`
    : `<button class="btn-secondary btn-sm" style="margin-top:6px;padding:2px 8px;font-size:10px" disabled
        title="Need at least ${hitTarget} hit${hitTarget > 1 ? 's' : ''} in deck">Show sample</button>`;
  const hitTargetPicker = lookAtN > 1 ? `
    <div style="margin-top:10px">
      <div class="input-label" style="margin-bottom:4px">Looking for (hits wanted)</div>
      <div class="hit-target-picker">
        ${Array.from({ length: lookAtN }, (_, i) => i + 1).map(n => `
          <button class="hit-target-btn ${n === hitTarget ? 'hit-target-btn--active' : ''}"
            onclick="window.__calc.setHitTarget('${def.id}', ${n})">${n}</button>`).join('')}
      </div>
      ${hitSampleBtn}
    </div>` : `<div style="margin-top:10px">${hitSampleBtn}</div>`;

  // Criteria editor
  const criteriaHTML = buildEffectCriteriaEditor(deck, def, K);

  // Graphs always render — 0 criteria treated as "any card" (K = non-commander deck size)
  const graphsHTML = `<div id="calc-graphs-${def.id}" class="calc-graphs-row" style="margin-top:16px">
    ${buildNSensGraph(lookAtN, hitTarget, K)}
    ${buildSrcSensGraph(lookAtN, hitTarget, K)}
  </div>`;

  const isOpen = _openEffectIds.has(def.id);

  return `
    <details class="calc-effect-section" data-def-id="${def.id}" ${isOpen ? 'open' : ''}
      ontoggle="window.__calc.onEffectToggle('${def.id}', this.open)">
      <summary class="calc-effect-summary">
        <span class="calc-effect-chevron">▶</span>
        <span class="calc-effect-title">${escapeHtml(def.name || `Effect ${defIdx + 1}`)}</span>
        <span class="def-pct ${pctClass}" style="flex-shrink:0">${K > 0 ? currentPct + '%' : '—'}</span>
        <span class="muted" style="font-size:10px;flex-shrink:0">top ${lookAtN} · K=${K}</span>
        <button class="btn-icon btn-danger" style="margin-left:auto;flex-shrink:0"
          onclick="event.preventDefault();event.stopPropagation();window.__calc.removeEffect('${def.id}')"
          title="Remove">✕</button>
      </summary>
      <div class="calc-effect-body">
        <div class="def-editor-field" style="margin-bottom:14px">
          <label class="input-label">Effect Name</label>
          <input class="input-text" type="text" value="${escapeHtml(def.name || '')}"
            placeholder="e.g. Scry 3" style="max-width:280px"
            oninput="window.__calc.setEffectName('${def.id}', this.value)" />
        </div>
        <div class="calc-two-col">
          <div>
            <div class="input-label" style="margin-bottom:6px">Look at N cards off the top</div>
            ${stepper}
            ${hitTargetPicker}
          </div>
          <div>
            <div class="input-label" style="margin-bottom:6px">What counts as a hit? <span class="muted">(any must match)</span></div>
            ${criteriaHTML}
          </div>
        </div>
        ${graphsHTML}
      </div>
    </details>`;
}

// ─── Effect Lab: Criteria Editor ─────────────────────────────────────────────

function buildEffectCriteriaEditor(deck, def, combinedK) {
  const criteria = def.criteria || [];

  const rows = criteria.map((crit, idx) =>
    buildCalcCriterionRow(def, crit, idx, deck)
  ).join('');

  const hitListBtn = combinedK > 0
    ? `<button class="btn-secondary btn-sm" style="margin-top:6px"
        data-hitlist-btn="${def.id}"
        onclick="window.__calc.showHitList('${def.id}')">Show all ${combinedK} hits</button>`
    : '';

  return `
    <div id="calc-criteria-list-${def.id}">
      ${rows || '<p class="muted" style="font-size:11px;margin-bottom:4px">No criteria — matches any card (K = deck size).</p>'}
    </div>
    <button class="btn-secondary btn-sm" style="margin-top:6px;margin-right:4px"
      onclick="window.__calc.addCrit('${def.id}')">+ Add Criterion</button>
    ${hitListBtn}`;
}

function buildCalcCriterionRow(def, crit, idx, deck) {
  const typeInfo    = CRITERION_TYPES[crit.type];
  const critK       = countMatchingForCriterion(deck, crit);
  const sampleCards = matchingCardsForCriterion(deck, crit).slice(0, 5);

  const typeDropdown = buildCalcCritTypeDropdown(crit, idx, def.id);

  const fields      = typeInfo?.fields || [];
  const valueFields = fields.filter(f => f.key !== 'count');
  const valueWidgets = valueFields.map(f => {
    const prefix = f.prefix ? `<span class="crit-label">${escapeHtml(f.prefix)}</span>` : '';
    return prefix + buildCalcFieldWidget(f, crit, idx, def.id, deck);
  }).join('');

  const kBadge = `<span class="def-pct ${critK > 0 ? 'def-pct--good' : 'def-pct--none'}" style="font-size:10px;padding:1px 5px">${critK}</span>`;

  const sampleBtn = sampleCards.length
    ? `<button class="btn-secondary btn-sm" style="padding:1px 6px;font-size:10px"
        onclick="window.__calc.showCritSample('${def.id}', ${idx})">Show</button>`
    : '';

  return `
    <div class="calc-criterion-container">
      <div class="criterion-row" data-calc-crit-idx="${idx}" data-calc-def-id="${def.id}">
        <span class="crit-label">Match</span>
        ${typeDropdown}
        ${valueWidgets}
        ${kBadge}
        ${sampleBtn}
        <div class="crit-remove-col">
          <button class="btn-icon btn-danger"
            onclick="window.__calc.removeCrit('${def.id}', ${idx})" title="Remove">✕</button>
        </div>
      </div>
    </div>`;
}

function buildCalcCritTypeDropdown(crit, idx, defId) {
  const typeInfo = CRITERION_TYPES[crit.type];
  const label    = typeInfo?.label ?? crit.type;
  return `
    <details class="crit-type-dropdown">
      <summary class="crit-type-toggle">${escapeHtml(label)}</summary>
      <div class="crit-type-list">
        ${CRITERION_TYPE_OPTIONS.map(ct => `
          <div class="crit-type-option ${ct.id === crit.type ? 'crit-type-option--active' : ''}"
            onclick="window.__calc.changeCritType('${defId}',${idx},'${ct.id}');this.closest('details').removeAttribute('open')">
            ${escapeHtml(ct.label)}
          </div>`).join('')}
      </div>
    </details>`;
}

const CALC_MV_VALUES = ['0', '1', '2', '3', '4', '5', '6+'];

function buildCalcFieldWidget(field, crit, idx, defId, deck) {
  const val = crit[field.key];

  if (field.widget === 'types_and_tags_multiselect') {
    const rawTypes = Array.isArray(crit.cardTypes) ? crit.cardTypes : [];
    const rawTags  = Array.isArray(crit.tagNames)  ? crit.tagNames  : [];
    const types    = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown' && t !== 'MDFC');
    const deckTags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    const selTypes = types.filter(t => rawTypes.includes(t));
    const selTags  = deckTags.filter(t => rawTags.includes(t));
    const parts    = [];
    if (selTypes.length) parts.push(selTypes.join('/'));
    if (selTags.length)  parts.push(selTags.join('/'));
    const summaryText = parts.length > 0 ? parts.join(' & ') : '(Any Card)';
    const typeItems = types.map(t => {
      const checked = selTypes.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="type">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleType('${defId}',${idx},'${t}','cardTypes')">
        <span>${t}</span></label>`;
    }).join('');
    const tagItems = deckTags.map(t => {
      const checked = selTags.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="tag">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleTag('${defId}',${idx},${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(t)}</span></label>`;
    }).join('');
    const tagsSection = deckTags.length > 0
      ? `<div class="ms-separator">&amp; Tags (any)</div>${tagItems}`
      : `<div class="ms-separator">&amp; Tags (any)</div><div class="ms-empty">No tags in deck</div>`;
    return `
      <details class="crit-ms-dropdown" data-ms-type="combined">
        <summary class="crit-ms-toggle">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">
          <div class="ms-separator ms-separator--first">Types (any)</div>
          ${typeItems}
          ${tagsSection}
        </div>
      </details>`;
  }

  if (field.widget === 'subtypes_multiselect') {
    const rawSubtypes = Array.isArray(val) ? val : [];
    const rawTypes    = Array.isArray(crit.cardTypes) ? crit.cardTypes : [];
    const typeSubtypeMap = {};
    for (const card of deck.cards) {
      for (const t of (card.types || [])) {
        if (!typeSubtypeMap[t]) typeSubtypeMap[t] = new Set();
        for (const s of (card.subtypes || [])) typeSubtypeMap[t].add(s);
      }
    }
    const typeSubtypeMapObj = {};
    for (const [t, subs] of Object.entries(typeSubtypeMap)) typeSubtypeMapObj[t] = [...subs].sort();
    const subtypeMapAttr = JSON.stringify(typeSubtypeMapObj).replace(/"/g, '&quot;');
    const deckSubtypes = rawTypes.length
      ? [...new Set(rawTypes.flatMap(t => typeSubtypeMapObj[t] || []))].sort()
      : [...new Set(Object.values(typeSubtypeMapObj).flat())].sort();
    const selected    = deckSubtypes.filter(s => rawSubtypes.includes(s));
    const summaryText = selected.length > 0 ? selected.join('/') : '(Any Subtype)';
    const items = deckSubtypes.map(s => {
      const checked = selected.includes(s);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="subtype">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleSubtype('${defId}',${idx},${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(s)}</span></label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown" data-ms-key="${field.key}" data-subtype-map="${subtypeMapAttr}">
        <summary class="crit-ms-toggle">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items || '<div class="ms-empty">No subtypes in deck</div>'}</div>
      </details>`;
  }

  if (field.widget === 'mv_multiselect') {
    const raw      = Array.isArray(val) ? val : [];
    const selected = CALC_MV_VALUES.filter(v => raw.includes(v));
    const summaryText = selected.length > 0 ? selected.join('/') : '(Any MV)';
    const items = CALC_MV_VALUES.map(mv => {
      const checked = selected.includes(mv);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleMv('${defId}',${idx},'${mv}')">
        <span>${mv}</span></label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  if (field.widget === 'cards_multiselect') {
    const raw      = Array.isArray(val) ? val : [];
    const cardMap  = Object.fromEntries(deck.cards.map(c => [c.name, c]));
    const names    = [...new Set(deck.cards.map(c => c.name))].sort();
    const selected = names.filter(n => raw.includes(n));
    const summaryText = selected.length === 0 ? '(select card…)'
      : selected.length <= 2 ? selected.join('/')
      : `${selected.length} cards`;
    const items = names.map(n => {
      const checked  = selected.includes(n);
      const imgUrl   = escapeHtml(cardMap[n]?.imageUrl     || '');
      const backUrl  = escapeHtml(cardMap[n]?.backImageUrl || '');
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}"
        data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
        onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
        onmouseleave="window.__preview?.hide()">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleCard('${defId}',${idx},${JSON.stringify(n).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(n)}</span></label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  if (field.widget === 'tags_multiselect') {
    const raw  = Array.isArray(val) ? val : [];
    const tags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    if (!tags.length) return `<span class="muted" style="font-size:11px">No tags in deck</span>`;
    const selected    = tags.filter(t => raw.includes(t));
    const summaryText = selected.length > 0 ? selected.join('/') : '(select tag…)';
    const items = tags.map(t => {
      const checked = selected.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__calc.toggleTag('${defId}',${idx},${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(t)}</span></label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  return '';
}

// ─── Effect Lab: Card Counting ────────────────────────────────────────────────

function countMatchingForCriterion(deck, crit) {
  const ct = CRITERION_TYPES[crit.type];
  if (!ct) return 0;
  return deck.cards
    .filter(c => !c.isCommander)
    .filter(c => ct.evaluate({ ...crit, count: 1 }, [c]))
    .reduce((s, c) => s + c.quantity, 0);
}

function countMatchingCombined(deck, criteria) {
  const nonCmdr = deck.cards.filter(c => !c.isCommander);
  if (!criteria.length) return nonCmdr.reduce((s, c) => s + c.quantity, 0);
  return nonCmdr
    .filter(c => criteria.some(crit => {
      const ct = CRITERION_TYPES[crit.type];
      return ct ? ct.evaluate({ ...crit, count: 1 }, [c]) : false;
    }))
    .reduce((s, c) => s + c.quantity, 0);
}

/** Exported: used by app.js to build the hit-list modal */
export function matchingCardsForEffect(deck, criteria) {
  const nonCmdr = deck.cards.filter(c => !c.isCommander);
  const hits = !criteria.length
    ? nonCmdr
    : nonCmdr.filter(c => criteria.some(crit => {
        const ct = CRITERION_TYPES[crit.type];
        return ct ? ct.evaluate({ ...crit, count: 1 }, [c]) : false;
      }));
  return hits
    .sort((a, b) => {
      const ta = CARD_TYPES.find(t => a.types?.includes(t)) || 'Other';
      const tb = CARD_TYPES.find(t => b.types?.includes(t)) || 'Other';
      const ti = CARD_TYPES.indexOf(ta), tj = CARD_TYPES.indexOf(tb);
      return ti !== tj ? ti - tj : a.name.localeCompare(b.name);
    });
}

/** Exported: used by app.js to build per-criterion sample modal */
export function matchingCardsForCriterion(deck, crit) {
  const ct = CRITERION_TYPES[crit.type];
  if (!ct) return [];
  return deck.cards
    .filter(c => !c.isCommander && ct.evaluate({ ...crit, count: 1 }, [c]))
    .sort((a, b) => {
      const ta = CARD_TYPES.find(t => a.types?.includes(t)) || 'Other';
      const tb = CARD_TYPES.find(t => b.types?.includes(t)) || 'Other';
      const ti = CARD_TYPES.indexOf(ta), tj = CARD_TYPES.indexOf(tb);
      return ti !== tj ? ti - tj : a.name.localeCompare(b.name);
    });
}

// ─── Effect Lab: Graphs ───────────────────────────────────────────────────────

const DECK_SIZE = 99;

export function buildNSensGraph(lookAtN, hitTarget, K) {
  const startN  = Math.max(1, lookAtN - 4);
  const nValues = [];
  for (let n = startN; n < startN + 10 && n <= DECK_SIZE; n++) nValues.push(n);

  const probs = nValues.map(n =>
    K > 0 && hitTarget <= K && hitTarget <= n
      ? hypgeomAtLeast(hitTarget, DECK_SIZE, K, n) * 100 : 0
  );
  const maxProb = Math.max(1, ...probs);

  let rec80N = null;
  if (K > 0) {
    for (let n = hitTarget; n <= DECK_SIZE; n++) {
      if (hypgeomAtLeast(hitTarget, DECK_SIZE, K, n) >= 0.8) { rec80N = n; break; }
    }
  }

  const cols = nValues.map((n, i) => {
    const pct  = probs[i];
    const barH = Math.round((pct / maxProb) * 100);
    const color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
    const isCurrent = n === lookAtN;
    return `
      <div class="mc-col${isCurrent ? ' mc-col--current' : ''}" title="N=${n}: ${pct.toFixed(1)}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barH}%;background:${color}">
            <span class="mc-col-count mc-col-count--above" style="color:${color}">${Math.round(pct)}%</span>
          </div>
        </div>
        <div class="mc-col-label">${n}</div>
      </div>`;
  }).join('');

  let recText;
  if (K === 0) recText = 'Add criteria above to calculate.';
  else if (rec80N === null) recText = `Cannot reach 80% — add more sources.`;
  else if (rec80N <= lookAtN) recText = `Current N achieves ≥80% to hit ${hitTarget}.`;
  else recText = `Need to look at <strong>${rec80N}</strong> cards for 80% to hit ${hitTarget}.`;

  return `
    <div class="calc-graph-panel">
      <div class="calc-graph-title">N Sensitivity</div>
      <div class="muted" style="font-size:10px;margin-bottom:6px">How looking at more cards changes probability</div>
      <div class="mc-col-chart mc-col-chart--calc">${cols}</div>
      <div class="calc-x-axis-label">Cards Looked At</div>
      <div class="calc-rec">${recText}</div>
    </div>`;
}

export function buildSrcSensGraph(lookAtN, hitTarget, K) {
  const startK  = Math.max(0, K - 4);
  const kValues = [];
  for (let k = startK; k < startK + 10 && k <= DECK_SIZE; k++) kValues.push(k);

  const probs = kValues.map(k =>
    k > 0 && hitTarget <= k && hitTarget <= lookAtN
      ? hypgeomAtLeast(hitTarget, DECK_SIZE, k, lookAtN) * 100 : 0
  );
  const maxProb = Math.max(1, ...probs);

  let rec80K = null;
  for (let k = hitTarget; k <= DECK_SIZE; k++) {
    if (hypgeomAtLeast(hitTarget, DECK_SIZE, k, lookAtN) >= 0.8) { rec80K = k; break; }
  }

  const cols = kValues.map((k, i) => {
    const pct  = probs[i];
    const barH = Math.round((pct / maxProb) * 100);
    const color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
    const isCurrent = k === K;
    return `
      <div class="mc-col${isCurrent ? ' mc-col--current' : ''}" title="K=${k}: ${pct.toFixed(1)}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barH}%;background:${color}">
            <span class="mc-col-count mc-col-count--above" style="color:${color}">${Math.round(pct)}%</span>
          </div>
        </div>
        <div class="mc-col-label">${k}</div>
      </div>`;
  }).join('');

  let recText;
  if (K === 0) recText = 'Add criteria above to calculate.';
  else if (rec80K === null) recText = `Cannot reach 80% — increase N (look at more cards).`;
  else if (rec80K <= K) recText = `Current sources achieve ≥80% to hit ${hitTarget}.`;
  else recText = `Add <strong>${rec80K - K}</strong> more sources for 80% to hit ${hitTarget}.`;

  return `
    <div class="calc-graph-panel">
      <div class="calc-graph-title">Sources Sensitivity</div>
      <div class="muted" style="font-size:10px;margin-bottom:6px">How adding more qualifying cards changes probability</div>
      <div class="mc-col-chart mc-col-chart--calc">${cols}</div>
      <div class="calc-x-axis-label">Sources</div>
      <div class="calc-rec">${recText}</div>
    </div>`;
}
