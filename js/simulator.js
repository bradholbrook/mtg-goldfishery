/**
 * MTG Goldfish Simulator - Simulation Engine
 *
 * Phase 1: Opening hand simulation only.
 * Draws 7 cards from a shuffled 100-card deck, reports type breakdown.
 *
 * Future phases will extend this to turn-by-turn play.
 * The GameState object is already structured to support that.
 */

import { CARD_TYPES } from './types.js';

// ─── Deck Flattening ──────────────────────────────────────────────────────────

/**
 * Expand a DeckConfig into a flat array of individual card instances.
 * e.g. "4x Lightning Bolt" becomes 4 separate card objects.
 * Commander is included in the library (as in Commander rules).
 *
 * @param {DeckConfig} deck
 * @returns {Card[]} flat array of ~100 card objects
 */
export function flattenDeck(deck) {
  const flat = [];
  for (const card of deck.cards) {
    for (let i = 0; i < card.quantity; i++) {
      flat.push({ ...card, quantity: 1 });
    }
  }
  return flat;
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle — mutates and returns the array.
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

// ─── Single Game Simulation ───────────────────────────────────────────────────

/**
 * Simulate a single opening hand (no mulligan logic yet).
 * Draws 7 cards, counts types.
 *
 * @param {Card[]} flatDeck - Pre-flattened deck (will be shuffled fresh each game)
 * @returns {OpeningHandResult}
 */
function simulateOpeningHand(flatDeck) {
  // Copy and shuffle
  const library = shuffle([...flatDeck]);

  // Draw 7
  const hand = library.splice(0, 7);

  // Count card types in hand
  const typeCounts = {};
  for (const type of CARD_TYPES) {
    typeCounts[type] = 0;
  }

  for (const card of hand) {
    const primaryType = getPrimaryType(card.types);
    typeCounts[primaryType] = (typeCounts[primaryType] || 0) + 1;
  }

  return {
    hand,
    mulligans: 0,           // Future: London Mulligan logic
    typeCounts,
    // Future: keepReason, manaAvailable, scryfallEnrichedTypes
  };
}

// ─── Type Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a card's types array to a single display type.
 * Priority order handles multi-type cards (e.g. Artifact Creature → Creature).
 *
 * @param {string[]} types
 * @returns {string}
 */
export function getPrimaryType(types) {
  if (!types || types.length === 0) return 'Other';
  const typeSet = new Set(types.map(t => t.toLowerCase()));

  // Priority order for display (Creature > Artifact > Enchantment > ... > Land)
  const priority = [
    'creature', 'planeswalker', 'battle',
    'instant', 'sorcery',
    'artifact', 'enchantment',
    'land'
  ];

  for (const p of priority) {
    if (typeSet.has(p)) return p.charAt(0).toUpperCase() + p.slice(1);
  }
  return types[0] || 'Other';
}

// ─── Aggregate Stats ──────────────────────────────────────────────────────────

/**
 * Compute summary statistics from an array of opening hand results.
 *
 * @param {OpeningHandResult[]} hands
 * @param {DeckConfig} deck
 * @returns {Object} summary stats
 */
function computeSummary(hands, deck) {
  const n = hands.length;
  if (n === 0) return {};

  // Average type counts in opening hand
  const avgTypeCounts = {};
  for (const type of CARD_TYPES) {
    const total = hands.reduce((sum, h) => sum + (h.typeCounts[type] || 0), 0);
    avgTypeCounts[type] = parseFloat((total / n).toFixed(2));
  }

  // % of hands with at least 1 of each type
  const typeSeenPct = {};
  for (const type of CARD_TYPES) {
    const count = hands.filter(h => (h.typeCounts[type] || 0) >= 1).length;
    typeSeenPct[type] = parseFloat(((count / n) * 100).toFixed(1));
  }

  // % of hands with 2-4 lands (the "keepable land count" heuristic)
  const goodLandHandCount = hands.filter(h => {
    const lands = h.typeCounts['Land'] || 0;
    return lands >= 2 && lands <= 4;
  }).length;
  const goodLandHandPct = parseFloat(((goodLandHandCount / n) * 100).toFixed(1));

  // Deck composition (% by type)
  const flatDeck = flattenDeck(deck);
  const deckTypeCounts = {};
  for (const card of flatDeck) {
    const t = getPrimaryType(card.types);
    deckTypeCounts[t] = (deckTypeCounts[t] || 0) + 1;
  }
  const deckTypeDistribution = {};
  for (const [type, count] of Object.entries(deckTypeCounts)) {
    deckTypeDistribution[type] = parseFloat(((count / flatDeck.length) * 100).toFixed(1));
  }

  return {
    avgTypeCounts,
    typeSeenPct,
    goodLandHandPct,
    deckTypeDistribution,
    totalCardsInDeck: flatDeck.length,
    // Future: avgKillTurn, commanderOnCurvePct, keyCardSeenByTurnN
  };
}

// ─── Main Simulation Runner ───────────────────────────────────────────────────

/**
 * Run N opening hand simulations for a deck.
 *
 * @param {DeckConfig} deck
 * @param {number} [gameCount=1000]
 * @returns {SimulationResults}
 */
export function runSimulation(deck, gameCount = 1000) {
  const flatDeck = flattenDeck(deck);

  if (flatDeck.length < 7) {
    throw new Error('Deck must have at least 7 cards to simulate an opening hand.');
  }

  const hands = [];
  for (let i = 0; i < gameCount; i++) {
    hands.push(simulateOpeningHand(flatDeck));
  }

  const summary = computeSummary(hands, deck);

  return {
    deckId: deck.id,
    deckName: deck.name,
    gamesSimulated: gameCount,
    simulatedAt: new Date().toISOString(),
    hands,   // Full raw data — useful for future per-hand drill-down
    summary,
  };
}
