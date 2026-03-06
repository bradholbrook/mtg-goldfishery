/**
 * MTG Goldfish Simulator - Simulation Engine
 *
 * Two simulation modes:
 *   1. Opening-hand only (always available) — draws 7, counts types
 *   2. Turn-by-turn (requires Scryfall enrichment) — full game loop to turn N
 *
 * The turn loop runs: Untap → Upkeep → Draw → Mana → Land → Cast → Record.
 * 1,000 games × 10 turns must complete in < 1s.
 */

import { CARD_TYPES, DEFAULT_STRATEGY_CONFIG } from './types.js';
import { evaluateGoodHandDef } from './criteria.js';

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

function isLand(card) {
  if (card.isMDFC && card.faces) {
    return card.faces.some(f => f.types.some(t => t.toLowerCase() === 'land'));
  }
  return card.types?.some(t => t.toLowerCase() === 'land') ?? false;
}

/** True only for non-MDFC lands (pure lands that cannot also be cast as a spell). */
function isPureLand(card) {
  if (card.isMDFC) return false;
  return isLand(card);
}

/**
 * Return the non-land face of an MDFC (the face you cast as a spell).
 * Falls back to face[0] if all faces are lands (unusual but defensive).
 * @param {Card} card
 * @returns {CardFace|null}
 */
function getMDFCSpellFace(card) {
  if (!card.isMDFC || !card.faces) return null;
  return card.faces.find(f => !f.types.some(t => t.toLowerCase() === 'land')) ?? card.faces[0];
}

/**
 * Return the land face of an MDFC, or null if neither face is a land.
 * @param {Card} card
 * @returns {CardFace|null}
 */
function getMDFCLandFace(card) {
  if (!card.isMDFC || !card.faces) return null;
  return card.faces.find(f => f.types.some(t => t.toLowerCase() === 'land')) ?? null;
}

/**
 * True if the card can be cast as a spell (has a non-land face).
 * All non-land cards and MDFCs with at least one spell face return true.
 * Pure lands return false.
 * @param {Card} card
 * @returns {boolean}
 */
function isCastableAsSpell(card) {
  if (card.isMDFC && card.faces) {
    return card.faces.some(f => !f.types.some(t => t.toLowerCase() === 'land'));
  }
  return !isLand(card);
}

/**
 * Return all type bucket(s) this card should be counted toward in breakdowns.
 * MDFCs count toward each face type individually, plus the 'MDFC' sentinel.
 * Regular cards count toward their single primary type.
 * @param {Card} card
 * @returns {string[]}
 */
function countCardTypesForBreakdown(card) {
  if (card.isMDFC && card.faces) {
    return [...new Set([...card.faces.flatMap(f => f.types), 'MDFC'])];
  }
  // Multi-type single-faced cards (e.g. Enchantment Land, Artifact Creature)
  // count toward each of their types in breakdowns.
  const types = card.types ?? [];
  return types.length > 0 ? [...new Set(types)] : ['Other'];
}

// ─── Single Opening Hand ───────────────────────────────────────────────────────

/**
 * Simulate a single opening hand (no mulligan logic yet).
 * Draws 7 cards, counts types.
 *
 * @param {Card[]} flatDeck - Pre-flattened deck (will be shuffled fresh each game)
 * @returns {OpeningHandResult}
 */
function simulateOpeningHand(flatDeck) {
  const library = shuffle([...flatDeck]);
  const hand = library.splice(0, 7);

  const typeCounts = {};
  for (const type of CARD_TYPES) typeCounts[type] = 0;
  for (const card of hand) {
    for (const t of countCardTypesForBreakdown(card)) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
  }

  return { hand, mulligans: 0, typeCounts };
}

// ─── GameState Initialisation ─────────────────────────────────────────────────

/**
 * Build an initial GameState from a shuffled flat deck.
 * Draws the opening hand (7 cards) from the library.
 *
 * @param {Card[]} flatDeck          - already shuffled
 * @param {DiscardPriority[]} [discardPriorities=[]]
 * @param {Object} [xCosts={}]      - { [cardName]: number } user-set X values for X-cost spells
 * @returns {GameState}
 */
function initGameState(flatDeck, discardPriorities = [], xCosts = {}) {
  const library = [...flatDeck]; // already shuffled by caller
  const hand = library.splice(0, 7);

  return {
    library,
    hand,
    battlefield: [],
    graveyard: [],
    commandZone: [],
    turn: 0,
    landPlayedThisTurn: false,
    landDropsAvailable: 1,
    manaAvailable: 0,
    commanderCastCount: 0,
    currentTurnRecord: null,
    turnHistory: [],
    deckedOut: false,
    discardPriorities,
    xCosts,
  };
}

/**
 * Create a fresh TurnRecord for a given turn number.
 * @param {number} turn
 * @returns {TurnRecord}
 */
function newTurnRecord(turn) {
  return { turn, cardsDrawn: [], landsPlayed: [], spellsCast: [], manaSpent: 0, manaAvailable: 0, manaFromRocks: 0, effectsFired: [] };
}

