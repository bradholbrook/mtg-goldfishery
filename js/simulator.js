/**
 * mullstat — Simulation Engine
 *
 * London Mulligan simulator: hand size sequence 7 → 7 → 6 → 5 → 4.
 * First mulligan is free (redraw 7, keep all 7).
 * Subsequent mulligans redraw 7 then bottom (depth − 1) cards.
 *
 * Also tracks commander castability: first turn enough mana is available
 * for the commander's CMC, accounting for lands + mana rocks + dorks.
 */

import { CARD_TYPES, CANONICAL_CATEGORIES } from './types.js';
import { evaluateGoodHandDef } from './criteria.js';

// ─── Deck Flattening ──────────────────────────────────────────────────────────

/**
 * Expand a DeckConfig into a flat array of individual card instances.
 * e.g. "4x Lightning Bolt" becomes 4 separate card objects.
 *
 * @param {DeckConfig} deck
 * @returns {Card[]}
 */
export function flattenDeck(deck) {
  const flat = [];
  for (const card of deck.cards) {
    if (card.isCommander) continue; // commanders start in the command zone, not the library
    for (let i = 0; i < card.quantity; i++) {
      flat.push({ ...card, quantity: 1 });
    }
  }
  return flat;
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates in-place shuffle. Mutates and returns the array.
 * @param {any[]} arr
 * @returns {any[]}
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Type / Land Helpers ──────────────────────────────────────────────────────

/**
 * Resolve a card's types array to a single display type.
 * @param {string[]} types
 * @returns {string}
 */
export function getPrimaryType(types) {
  if (!types || types.length === 0) return 'Other';
  const typeSet = new Set(types.map(t => t.toLowerCase()));
  for (const p of ['creature','planeswalker','battle','instant','sorcery','artifact','enchantment','land']) {
    if (typeSet.has(p)) return p.charAt(0).toUpperCase() + p.slice(1);
  }
  return types[0] || 'Other';
}

function isLand(card) {
  if (card.isMDFC && card.faces) {
    return card.faces.some(f => f.types?.some(t => t.toLowerCase() === 'land'));
  }
  return card.types?.some(t => t.toLowerCase() === 'land') ?? false;
}

function isPureLand(card) {
  if (card.isMDFC) return false;
  return isLand(card);
}

/**
 * Return the non-land face of an MDFC (the spell face).
 * @param {Card} card
 * @returns {CardFace|null}
 */
export function getMDFCSpellFace(card) {
  if (!card.isMDFC || !card.faces) return null;
  return card.faces.find(f => !f.types?.some(t => t.toLowerCase() === 'land')) ?? card.faces[0];
}

/**
 * Return the land face of an MDFC, or null.
 * @param {Card} card
 * @returns {CardFace|null}
 */
export function getMDFCLandFace(card) {
  if (!card.isMDFC || !card.faces) return null;
  return card.faces.find(f => f.types?.some(t => t.toLowerCase() === 'land')) ?? null;
}

/**
 * Return all type buckets this card should count toward in breakdowns.
 * @param {Card} card
 * @returns {string[]}
 */
function countCardTypesForBreakdown(card) {
  if (card.isMDFC && card.faces) {
    return [...new Set([...card.faces.flatMap(f => f.types ?? []), 'MDFC'])];
  }
  const types = card.types ?? [];
  return types.length > 0 ? [...new Set(types)] : ['Other'];
}

// ─── Bottom Selection ─────────────────────────────────────────────────────────

/**
 * Select n cards from hand to put back (bottom of library).
 * Applies user-configured bottom priorities, falling back to highest CMC non-land.
 *
 * @param {Card[]} hand       7-card hand
 * @param {number} n          number to bottom
 * @param {DiscardPriority[]} priorities  ordered rules
 * @returns {Card[]}          cards to keep (hand.length - n)
 */
function selectCardsToBottom(hand, n, priorities = []) {
  if (n <= 0) return hand;
  if (n >= hand.length) return [];

  let remaining = [...hand];
  const bottomed = [];

  // Apply priority rules in order
  for (const rule of priorities) {
    if (bottomed.length >= n) break;
    const { modifier, cardType, cardTypes } = rule;
    // Support both new cardTypes[] and legacy cardType string
    const typeFilter = Array.isArray(cardTypes)
      ? cardTypes
      : (cardType && cardType !== 'Any' ? [cardType] : []);
    let candidates = remaining.filter(c => {
      if (typeFilter.length > 0) {
        return Array.isArray(c.types) && c.types.some(t => typeFilter.includes(t));
      }
      return true;
    });

    if (candidates.length === 0) continue;

    // Sort candidates by modifier
    if (modifier === 'highest_cmc') {
      candidates.sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0));
    } else if (modifier === 'lowest_cmc') {
      candidates.sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0));
    }

    const pick = candidates[0];
    bottomed.push(pick);
    remaining = remaining.filter(c => c !== pick);
  }

  // Default: bottom highest-CMC non-land cards first
  if (bottomed.length < n) {
    const nonLands = remaining.filter(c => !isPureLand(c));
    const lands = remaining.filter(c => isPureLand(c));
    const pool = nonLands.length > 0 ? nonLands : lands;
    pool.sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0));

    while (bottomed.length < n && pool.length > 0) {
      const pick = pool.shift();
      bottomed.push(pick);
      remaining = remaining.filter(c => c !== pick);
    }
  }

  return remaining.slice(0, hand.length - n);
}

