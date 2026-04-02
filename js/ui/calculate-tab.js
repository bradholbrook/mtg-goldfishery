/**
 * mullstat — Calculate Tab
 *
 * Pure hypergeometric probability analysis. No simulation required.
 * Results update instantly from deck data.
 */

import { logBinom, hypgeomAtLeast, expectedValue } from '../hypergeometric.js';
import { CARD_TYPES, CANONICAL_CATEGORIES } from '../types.js';
import { escapeHtml, TYPE_COLORS } from './shared.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';

// ─── Module-level Lab State ───────────────────────────────────────────────────

let _labN      = 3;
let _labTarget = 'Land';

export function setLabN(n)      { _labN = n; }
export function setLabTarget(t) { _labTarget = t; }

// ─── Effect Lab State ─────────────────────────────────────────────────────────

let _activeSubTab = 'top_n';
const _openEffectIds = new Set(); // IDs of <details> currently open

export function setActiveSubTab(tab) { _activeSubTab = tab; }
export function setEffectOpen(id, open) {
  if (open) _openEffectIds.add(id); else _openEffectIds.delete(id);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function buildCalculateTab(deck) {
  return `
    <div style="padding:0 2px">
      ${buildSubTabBar()}
      ${_activeSubTab === 'top_n' ? buildTopNTab(deck) : buildCascadeTab()}
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

function isRamp(card) {
  return card.categories?.some(c => ['Ramp', 'Mana Rock', 'Mana Dork'].includes(c));
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
  for (const card of nonCmdr) {
    const produced = getProducedColors(card);
    for (const c of produced) {
      if (c in colorSources) colorSources[c] += card.quantity;
    }
  }

  const commanderCmc    = commander?.cmc ?? 0;
  const commanderColors = parsePipColors(commander?.manaCost);

  const rampCards   = nonCmdr.filter(c => !c.types?.includes('Land') && isRamp(c));
  const rampBuckets = buildRampBuckets(rampCards, N, colorSources, landCount, commanderColors.length);
  const rampCount   = rampCards.reduce((s, c) => s + c.quantity, 0);

  return {
    N, commander, commanderCmc, commanderColors,
    landCount, untappedLandCount, tappedLandCount,
    rampCount, rampBuckets, colorSources,
    nonCmdrCards: nonCmdr,  // needed for inclusion-exclusion color calc
    tagsStatus: deck.tagsStatus ?? 'ready',
  };
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
  const { commander, commanderCmc, commanderColors, colorSources,
          N, landCount, rampCount, rampBuckets, tappedLandCount, tagsStatus } = profile;

  if (!commander) {
    return `
      <div class="section">
        <div class="section-label">Commander Castability</div>
        <p class="muted" style="font-size:12px">No commander found in deck.</p>
      </div>`;
  }

  if (!commander.enriched) {
    return `
      <div class="section">
        <div class="section-label">Commander Castability</div>
        <p class="muted" style="font-size:12px">
          Import deck to fetch Scryfall data and see castability analysis.
        </p>
      </div>`;
  }

  if (tagsStatus === 'pending') {
    return `
      <div class="section">
        <div class="section-label">Commander Castability</div>
        <div class="tags-loading-state">
          <span class="tags-loading-spinner"></span>
          <span class="muted" style="font-size:12px">Fetching oracle tags…</span>
        </div>
      </div>`;
  }

  if (tagsStatus === 'failed') {
    return `
      <div class="section">
        <div class="section-label">Commander Castability</div>
        <p class="muted" style="font-size:12px">
          Oracle tag fetch timed out or failed — castability requires ramp data from Scryfall Tagger.
          Try re-importing the deck.
        </p>
      </div>`;
  }

  return `
    <div class="section">
      <div class="section-label" style="display:flex;align-items:center;gap:10px">
        Commander Castability
      </div>
      ${buildCastabilityBody(profile)}
    </div>`;
}

/** Inner chart + stats HTML, shared between the normal and tag-failed render paths. */
function buildCastabilityBody(profile) {
  const { commander, commanderCmc, commanderColors, colorSources,
          N, landCount, untappedLandCount, tappedLandCount,
          rampCount, rampBuckets, nonCmdrCards } = profile;

  // Debug: log ramp buckets and otags
  console.log('[castability] commander:', commander.name, 'CMC:', commanderCmc);
  console.log('[castability] ramp buckets:', rampBuckets.map(b =>
    `CMC=${b.cmc} ${b.isDork ? 'dork' : 'rock'} ×${b.count} val=${b.value.toFixed(2)} cast=${(b.castability * 100).toFixed(0)}%`
  ).join(' | ') || '(none)');
  if (commander.otags?.length) {
    console.log('[castability] commander otags:', commander.otags.join(', '));
  }

  // Turn probabilities T1..T8
  const turns = [1, 2, 3, 4, 5, 6, 7, 8];
  const probs = turns.map(T => pCastOnTurn(T, profile));

  // 80% threshold turn — compare to commander CMC for badge color
  const thresh80  = turns.find(T => Math.round(probs[T - 1] * 100) >= 80) ?? null;
  const badgeDelta = thresh80 === null ? Infinity : thresh80 - commanderCmc;
  const badgeClass = badgeDelta <= 0 ? 'good' : badgeDelta === 1 ? 'warn' : 'bad';
  const badgeText  = thresh80 ? `Turn ${thresh80}` : 'Turn 9+';

  // Bar chart
  const maxProb = Math.max(...probs, 0.01);
  const bars = turns.map((T, i) => {
    const pct = probs[i];
    const barH = Math.round((pct / maxProb) * 100);
    const color = Math.round(pct * 100) >= 80 ? 'var(--green)' : pct >= 0.50 ? 'var(--yellow)' : 'var(--red)';
    return `
      <div class="mc-col" title="Turn ${T}: ${(pct * 100).toFixed(1)}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barH}%;background:${color}"></div>
        </div>
        <div class="mc-col-count" style="color:${color}">${(pct * 100).toFixed(0)}%</div>
        <div class="mc-col-label">T${T}</div>
      </div>`;
  }).join('');

  // Combined color probability for multi-color commanders (inclusion-exclusion)
  const n = 7 + commanderCmc;
  const pColorsExact = pAllColors(commanderColors, nonCmdrCards, N, n);

  // Color source rows — show both per-color independent P and the combined joint P
  const colorRows = commanderColors.map(c => {
    const sources = colorSources[c] ?? 0;
    const pBy = (hypgeomAtLeast(1, N, sources, n) * 100).toFixed(0);
    const ok = sources >= 14;
    const color = ok ? 'var(--green)' : sources >= 10 ? 'var(--yellow)' : 'var(--red)';
    return `
      <div class="color-source-row">
        <span class="color-pip color-pip--${c}">${c}</span>
        <span style="font-size:12px">${sources} sources</span>
        <span class="muted" style="font-size:11px">P(≥1 by T${commanderCmc}): <span style="color:${color}">${pBy}%</span></span>
        ${sources < 14 ? `<span style="color:var(--yellow);font-size:10px">↑ Karsten recommends ≥14</span>` : ''}
      </div>`;
  }).join('');

  // Joint color probability line for multi-color commanders
  const jointColorLine = commanderColors.length >= 2
    ? `<div class="color-source-row" style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px">
        <span style="font-size:12px;font-weight:500">All ${commanderColors.length} colors</span>
        <span class="muted" style="font-size:11px">P(all by T${commanderCmc}): <span style="color:${pColorsExact >= 0.80 ? 'var(--green)' : pColorsExact >= 0.60 ? 'var(--yellow)' : 'var(--red)'}">${(pColorsExact * 100).toFixed(0)}%</span></span>
      </div>`
    : '';

  const tappedNote = tappedLandCount > 0
    ? `<p class="muted" style="font-size:10px;margin-top:4px">
        ${tappedLandCount} of ${landCount} lands enter tapped (modeled: play tapped early, untapped on curve turn).
       </p>`
    : '';

  // Bucket summary line for UI
  const bucketSummary = rampBuckets.length > 0
    ? rampBuckets.map(b => `${b.count}× CMC${b.cmc} ${b.isDork ? 'dork' : 'rock'}(${b.value.toFixed(1)}, ${(b.castability * 100).toFixed(0)}% castable)`).join(', ')
    : 'no ramp detected';

  const landLabel = tappedLandCount > 0
    ? `${untappedLandCount}+${tappedLandCount} tapped lands`
    : `${landCount} lands`;

  return `
    <span class="cast-threshold-badge cast-threshold-badge--${badgeClass}" style="margin-bottom:6px;display:inline-block">80% by ${badgeText}</span>
    <p class="muted" style="font-size:11px;margin-bottom:8px">
      ${escapeHtml(commander.name)} · CMC ${commanderCmc} ·
      ${landLabel} + ${rampCount} ramp
    </p>
    <p class="muted" style="font-size:10px;margin-bottom:8px">Ramp: ${escapeHtml(bucketSummary)}</p>
    <div class="mc-col-chart" style="height:80px">${bars}</div>
    ${tappedNote}
    ${commanderColors.length > 0 ? `<div style="margin-top:10px">${colorRows}${jointColorLine}</div>` : ''}`;
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

function buildCascadeTab() {
  return `
    <div class="section">
      <div class="section-label">Cascade / Discover</div>
      <p class="muted" style="font-size:12px">Cascade and Discover analysis coming soon.</p>
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
  const hitTargetPicker = lookAtN > 1 ? `
    <div style="margin-top:10px">
      <div class="input-label" style="margin-bottom:4px">Looking for (hits wanted)</div>
      <div class="hit-target-picker">
        ${Array.from({ length: lookAtN }, (_, i) => i + 1).map(n => `
          <button class="hit-target-btn ${n === hitTarget ? 'hit-target-btn--active' : ''}"
            onclick="window.__calc.setHitTarget('${def.id}', ${n})">${n}</button>`).join('')}
      </div>
    </div>` : '';

  // Criteria editor
  const criteriaHTML = buildEffectCriteriaEditor(deck, def, K);

  // Graphs (only if K > 0)
  const graphsHTML = criteria.length
    ? `<div id="calc-graphs-${def.id}" class="calc-graphs-row" style="margin-top:16px">
        ${buildNSensGraph(lookAtN, hitTarget, K)}
        ${buildSrcSensGraph(lookAtN, hitTarget, K)}
      </div>`
    : `<p class="muted" style="font-size:11px;margin-top:12px">Add criteria above to see probability graphs.</p>`;

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
        onclick="window.__calc.showCritSample('${def.id}', ${idx})">Sample</button>`
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
  if (!criteria.length) return 0;
  return deck.cards
    .filter(c => !c.isCommander)
    .filter(c => criteria.some(crit => {
      const ct = CRITERION_TYPES[crit.type];
      return ct ? ct.evaluate({ ...crit, count: 1 }, [c]) : false;
    }))
    .reduce((s, c) => s + c.quantity, 0);
}

/** Exported: used by app.js to build the hit-list modal */
export function matchingCardsForEffect(deck, criteria) {
  if (!criteria.length) return [];
  return deck.cards
    .filter(c => !c.isCommander)
    .filter(c => criteria.some(crit => {
      const ct = CRITERION_TYPES[crit.type];
      return ct ? ct.evaluate({ ...crit, count: 1 }, [c]) : false;
    }))
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