/**
 * Draw one card into hand. Sets gs.deckedOut and returns false if library is empty.
 * All card draws must go through here so the loss condition is handled consistently.
 *
 * @param {GameState} gs
 * @param {string|null} effectLabel  - if provided, pushed to effectsFired (e.g. "The One Ring:tap:draw")
 * @returns {boolean} true if a card was drawn, false if the library was empty (deckedOut set)
 */
function drawCard(gs, effectLabel = null) {
  if (gs.library.length === 0) {
    gs.deckedOut = true;
    return false;
  }
  const drawn = gs.library.shift();
  gs.hand.push(drawn);
  gs.currentTurnRecord.cardsDrawn.push(drawn);
  if (effectLabel) gs.currentTurnRecord.effectsFired.push(effectLabel);
  return true;
}

// ─── Discard Selection ────────────────────────────────────────────────────────

/**
 * Choose the best card to discard from hand given an ordered priority list.
 * Rules are evaluated top-to-bottom; first matching rule wins.
 * Fallback (if no rule matches or list is empty): highest CMC card.
 *
 * @param {Card[]} hand
 * @param {DiscardPriority[]} [discardPriorities=[]]
 * @returns {Card|null}
 */
function selectCardToDiscard(hand, discardPriorities = []) {
  if (!hand.length) return null;

  for (const rule of discardPriorities) {
    const pool = rule.cardType === 'Any'
      ? [...hand]
      : hand.filter(c => c.types?.includes(rule.cardType));
    if (!pool.length) continue;

    if (rule.modifier === 'highest_cmc')
      return pool.reduce((a, b) => ((b.cmc ?? 0) > (a.cmc ?? 0) ? b : a));
    if (rule.modifier === 'lowest_cmc')
      return pool.reduce((a, b) => ((b.cmc ?? 0) < (a.cmc ?? 0) ? b : a));
    if (rule.modifier === 'any')
      return pool[0];
  }

  // Fallback: highest CMC
  return hand.reduce((a, b) => ((b.cmc ?? 0) > (a.cmc ?? 0) ? b : a), hand[0]);
}

// ─── Effect Resolution ────────────────────────────────────────────────────────

/**
 * Check whether a card being cast satisfies a tag's triggerFilter.
 * Returns true if there is no filter (filter is null/undefined).
 *
 * @param {Card} card            - the card being cast
 * @param {import('./types.js').TriggerFilter|null} triggerFilter
 * @returns {boolean}
 */
function matchesTriggerFilter(card, triggerFilter) {
  if (!triggerFilter) return true;
  const types = card.types ?? [];
  if (triggerFilter.isCommander && !card.isCommander) return false;
  if (triggerFilter.spellTypes && !triggerFilter.spellTypes.some(t => types.includes(t))) return false;
  if (triggerFilter.excludeTypes && triggerFilter.excludeTypes.some(t => types.includes(t))) return false;
  if (triggerFilter.minCmc != null && (card.cmc ?? 0) < triggerFilter.minCmc) return false;
  if (triggerFilter.maxCmc != null && (card.cmc ?? 0) > triggerFilter.maxCmc) return false;
  // deathSubject not evaluated — death is track_only; hook ready for future sim phase
  return true;
}

/**
 * Resolve all simulatable draw_n effects with a given timing.
 * Loot effects (subtype === 'loot') are handled separately by resolveLootEffects.
 *
 * @param {GameState} gs
 * @param {'etb'|'land_etb'|'upkeep'|'cast'|'passive'} timing
 * @param {Array<{card: Card}>} [subset]     - if null, resolves for full battlefield
 * @param {Card|null}           [castingCard] - the spell being cast; used for cast trigger filters
 * @returns {void}
 */
function resolveDrawEffects(gs, timing, subset = null, castingCard = null) {
  const permanents = subset ?? gs.battlefield;

  for (const { card } of permanents) {
    if (!card.effectTags) continue;
    for (const tag of card.effectTags) {
      if (tag.tier !== 'simulatable') continue;
      if (tag.category !== 'draw') continue;
      if (tag.subtype === 'loot') continue;   // handled by resolveLootEffects
      // Legacy 'passive' in old saves maps to 'on_resolution'
      const timingMatch = tag.timing === timing ||
        (timing === 'on_resolution' && tag.timing === 'passive');
      if (!timingMatch) continue;

      // Apply trigger filter for cast-timing and creature_etb effects.
      // For creature_etb, castingCard is the entering creature (checked for maxCmc etc.).
      if ((timing === 'cast' || timing === 'opponent_cast' || timing === 'creature_etb') && castingCard !== null) {
        if (!matchesTriggerFilter(castingCard, tag.triggerFilter ?? null)) continue;
      }

      // Skip auto tag if user has overridden the same (subtype, timing) pair
      if (tag.source === 'auto') {
        const hasUserOverride = card.effectTags.some(
          t => t.source === 'user' && t.subtype === tag.subtype && t.timing === tag.timing
        );
        if (hasUserOverride) continue;
      }

      // Determine draw count: EV override > X-cost lookup > detected value
      let drawCount;
      if (tag.source === 'user' && tag.expectedValue != null) {
        drawCount = Math.floor(tag.expectedValue);
      } else if (tag.condition === 'draw X') {
        drawCount = gs.xCosts?.[card.name] ?? 0;
      } else {
        drawCount = tag.value ?? 1;
      }
      for (let d = 0; d < drawCount; d++) {
        if (!drawCard(gs, `${card.name}:${timing}:draw`)) return;
      }
    }
  }
}