// ─── Commander Castability ─────────────────────────────────────────────────────

/**
 * Parse commander CMC and required colors from a manaCost string like "{2}{G}{G}".
 * Returns { cmc, colors } where colors is an array of W/U/B/R/G pips needed.
 * @param {Card|null} commanderCard
 * @returns {{ cmc: number, colors: string[] }}
 */
function parseCommanderCost(commanderCard) {
  if (!commanderCard) return { cmc: 0, colors: [] };
  const cmc = commanderCard.cmc ?? 0;
  const manaCost = commanderCard.manaCost ?? '';
  const colorPips = [];
  for (const match of manaCost.matchAll(/\{([WUBRG])\}/g)) {
    colorPips.push(match[1]);
  }
  return { cmc, colors: [...new Set(colorPips)] };
}

/**
 * Simulate mana availability per turn from a kept hand + subsequent draws.
 * Returns the first turn (1-indexed) on which the commander can be cast,
 * or null if not within 8 turns.
 *
 * Model:
 *   - 1 land drop per turn (lands available immediately unless ETB-tapped)
 *   - Mana rocks: artifact + Ramp tag → available turn after played (summoning sickness model)
 *     (simplified: rocks played T1 tap T2; rocks played T2 tap T3; etc.)
 *   - Mana dorks: similar summoning sickness delay
 *   - Land ramp sorceries (Inst/Sorcery + Ramp): puts an extra land on battlefield
 *
 * Color tracking: a land contributes to commander colors if producedMana
 * includes the required color, or is a basic of that color.
 *
 * @param {Card[]} library    library after hand is drawn (shuffle order)
 * @param {Card[]} startHand  kept opening hand
 * @param {{ cmc: number, colors: string[] }} commanderCost
 * @returns {number|null}     first castable turn (1-8) or null
 */