/**
 * Resolve all simulatable loot effects with a given timing.
 * Each loot: draw tag.value cards, then discard tag.discardCount cards.
 *
 * @param {GameState} gs
 * @param {'etb'|'land_etb'|'upkeep'|'cast'|'on_resolution'|'tap'} timing
 * @param {Array<{card: Card}>} [subset]     - if null, resolves for full battlefield
 * @param {Card|null}           [castingCard] - the spell being cast; used for cast trigger filters
 * @returns {void}
 */
function resolveLootEffects(gs, timing, subset = null, castingCard = null) {
  const permanents = subset ?? gs.battlefield;

  for (const { card } of permanents) {
    if (!card.effectTags) continue;
    for (const tag of card.effectTags) {
      if (tag.tier !== 'simulatable') continue;
      if (tag.subtype !== 'loot') continue;
      // Legacy 'passive' in old saves maps to 'on_resolution'
      const timingMatch = tag.timing === timing ||
        (timing === 'on_resolution' && tag.timing === 'passive');
      if (!timingMatch) continue;

      // Apply trigger filter for cast-timing and creature_etb effects.
      // For creature_etb, castingCard is the entering creature (checked for maxCmc etc.).
      if ((timing === 'cast' || timing === 'opponent_cast' || timing === 'creature_etb') && castingCard !== null) {
        if (!matchesTriggerFilter(castingCard, tag.triggerFilter ?? null)) continue;
      }

      if (tag.source === 'auto') {
        const hasUserOverride = card.effectTags.some(
          t => t.source === 'user' && t.subtype === tag.subtype && t.timing === tag.timing
        );
        if (hasUserOverride) continue;
      }

      const drawCount = (tag.source === 'user' && tag.expectedValue != null)
        ? Math.floor(tag.expectedValue)
        : (tag.value ?? 1);
      const discardCount = tag.discardCount ?? 1;

      // Draw first
      for (let d = 0; d < drawCount; d++) {
        if (!drawCard(gs, `${card.name}:${timing}:loot:draw`)) return;
      }
      if (gs.deckedOut) return;

      // Then discard using priority selection
      for (let d = 0; d < discardCount && gs.hand.length > 0; d++) {
        const toDiscard = selectCardToDiscard(gs.hand, gs.discardPriorities);
        if (!toDiscard) break;
        const idx = gs.hand.indexOf(toDiscard);
        gs.hand.splice(idx, 1);
        gs.graveyard.push(toDiscard);
        gs.currentTurnRecord.effectsFired.push(`${card.name}:${timing}:loot:discard`);
      }
    }
  }
}

// ─── Tap Draw Resolution ──────────────────────────────────────────────────────

/**
 * For each untapped permanent with a simulatable tap-draw effect, tap it and
 * draw the appropriate number of cards.
 *
 * Handles two subtypes:
 *   'draw_scaling_tap' — increment the card's named counter, then draw that many
 *                        (e.g. The One Ring: turn 1 = 1 draw, turn 2 = 2 draws…)
 *   'draw_n'           — draw tag.value cards unconditionally
 *
 * Called once per turn, before the cast loop, so drawn cards are available
 * for casting decisions in the same turn.
 *
 * @param {GameState} gs
 */
function resolveTapDraws(gs) {
  let tappedAny = false;
  for (const bf of gs.battlefield) {
    if (bf.tapped) continue;
    if (!bf.card.effectTags) continue;

    // Summoning sickness: creatures that entered this turn can't use tap abilities.
    // Non-creature permanents (artifacts, enchantments, etc.) have no such restriction.
    const isCreature = bf.card.types?.some(t => t.toLowerCase() === 'creature');
    if (isCreature && bf.turnEntered === gs.turn) continue;

    let shouldTap = false;

    for (const tag of bf.card.effectTags) {
      if (tag.tier !== 'simulatable') continue;
      if (tag.timing !== 'tap') continue;

      // Skip auto tag if user has overridden the same (subtype, timing) pair
      if (tag.category !== 'draw') continue; // mana_rock and other ramp tags are handled in Mana phase

      if (tag.source === 'auto') {
        const hasUserOverride = bf.card.effectTags.some(
          t => t.source === 'user' && t.subtype === tag.subtype && t.timing === tag.timing
        );
        if (hasUserOverride) continue;
      }

      if (tag.subtype === 'draw_scaling_tap') {
        const counterKey = tag.counterType || 'scaling';
        if (!bf.counters) bf.counters = {};
        bf.counters[counterKey] = (bf.counters[counterKey] || 0) + 1;
        const drawCount = bf.counters[counterKey];
        for (let d = 0; d < drawCount; d++) {
          if (!drawCard(gs, `${bf.card.name}:tap:draw`)) return tappedAny;
        }
      } else if (tag.subtype === 'loot') {
        const drawCount = tag.value ?? 1;
        const discardCount = tag.discardCount ?? 1;
        for (let d = 0; d < drawCount; d++) {
          if (!drawCard(gs, `${bf.card.name}:tap:loot:draw`)) return tappedAny;
        }
        for (let d = 0; d < discardCount && gs.hand.length > 0; d++) {
          const toDiscard = selectCardToDiscard(gs.hand, gs.discardPriorities);
          if (!toDiscard) break;
          const idx = gs.hand.indexOf(toDiscard);
          gs.hand.splice(idx, 1);
          gs.graveyard.push(toDiscard);
          gs.currentTurnRecord.effectsFired.push(`${bf.card.name}:tap:loot:discard`);
        }
      } else {
        // draw_n: user tags with expectedValue drive simulation for conditional effects
        const drawCount = (tag.source === 'user' && tag.expectedValue != null)
          ? Math.floor(tag.expectedValue)
          : (tag.value ?? 1);
        for (let d = 0; d < drawCount; d++) {
          if (!drawCard(gs, `${bf.card.name}:tap:draw`)) return tappedAny;
        }
      }
      shouldTap = true;
    }

    if (shouldTap) { bf.tapped = true; tappedAny = true; }
  }
  return tappedAny;
}

// ─── Opponent Phase ───────────────────────────────────────────────────────────

/**
 * Simulate opponent actions between our turns — draws and spell casts.
 * Uses mock "spell" objects so existing matchesTriggerFilter logic handles filtering.
 *
 * Mock cards have only the `types` array needed for spell-type filter matching.
 * Creature + noncreature are tracked separately; any-spell triggers fire both.
 *
 * @param {GameState} gs
 * @param {StrategyConfig} strategy
 */
const _MOCK_OPPONENT_CREATURE    = { name: '', types: ['Creature'],  isCommander: false };
const _MOCK_OPPONENT_NONCREATURE = { name: '', types: ['Sorcery'],   isCommander: false };

function resolveOpponentPhase(gs, strategy) {
  // Baseline: each opponent draws 1 card/turn. Extra draws are on top of that.
  // Legacy saves may use opponentDrawsPerRound (treated as extra draws for compat).
  const numOpponents    = strategy.numOpponents ?? 3;
  const extraDraws      = strategy.opponentExtraDrawsPerRound ?? strategy.opponentDrawsPerRound ?? 0;
  const drawReps        = numOpponents + extraDraws;
  const creatureReps    = strategy.opponentCreatureSpellsPerRound    ?? 0;
  const noncreatureReps = strategy.opponentNoncreatureSpellsPerRound ?? 0;

  if (drawReps + creatureReps + noncreatureReps === 0) return;

  for (let i = 0; i < drawReps; i++) {
    resolveDrawEffects(gs, 'opponent_draw');
    resolveLootEffects(gs, 'opponent_draw');
    if (gs.deckedOut) return;
  }
  for (let i = 0; i < creatureReps; i++) {
    resolveDrawEffects(gs, 'opponent_cast', null, _MOCK_OPPONENT_CREATURE);
    resolveLootEffects(gs, 'opponent_cast', null, _MOCK_OPPONENT_CREATURE);
    if (gs.deckedOut) return;
  }
  for (let i = 0; i < noncreatureReps; i++) {
    resolveDrawEffects(gs, 'opponent_cast', null, _MOCK_OPPONENT_NONCREATURE);
    resolveLootEffects(gs, 'opponent_cast', null, _MOCK_OPPONENT_NONCREATURE);
    if (gs.deckedOut) return;
  }
}

// ─── Greedy Cast Scoring ──────────────────────────────────────────────────────

/**
 * Determine a card's effective casting cost (includes commander tax).
 * For MDFCs, uses the spell face CMC (front non-land face).
 * @param {Card} card
 * @param {GameState} gs
 * @returns {number}
 */
function effectiveCost(card, gs) {
  const spellFace = getMDFCSpellFace(card);
  const baseCmc = spellFace ? (spellFace.cmc ?? card.cmc ?? 0) : (card.cmc ?? 0);
  // Add user-configured X value for spells with {X} in their mana cost
  const manaCost = spellFace?.manaCost ?? card.manaCost ?? '';
  const xVal = manaCost.includes('{X}') ? (gs.xCosts?.[card.name] ?? 0) : 0;
  const base = baseCmc + xVal;
  if (card.isCommander) return base + gs.commanderCastCount * 2;
  return base;
}

/**
 * Score a hand card for greedy casting priority.
 * Lower score = higher priority (cast first).
 *
 * @param {Card} card
 * @param {StrategyConfig} strategy
 * @returns {number} sort key (lower = higher priority)
 */