function simulateCastability(library, startHand, commanderCost) {
  const { cmc, colors: requiredColors } = commanderCost;
  if (cmc === 0) return 1; // 0-mana commander (e.g. companions edge cases)

  const MAX_TURNS = 8;
  const hand = [...startHand];
  const lib = [...library];

  // Mana sources currently available (total + per-color)
  let totalMana = 0;
  const availableColors = new Set();
  // Mana rocks/dorks queued: will become available next turn
  const pendingMana = []; // { mana, colors[] }

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Draw a card (turn 1 = opening hand already drawn)
    if (turn > 1 && lib.length > 0) {
      hand.push(lib.shift());
    }

    // Activate pending rocks/dorks from last turn
    for (const p of pendingMana) {
      totalMana += p.mana;
      for (const c of p.colors) availableColors.add(c);
    }
    pendingMana.length = 0;

    // Play a land (first untapped land available)
    const landIdx = hand.findIndex(c => isPureLand(c) || (c.isMDFC && getMDFCLandFace(c)));
    if (landIdx >= 0) {
      const land = hand.splice(landIdx, 1)[0];
      const landFace = land.isMDFC ? getMDFCLandFace(land) : land;
      const produced = landFace?.producedMana ?? land.producedMana ?? [];
      // ETB-tapped: skip if flagged (simplified: check etbTapped flag)
      const etbTapped = land.isMDFC
        ? (getMDFCLandFace(land)?.oracleText ?? '').toLowerCase().includes('enters tapped')
        : (land.etbTapped ?? false);
      if (!etbTapped) {
        totalMana += 1;
        for (const c of produced) {
          if ('WUBRG'.includes(c)) availableColors.add(c);
        }
        // If producedMana is missing but it's a basic land, infer from subtype
        if (!produced.length) {
          const subtypes = (land.isMDFC ? getMDFCLandFace(land)?.subtypes : land.subtypes) ?? [];
          const colorMap = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
          for (const sub of subtypes) {
            if (colorMap[sub]) availableColors.add(colorMap[sub]);
          }
        }
      }
    }

    // Play mana rocks and dorks from hand (queue for next turn)
    const rocksAndDorks = hand.filter(c => {
      if (!c.categories?.includes('Ramp')) return false;
      const types = c.types ?? [];
      return types.includes('Artifact') || types.includes('Creature');
    });
    const played = [];
    for (const rock of rocksAndDorks) {
      // Can we afford to play it this turn? (simplified: costs 1-3 mana, use total available)
      const cost = rock.cmc ?? 2;
      if (cost <= totalMana) {
        totalMana -= cost;
        played.push(rock);
        // Rock contributes mana starting NEXT turn (summoning sickness)
        const rockMana = rock.effectTags?.find(t => t.subtype === 'mana_rock' || t.subtype === 'mana_dork')?.value ?? 1;
        const rockColors = rock.producedMana ?? [];
        pendingMana.push({ mana: rockMana, colors: rockColors });
      }
    }
    for (const rock of played) {
      hand.splice(hand.indexOf(rock), 1);
    }

    // Check if commander is castable
    const colorsOk = requiredColors.every(c => availableColors.has(c));
    if (totalMana >= cmc && (requiredColors.length === 0 || colorsOk)) {
      return turn;
    }
  }

  return null; // not castable within MAX_TURNS
}

// ─── Single Mulligan Game ─────────────────────────────────────────────────────

/**
 * Simulate one complete mulligan sequence for a Commander game.
 * Hand sizes: depth 0→7, depth 1→7 (free), depth 2→6, depth 3→5, depth 4→4,
 *             depth 5→3, depth 6→2 (forced).
 *
 * @param {Card[]} flatDeck         pre-flattened deck (will be re-shuffled each attempt)
 * @param {GoodHandDef[]} defs       keep conditions (empty = always keep)
 * @param {DiscardPriority[]} priorities  bottom selection priority rules
 * @param {{ cmc: number, colors: string[] }|null} commanderCost
 * @returns {{ hand, mulligans, handSize, typeCounts, categoryCounts, castableTurn }}
 */