function castScore(card, strategy) {
  // Determine which category this card falls under for priority ordering.
  // Cards with draw effectTags rank as 'draw', ramp as 'ramp', etc.
  // Otherwise fall back to primary type → priority list position.
  const effectCategories = new Set((card.effectTags || []).map(t => t.category));
  let categoryIndex = strategy.castPriority.length; // default: lowest priority

  for (let i = 0; i < strategy.castPriority.length; i++) {
    const p = strategy.castPriority[i];
    if (effectCategories.has(p)) { categoryIndex = i; break; }
  }

  // If no effect category matched, try primary type (use spell face for MDFCs)
  if (categoryIndex === strategy.castPriority.length) {
    const typesForScore = getMDFCSpellFace(card)?.types ?? card.types;
    const primaryType = getPrimaryType(typesForScore).toLowerCase();
    const typeIdx = strategy.castPriority.indexOf(primaryType);
    if (typeIdx >= 0) categoryIndex = typeIdx;
  }

  // Tiebreak by CMC (lower CMC = lower secondary sort key when preferLowCMC)
  // Use spell face CMC for MDFCs
  const spellFaceForScore = getMDFCSpellFace(card);
  const spellCmc = spellFaceForScore ? (spellFaceForScore.cmc ?? card.cmc ?? 0) : (card.cmc ?? 0);
  const cmcTiebreak = strategy.preferLowCMC ? spellCmc : -spellCmc;

  // Combine into a single comparable number:
  // primary sort = categoryIndex * 1000, secondary = cmcTiebreak
  return categoryIndex * 1000 + cmcTiebreak;
}

// ─── Turn Loop ────────────────────────────────────────────────────────────────

/**
 * Run a single game of turn-by-turn simulation.
 *
 * @param {Card[]} flatDeck   - will be shuffled fresh
 * @param {StrategyConfig} strategy
 * @returns {{ turnHistory: TurnRecord[], deckedOut: boolean, openingHand: Card[] }}
 */
function simulateGame(flatDeck, strategy) {
  const library = shuffle([...flatDeck]);
  const gs = initGameState(library, strategy.discardPriorities ?? [], strategy.xCosts ?? {});
  const openingHand = [...gs.hand];

  for (let turn = 1; turn <= strategy.maxTurns; turn++) {
    gs.turn = turn;
    gs.currentTurnRecord = newTurnRecord(turn);

    // ── Untap ──────────────────────────────────────────────────────────────
    gs.landPlayedThisTurn = false;
    gs.landDropsAvailable = 1;
    for (const bf of gs.battlefield) bf.tapped = false;

    // ── Upkeep ─────────────────────────────────────────────────────────────
    resolveDrawEffects(gs, 'upkeep');
    resolveLootEffects(gs, 'upkeep');
    if (gs.deckedOut) break;

    // ── Opponent Phase ──────────────────────────────────────────────────────
    // Simulate opponent draws/casts from their turns since we last untapped.
    resolveOpponentPhase(gs, strategy);
    if (gs.deckedOut) break;

    // ── Draw ───────────────────────────────────────────────────────────────
    if (turn === 1) {
      // In Commander, going first still draws (no skip-draw rule in goldfishing)
    }
    // "At the beginning of your draw step" triggers fire before the normal draw.
    resolveDrawEffects(gs, 'draw_step');
    resolveLootEffects(gs, 'draw_step');
    if (gs.deckedOut) break;
    if (!drawCard(gs)) break;

    // ── Mana ───────────────────────────────────────────────────────────────
    // Count mana from all untapped lands, then tap simulatable mana rocks.
    // Lands are not individually marked tapped — they're tracked as a pool.
    // Mana rocks are marked tapped so they don't also fire tap-draw abilities.
    const landManaThisTurn = gs.battlefield.filter(bf => isLand(bf.card)).length;
    let totalMana = landManaThisTurn;
    let rockManaThisTurn = 0;
    for (const bf of gs.battlefield) {
      if (bf.tapped) continue;
      const isCreatureCard = bf.card.types?.some(t => t.toLowerCase() === 'creature');
      if (isCreatureCard && bf.turnEntered === turn) continue; // summoning sickness
      const rockTag = bf.card.effectTags?.find(
        t => t.tier === 'simulatable' && t.category === 'ramp' && t.subtype === 'mana_rock' && t.timing === 'tap'
      );
      if (rockTag) {
        bf.tapped = true;
        // Lands that also have a mana_rock tag (e.g. Command Tower, Exotic Orchard)
        // are already counted in the land total above — don't add mana twice.
        if (!isLand(bf.card)) {
          const manaAdded = rockTag.value ?? 1;
          totalMana += manaAdded;
          rockManaThisTurn += manaAdded;
        }
      }
    }
    gs.manaAvailable = totalMana;
    gs.currentTurnRecord.manaFromRocks = rockManaThisTurn;

    // ── Land ───────────────────────────────────────────────────────────────
    // Prefer pure lands. If none, choose the MDFC land-back whose spell face
    // has the worst cast score (highest score number = lowest priority). This
    // keeps higher-priority MDFC spell faces in hand when multiple land-backs
    // are available — e.g. keep Creature CMC 2, sacrifice Sorcery CMC 4.
    let landIdx = gs.hand.findIndex(c => isPureLand(c));
    if (landIdx < 0) {
      let bestMdfcIdx = -1;
      let bestMdfcScore = -Infinity;
      gs.hand.forEach((c, idx) => {
        if (!c.isMDFC || !getMDFCLandFace(c)) return;
        const score = castScore(c, strategy);
        if (score > bestMdfcScore) { bestMdfcScore = score; bestMdfcIdx = idx; }
      });
      landIdx = bestMdfcIdx;
    }
    if (landIdx >= 0 && !gs.landPlayedThisTurn) {
      const land = gs.hand.splice(landIdx, 1)[0];
      gs.battlefield.push({ card: land, tapped: false, turnEntered: turn, counters: {} });
      gs.landPlayedThisTurn = true;
      gs.manaAvailable += 1;
      gs.currentTurnRecord.landsPlayed.push(land);
      // Fire land ETB triggers (e.g. Tatyova, Benthic Druid)
      resolveDrawEffects(gs, 'land_etb');
      resolveLootEffects(gs, 'land_etb');
    }

    // Record mana AFTER land play so the land drop this turn is included
    gs.currentTurnRecord.manaAvailable = gs.manaAvailable;

    // ── Main Phase ─────────────────────────────────────────────────────────
    // Interleaved tap-draw and casting: activate tap abilities, cast spells,
    // then repeat in case new permanents entered (with tap abilities) or new
    // cards were drawn (enabling additional casts). Models MTG's first main phase.
    // Non-creature permanents can tap on the turn they enter (no summoning sickness).
    let mainPhaseProgress = true;
    while (mainPhaseProgress) {
      mainPhaseProgress = false;

      // ── Tap Draw ─────────────────────────────────────────────────────────
      // Activate all available tap-draw abilities. Respects summoning sickness:
      // creatures that entered this turn are skipped; artifacts/enchantments etc. are not.
      if (resolveTapDraws(gs)) mainPhaseProgress = true;
      if (gs.deckedOut) break;

      // ── Cast pass ────────────────────────────────────────────────────────
      // No mana guard — 0-cost spells are valid. Cost check is in the filter below.
      let castedThisPass = true;
      while (castedThisPass) {
        castedThisPass = false;

        // Find all castable cards in hand (non-land or MDFC spell face), sorted by priority.
        // Additional-cost loot spells (e.g. Tormenting Voice) require at least one other
        // card in hand to discard as an additional cost.
        const castable = gs.hand
          .filter(c => {
            if (!isCastableAsSpell(c)) return false;
            if (effectiveCost(c, gs) > gs.manaAvailable) return false;
            const addlCost = c.effectTags?.find(
              t => t.subtype === 'loot' && t.isAdditionalCost && t.tier === 'simulatable'
            );
            if (addlCost && gs.hand.length - 1 < (addlCost.discardCount ?? 1)) return false;
            return true;
          })
          .sort((a, b) => castScore(a, strategy) - castScore(b, strategy));

        if (castable.length === 0) break;

        const toCast = castable[0];
        const cost = effectiveCost(toCast, gs);

        // Remove from hand
        const handIdx = gs.hand.indexOf(toCast);
        gs.hand.splice(handIdx, 1);

        // Enter battlefield (if permanent) or graveyard.
        // For MDFCs being cast as a spell, use the spell face's types to determine
        // permanence — a Sorcery // Land cast as a sorcery goes to the graveyard.
        const castFaceTypes = toCast.isMDFC
          ? (getMDFCSpellFace(toCast)?.types ?? toCast.types)
          : toCast.types;
        const isPermanent = castFaceTypes?.some(t =>
          ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'].includes(t.toLowerCase())
        );

        if (toCast.isCommander) gs.commanderCastCount++;

        // Fire cast-timing draw/loot effects from battlefield permanents
        // (e.g. "Whenever you cast a creature spell, draw a card").
        // Fires before resolution so battlefield reflects state at cast time.
        // Pass toCast so triggerFilters are evaluated against the spell being cast.
        resolveDrawEffects(gs, 'cast', null, toCast);
        resolveLootEffects(gs, 'cast', null, toCast);
        if (gs.deckedOut) break;

        if (isPermanent) {
          const bfEntry = { card: toCast, tapped: false, turnEntered: turn, counters: {} };
          gs.battlefield.push(bfEntry);
          // Fire ETB effects — only newly entered card
          resolveDrawEffects(gs, 'etb', [bfEntry]);
          resolveLootEffects(gs, 'etb', [bfEntry]);
          // Fire creature_etb watchers (e.g. Soul of the Harvest, Guardian Project).
          // Exclude the entering creature itself from the watcher set — handles "another
          // creature" semantics without needing to parse "another" from oracle text.
          // Pass toCast as the entering creature so TriggerFilter (maxCmc, nontoken) applies.
          if (castFaceTypes?.some(t => t.toLowerCase() === 'creature')) {
            const watcherSubset = gs.battlefield.filter(bf => bf.card !== toCast);
            resolveDrawEffects(gs, 'creature_etb', watcherSubset, toCast);
            resolveLootEffects(gs, 'creature_etb', watcherSubset, toCast);
          }
        } else {
          // Resolve the spell's own draw/loot effects on resolution
          resolveDrawEffects(gs, 'on_resolution', [{ card: toCast }]);
          resolveLootEffects(gs, 'on_resolution', [{ card: toCast }]);
          gs.graveyard.push(toCast);
        }

        gs.manaAvailable -= cost;
        gs.currentTurnRecord.manaSpent += cost;
        gs.currentTurnRecord.spellsCast.push(toCast);
        castedThisPass = true;
        mainPhaseProgress = true; // new permanent may have tap abilities; loop back
        if (gs.deckedOut) break;
      }
    }

    // ── End Step ───────────────────────────────────────────────────────────
    // Cards drawn at end step are available next turn (conservative).
    // e.g. Jin-Gitaxias ("at the beginning of your end step, draw seven cards")
    resolveDrawEffects(gs, 'end_step');
    resolveLootEffects(gs, 'end_step');
    if (gs.deckedOut) break;

    // ── Record ─────────────────────────────────────────────────────────────
    gs.turnHistory.push({ ...gs.currentTurnRecord });
  }

  return { turnHistory: gs.turnHistory, deckedOut: gs.deckedOut, openingHand };
}