function simulateMulliganGame(flatDeck, defs, priorities, commanderCost) {
  const MAX_DEPTH = 7; // London Mulligan: can go all the way to 1 card
  let hand = [];
  let library = [];
  let depth = 0;

  for (depth = 0; depth <= MAX_DEPTH; depth++) {
    // Reshuffle everything and redraw 7
    library = shuffle([...flatDeck]);
    hand = library.splice(0, 7);

    // Bottom cards for paid mulligans (depth >= 2: put back depth-1 cards)
    if (depth >= 2) {
      hand = selectCardsToBottom(hand, depth - 1, priorities);
    }

    // Always keep at max depth (desperation keep)
    if (depth >= MAX_DEPTH) break;

    // Keep if no conditions defined, or any condition satisfied
    const keep = defs.length === 0 || defs.some(def => evaluateGoodHandDef(def, hand));
    if (keep) break;
  }

  // Count card types in final hand
  const typeCounts = {};
  for (const type of CARD_TYPES) typeCounts[type] = 0;
  for (const card of hand) {
    for (const t of countCardTypesForBreakdown(card)) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
  }

  // Count categories in final hand
  const categoryCounts = {};
  for (const cat of CANONICAL_CATEGORIES) categoryCounts[cat] = 0;
  for (const card of hand) {
    for (const cat of (card.categories ?? [])) {
      if (categoryCounts[cat] !== undefined) categoryCounts[cat]++;
    }
  }

  // Count moxTags in final hand
  const moxTagCounts = {};
  for (const card of hand) {
    for (const tag of (card.moxTags ?? [])) {
      moxTagCounts[tag] = (moxTagCounts[tag] || 0) + 1;
    }
  }

  // Commander castability simulation
  const castableTurn = commanderCost
    ? simulateCastability(library, hand, commanderCost)
    : null;

  return {
    hand,
    mulligans: depth,
    handSize: hand.length,
    typeCounts,
    categoryCounts,
    moxTagCounts,
    castableTurn,
  };
}

// ─── Aggregate Stats ──────────────────────────────────────────────────────────

function computeSummary(games, deck, goodHandDefs) {
  const n = games.length;
  if (n === 0) return {};

  // Average type counts across all kept hands
  const avgTypeCounts = {};
  for (const type of CARD_TYPES) {
    const total = games.reduce((s, g) => s + (g.typeCounts[type] || 0), 0);
    avgTypeCounts[type] = parseFloat((total / n).toFixed(2));
  }

  // % of hands containing each type
  const typeSeenPct = {};
  for (const type of CARD_TYPES) {
    const count = games.filter(g => (g.typeCounts[type] || 0) >= 1).length;
    typeSeenPct[type] = parseFloat(((count / n) * 100).toFixed(1));
  }

  // % hands with ≥3 lands (legacy stat for decks without defs)
  const goodLandHandPct = parseFloat(
    ((games.filter(g => (g.typeCounts['Land'] || 0) >= 3).length / n) * 100).toFixed(1)
  );

  // Deck type distribution
  const flatDeck = flattenDeck(deck);
  const deckTypeCounts = {};
  for (const card of flatDeck) {
    for (const t of countCardTypesForBreakdown(card)) {
      deckTypeCounts[t] = (deckTypeCounts[t] || 0) + 1;
    }
  }
  const deckTypeDistribution = {};
  for (const [type, count] of Object.entries(deckTypeCounts)) {
    deckTypeDistribution[type] = parseFloat(((count / flatDeck.length) * 100).toFixed(1));
  }

  // Good hand def percentages
  const goodHandDefPcts = {};
  for (const def of goodHandDefs) {
    const count = games.filter(g => evaluateGoodHandDef(def, g.hand)).length;
    goodHandDefPcts[def.id] = parseFloat(((count / n) * 100).toFixed(1));
  }

  const goodHandAnyCount = goodHandDefs.length > 0
    ? games.filter(g => goodHandDefs.some(def => evaluateGoodHandDef(def, g.hand))).length
    : null;
  const goodHandAnyPct = goodHandAnyCount !== null
    ? parseFloat(((goodHandAnyCount / n) * 100).toFixed(1))
    : null;

  // Mulligan depth distribution: % of games kept at each depth (0–7)
  const keepRateByDepth = {};
  for (let d = 0; d <= 7; d++) {
    const kept = games.filter(g => g.mulligans === d).length;
    keepRateByDepth[d] = parseFloat(((kept / n) * 100).toFixed(1));
  }

  // Average final hand size
  const avgHandSize = parseFloat(
    (games.reduce((s, g) => s + g.handSize, 0) / n).toFixed(2)
  );

  // Greediness score: % of games where a mulligan was taken.
  // High = deck/player is demanding (mulligans a lot); low = keeps most hands.
  const keptBeforeMax = games.filter(g => g.mulligans < 6).length;
  const keepRate = keptBeforeMax / n;
  const greediness = parseFloat(((1 - keepRate) * 100).toFixed(1));

  // Category coverage in kept hands
  const avgCategoryCounts = {};
  for (const cat of CANONICAL_CATEGORIES) {
    const total = games.reduce((s, g) => s + (g.categoryCounts?.[cat] || 0), 0);
    avgCategoryCounts[cat] = parseFloat((total / n).toFixed(2));
  }

  // MoxTag averages across kept hands
  const allMoxTags = [...new Set(games.flatMap(g => Object.keys(g.moxTagCounts ?? {})))];
  const avgMoxTagCounts = {};
  for (const tag of allMoxTags) {
    const total = games.reduce((s, g) => s + (g.moxTagCounts?.[tag] || 0), 0);
    avgMoxTagCounts[tag] = parseFloat((total / n).toFixed(2));
  }

  // Average type counts in kept hands (from hand cards directly)
  const typeTotals = {};
  for (const g of games) {
    for (const c of g.hand) {
      for (const t of (c.types || [])) {
        typeTotals[t] = (typeTotals[t] || 0) + 1;
      }
    }
  }
  const avgTypeCountsInHand = {};
  for (const t in typeTotals) {
    avgTypeCountsInHand[t] = parseFloat((typeTotals[t] / n).toFixed(2));
  }

  // Commander castability: P(castable by turn N) for N=1..8
  const castabilityByTurn = {};
  const gamesWithCast = games.filter(g => g.castableTurn !== null && g.castableTurn !== undefined);
  if (gamesWithCast.length > 0) {
    for (let t = 1; t <= 8; t++) {
      const count = gamesWithCast.filter(g => g.castableTurn !== null && g.castableTurn <= t).length;
      castabilityByTurn[t] = parseFloat(((count / n) * 100).toFixed(1));
    }
  }

  const avgCastableTurn = gamesWithCast.length > 0
    ? parseFloat((gamesWithCast.reduce((s, g) => s + g.castableTurn, 0) / gamesWithCast.length).toFixed(1))
    : null;

  return {
    avgTypeCounts,
    typeSeenPct,
    goodLandHandPct,
    deckTypeDistribution,
    totalCardsInDeck: flatDeck.length,
    goodHandDefPcts,
    goodHandAnyPct,
    keepRateByDepth,
    avgHandSize,
    greediness,
    avgCategoryCounts,
    avgMoxTagCounts,
    avgTypeCountsInHand,
    castabilityByTurn,
    avgCastableTurn,
  };
}