// ─── Aggregate Stats (opening hand) ───────────────────────────────────────────

function computeOpeningHandSummary(hands, deck, goodHandDefs = []) {
  const n = hands.length;
  if (n === 0) return {};

  const avgTypeCounts = {};
  for (const type of CARD_TYPES) {
    const total = hands.reduce((sum, h) => sum + (h.typeCounts[type] || 0), 0);
    avgTypeCounts[type] = parseFloat((total / n).toFixed(2));
  }

  const typeSeenPct = {};
  for (const type of CARD_TYPES) {
    const count = hands.filter(h => (h.typeCounts[type] || 0) >= 1).length;
    typeSeenPct[type] = parseFloat(((count / n) * 100).toFixed(1));
  }

  const goodLandHandCount = hands.filter(h => {
    const lands = h.typeCounts['Land'] || 0;
    return lands >= 3;
  }).length;
  const goodLandHandPct = parseFloat(((goodLandHandCount / n) * 100).toFixed(1));

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

  const goodHandDefPcts = {};
  for (const def of goodHandDefs) {
    const count = hands.filter(h => evaluateGoodHandDef(def, h.hand)).length;
    goodHandDefPcts[def.id] = parseFloat(((count / n) * 100).toFixed(1));
  }

  const goodHandAnyCount = goodHandDefs.length > 0
    ? hands.filter(h => goodHandDefs.some(def => evaluateGoodHandDef(def, h.hand))).length
    : null;
  const goodHandAnyPct = goodHandAnyCount !== null
    ? parseFloat(((goodHandAnyCount / n) * 100).toFixed(1))
    : null;

  return {
    avgTypeCounts,
    typeSeenPct,
    goodLandHandPct,
    deckTypeDistribution,
    totalCardsInDeck: flatDeck.length,
    goodHandDefPcts,
    goodHandAnyPct,
  };
}

// ─── Aggregate Stats (turn-by-turn) ──────────────────────────────────────────

/**
 * Compute turn-by-turn stats from an array of full game histories.
 *
 * @param {Array<{turnHistory: TurnRecord[], openingHand: Card[]}>} games
 * @param {number} maxTurns
 * @returns {Object}
 */
function computeTurnBySummary(games, maxTurns) {
  const n = games.length;
  if (n === 0) return {};

  // Cumulative cards drawn by turn N (7 from opening hand + each draw step + effects)
  const avgCardsDrawnByTurn = {};
  const SNAPSHOT_TURNS = Array.from({ length: maxTurns }, (_, i) => i + 1);

  for (const snapTurn of SNAPSHOT_TURNS) {
    let total = 0;
    for (const { turnHistory, openingHand } of games) {
      // Start with 7 (opening hand)
      let cumDraws = openingHand.length;
      for (const record of turnHistory) {
        if (record.turn > snapTurn) break;
        cumDraws += record.cardsDrawn.length;
      }
      total += cumDraws;
    }
    avgCardsDrawnByTurn[snapTurn] = parseFloat((total / n).toFixed(2));
  }

  // Effect draws: cards drawn via ETB/upkeep effects (not the normal draw step)
  let totalEffectDraws = 0;
  let gamesWithDrawEffect = 0;
  const drawSourceTotals = {}; // cardName → total draws across all games

  for (const { turnHistory } of games) {
    let effectDrawsThisGame = 0;
    const sourcesThisGame = new Set();

    for (const record of turnHistory) {
      for (const fired of record.effectsFired) {
        // Formats:
        //   draw_n:  "CardName:timing:draw"
        //   loot:    "CardName:timing:loot:draw"  or  "CardName:timing:loot:discard"
        // Check the last segment to catch both draw_n and loot draws.
        const parts = fired.split(':');
        const cardName = parts[0];
        if (parts[parts.length - 1] === 'draw') {
          effectDrawsThisGame++;
          sourcesThisGame.add(cardName);
          drawSourceTotals[cardName] = (drawSourceTotals[cardName] || 0) + 1;
        }
      }
    }

    totalEffectDraws += effectDrawsThisGame;
    if (sourcesThisGame.size > 0) gamesWithDrawEffect++;
  }

  const avgEffectDrawsPerGame = parseFloat((totalEffectDraws / n).toFixed(2));
  const pctGamesWithDrawEffect = parseFloat(((gamesWithDrawEffect / n) * 100).toFixed(1));

  const drawEffectSourceBreakdown = {};
  for (const [name, total] of Object.entries(drawSourceTotals)) {
    drawEffectSourceBreakdown[name] = parseFloat((total / n).toFixed(2));
  }

  // Mana available by turn (land + rocks combined)
  const avgManaByTurn = {};
  for (const snapTurn of SNAPSHOT_TURNS) {
    let total = 0;
    for (const { turnHistory } of games) {
      const record = turnHistory.find(r => r.turn === snapTurn);
      total += record?.manaAvailable ?? 0;
    }
    avgManaByTurn[snapTurn] = parseFloat((total / n).toFixed(2));
  }

  // Mana from rocks per game (total over all turns)
  let totalRockMana = 0;
  for (const { turnHistory } of games) {
    for (const record of turnHistory) {
      totalRockMana += record.manaFromRocks ?? 0;
    }
  }
  const avgManaFromRocksPerGame = parseFloat((totalRockMana / n).toFixed(2));

  // Missed land drops (turns where no land was played)
  let totalMissedLands = 0;
  // Ramp plays (non-land, non-MDFC cards with a mana_rock tag cast)
  let totalRocksPlayed = 0;
  for (const { turnHistory } of games) {
    for (const record of turnHistory) {
      if (record.landsPlayed.length === 0) totalMissedLands++;
      totalRocksPlayed += record.spellsCast.filter(c =>
        !c.isMDFC &&
        !c.types?.some(t => t.toLowerCase() === 'land') &&
        c.effectTags?.some(t => t.category === 'ramp' && t.subtype === 'mana_rock')
      ).length;
    }
  }
  const avgMissedLandDrops = parseFloat((totalMissedLands / n).toFixed(2));
  const avgRocksPlayedPerGame = parseFloat((totalRocksPlayed / n).toFixed(2));

  return {
    avgCardsDrawnByTurn,
    avgEffectDrawsPerGame,
    pctGamesWithDrawEffect,
    drawEffectSourceBreakdown,
    avgManaByTurn,
    avgManaFromRocksPerGame,
    avgMissedLandDrops,
    avgRocksPlayedPerGame,
  };
}

// ─── Main Simulation Runner ───────────────────────────────────────────────────

/**
 * Run N simulations for a deck.
 * If the deck is enriched, runs full turn-by-turn games and includes
 * both opening-hand and turn-by-turn stats.
 * If unenriched, falls back to opening-hand-only simulation.
 *
 * @param {DeckConfig} deck
 * @param {number} [gameCount=1000]
 * @param {GoodHandDef[]} [goodHandDefs=[]]
 * @returns {SimulationResults}
 */
export function runSimulation(deck, gameCount = 1000, goodHandDefs = []) {
  const flatDeck = flattenDeck(deck);

  if (flatDeck.length < 7) {
    throw new Error('Deck must have at least 7 cards to simulate an opening hand.');
  }

  const isEnriched = deck.enriched === true;
  const strategy = {
    ...DEFAULT_STRATEGY_CONFIG,
    ...(deck.strategyConfig || {}),
    discardPriorities: deck.discardPriorities || [],
    xCosts: deck.xCosts || {},
  };

  let hands = [];
  let games = [];

  if (isEnriched) {
    // Full turn-by-turn simulation: opening hands derive from game histories
    for (let i = 0; i < gameCount; i++) {
      const game = simulateGame(flatDeck, strategy);
      games.push(game);

      // Build opening hand result for backward-compatible hand stats
      const typeCounts = {};
      for (const type of CARD_TYPES) typeCounts[type] = 0;
      for (const card of game.openingHand) {
        for (const t of countCardTypesForBreakdown(card)) {
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
      }
      hands.push({ hand: game.openingHand, mulligans: 0, typeCounts });
    }
  } else {
    // Opening-hand only
    for (let i = 0; i < gameCount; i++) {
      hands.push(simulateOpeningHand(flatDeck));
    }
  }

  const summary = {
    ...computeOpeningHandSummary(hands, deck, goodHandDefs),
    ...(isEnriched ? computeTurnBySummary(games, strategy.maxTurns) : {}),
  };

  // Collect up to 3 sample good hands (hands that match at least one def, or any hand if no defs)
  const sampleGoodHands = [];
  for (const h of hands) {
    if (sampleGoodHands.length >= 3) break;
    const isGood = goodHandDefs.length === 0
      || goodHandDefs.some(def => evaluateGoodHandDef(def, h.hand));
    if (isGood) sampleGoodHands.push(h.hand);
  }

  return {
    deckId: deck.id,
    deckName: deck.name,
    gamesSimulated: gameCount,
    simulatedAt: new Date().toISOString(),
    enriched: isEnriched,
    hands,   // Full raw data — useful for per-hand drill-down
    sampleGoodHands,
    summary,
  };
}