// ─── Main Simulation Runner ───────────────────────────────────────────────────

/**
 * Run N mulligan simulations for a deck using the Commander London Mulligan.
 *
 * @param {DeckConfig} deck
 * @param {number}     [gameCount=10000]
 * @param {GoodHandDef[]} [goodHandDefs=[]]
 * @returns {SimulationResults}
 */
export function runSimulation(deck, gameCount = 100000, goodHandDefs = []) {
  const flatDeck = flattenDeck(deck);
  if (flatDeck.length < 7) {
    throw new Error('Deck must have at least 7 cards to simulate an opening hand.');
  }

  const bottomPriorities = deck.discardPriorities || [];

  // Find commander card for castability tracking
  const commanderCard = deck.cards.find(c => c.isCommander) ?? null;
  const commanderCost = commanderCard ? parseCommanderCost(commanderCard) : null;

  const games = [];
  for (let i = 0; i < gameCount; i++) {
    games.push(simulateMulliganGame(flatDeck, goodHandDefs, bottomPriorities, commanderCost));
  }

  const summary = computeSummary(games, deck, goodHandDefs);

  // Collect up to 3 sample kept hands that match any good hand def
  const sampleGoodHands = [];
  for (const g of games) {
    if (sampleGoodHands.length >= 3) break;
    const isGood = goodHandDefs.length === 0
      || goodHandDefs.some(def => evaluateGoodHandDef(def, g.hand));
    if (isGood) sampleGoodHands.push(g.hand);
  }

  return {
    deckId: deck.id,
    deckName: deck.name,
    gamesSimulated: gameCount,
    simulatedAt: new Date().toISOString(),
    hands: games,
    sampleGoodHands,
    summary,
  };
}
