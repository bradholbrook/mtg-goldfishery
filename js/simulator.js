/**
 * MTG Goldfish Simulator - Simulation Engine
 *
 * Two simulation modes:
 *   1. Opening-hand only (always available) — draws 7, counts types
 *   2. Turn-by-turn (requires Scryfall enrichment) — full game loop to turn N
 *
 * The turn loop runs: Untap → Upkeep → Draw → Land → Main Phase (tap mana → tap-draw → cast, repeat) → End Step → Record.
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
    cardsDrawnThisTurn: 0,
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
 * Draw `count` cards into hand, applying any active draw_replacement multipliers
 * from battlefield permanents (e.g. Alhammarret's Archive).
 *
 * Multiple replacements multiply together (MTG rule 614.5: each applies once).
 * The `exceptFirst` flag skips the multiplier when this is the first draw requested
 * this turn (cardsDrawnThisTurn === 0 at call time).
 *
 * @param {GameState} gs
 * @param {number}    [count=1]
 * @param {string|null} [effectLabel]
 * @returns {boolean} false if library ran out (gs.deckedOut set)
 */
function drawCards(gs, count = 1, effectLabel = null) {
  let multiplier = 1;
  for (const { card } of gs.battlefield) {
    for (const tag of (card.effectTags ?? [])) {
      if (tag.tier !== 'simulatable') continue;
      if (tag.subtype !== 'draw_replacement') continue;
      if (tag.exceptFirst && gs.cardsDrawnThisTurn === 0) continue;
      multiplier *= (tag.multiplier ?? 2);
    }
  }

  const adjustedCount = count * multiplier;

  for (let i = 0; i < adjustedCount; i++) {
    if (gs.library.length === 0) { gs.deckedOut = true; return false; }
    const drawn = gs.library.shift();
    gs.hand.push(drawn);
    gs.currentTurnRecord.cardsDrawn.push(drawn);
    if (effectLabel) gs.currentTurnRecord.effectsFired.push(effectLabel);
  }

  gs.cardsDrawnThisTurn += count;  // original requested count, not amplified
  return true;
}

/**
 * Convert a fractional expected count to an integer via probabilistic rounding.
 * 1.7 → always draws 1, 70% chance of drawing 2 (expected = 1.7).
 * Integers pass through unchanged. Used so users can set conditional expected
 * draws per trigger (e.g. Rhystic Study = 0.3 expected draws per opponent cast).
 * @param {number} value
 * @returns {number}
 */
function fractionalToCount(value) {
  if (value <= 0) return 0;
  const whole = Math.floor(value);
  const remainder = value - whole;
  return whole + (remainder > 0 && Math.random() < remainder ? 1 : 0);
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

      const drawCount = tag.condition === 'draw X'
        ? (gs.xCosts?.[card.name] ?? 0)
        : fractionalToCount(tag.value ?? 1);
      if (!drawCards(gs, drawCount, `${card.name}:${timing}:draw`)) return;
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

      const drawCount    = fractionalToCount(tag.value ?? 1);
      const discardCount = fractionalToCount(tag.discardCount ?? 1);

      // Draw first
      if (!drawCards(gs, drawCount, `${card.name}:${timing}:loot:draw`)) return;

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

// ─── Tutor Resolution ─────────────────────────────────────────────────────────

/**
 * Check if a library card satisfies a FetchConstraint.
 * @param {Card} card
 * @param {import('./types.js').FetchConstraint|null} constraint
 * @returns {boolean}
 */
function matchesFetchConstraint(card, constraint) {
  if (!constraint) return false;
  if (constraint.any) return true;

  const types        = card.types      ?? [];
  const supertypes   = card.supertypes ?? [];
  const cardSubtypes = card.subtypes   ?? [];

  if (constraint.nonland && types.some(t => t.toLowerCase() === 'land')) return false;
  if (constraint.supertype && !supertypes.includes(constraint.supertype)) return false;

  if (constraint.type) {
    if (constraint.type === 'InstantOrSorcery') {
      if (!types.includes('Instant') && !types.includes('Sorcery')) return false;
    } else if (constraint.type === 'ArtifactOrEnchantment') {
      if (!types.includes('Artifact') && !types.includes('Enchantment')) return false;
    } else if (constraint.type === 'Permanent') {
      const permTypes = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];
      if (!types.some(t => permTypes.includes(t))) return false;
    } else {
      if (!types.includes(constraint.type)) return false;
    }
  }

  // subtypes: OR semantics — card must match at least one.
  // Also handles legacy saves where the field was named 'subtype' (string).
  const constraintSubtypes = constraint.subtypes
    ?? (constraint.subtype ? [constraint.subtype] : null);
  if (constraintSubtypes && !constraintSubtypes.some(sub => cardSubtypes.includes(sub))) return false;

  return true;
}

/**
 * Check if a library card matches the target criteria of a TutorPriorityRule.
 * @param {Card} card
 * @param {import('./types.js').TutorPriorityRule} rule
 * @returns {boolean}
 */
function matchesTutorPriorityTarget(card, rule) {
  switch (rule.target) {
    case 'named':
      return card.name === rule.cardName;
    case 'type':
      return (card.types ?? []).includes(rule.cardType);
    case 'subtype':
      return (card.subtypes ?? []).includes(rule.cardSubtype);
    case 'effect_category':
      return (card.effectTags ?? []).some(t => t.category === rule.effectCategory);
    default:
      return false;
  }
}

/**
 * Find the best library card to fetch for a given tutor tag + priority rules.
 * Rules are evaluated top-to-bottom; first rule with a matching card in the
 * library (that also passes the tutor's FetchConstraint) wins.
 * Returns null if no rule has a valid target.
 *
 * @param {import('./types.js').EffectTag} tutorTag
 * @param {import('./types.js').TutorPriorityRule[]} rules
 * @param {GameState} gs
 * @returns {Card|null}
 */
function findTutorTarget(tutorTag, rules, gs) {
  const validLibrary = gs.library.filter(c => matchesFetchConstraint(c, tutorTag.fetchType));
  if (validLibrary.length === 0) return null;

  for (const rule of rules) {
    // Named card rules always skip if the card is already in hand.
    // Other rule types respect the explicit requireNotInHand flag.
    const skipIfInHand = rule.target === 'named' || rule.requireNotInHand;
    if (skipIfInHand) {
      const alreadyInHand = gs.hand.some(c => matchesTutorPriorityTarget(c, rule));
      if (alreadyInHand) continue;
    }
    const target = validLibrary.find(c => matchesTutorPriorityTarget(c, rule));
    if (target) return target;
  }

  return null;
}

/**
 * Check if a tutor card can be cast (has a valid target in the library).
 * Tutors with no matching rules or no valid target are excluded from the castable set.
 *
 * @param {Card} tutorCard
 * @param {import('./types.js').TutorPriorityRule[]} rules
 * @param {GameState} gs
 * @returns {boolean}
 */
function canResolveTutor(tutorCard, rules, gs) {
  const tutorTag = tutorCard.effectTags?.find(t => t.category === 'tutor' && t.tier === 'simulatable');
  if (!tutorTag) return false;
  return findTutorTarget(tutorTag, rules, gs) !== null;
}

/**
 * Execute a tutor: remove the target from the library (shuffle rest), then
 * put it into hand, onto the battlefield (with ETB), or on top of library.
 *
 * @param {Card} tutorCard
 * @param {import('./types.js').EffectTag} tutorTag
 * @param {import('./types.js').TutorPriorityRule[]} rules
 * @param {GameState} gs
 */
function resolveTutor(tutorCard, tutorTag, rules, gs) {
  const target = findTutorTarget(tutorTag, rules, gs);
  if (!target) return;

  const idx = gs.library.indexOf(target);
  if (idx < 0) return;
  gs.library.splice(idx, 1);
  shuffle(gs.library); // standard MTG: shuffle after searching

  if (tutorTag.putWhere === 'battlefield') {
    const bfEntry = { card: target, tapped: false, turnEntered: gs.turn, counters: {} };
    gs.battlefield.push(bfEntry);
    resolveDrawEffects(gs, 'etb', [bfEntry]);
    resolveLootEffects(gs, 'etb', [bfEntry]);
  } else if (tutorTag.putWhere === 'top_of_library') {
    gs.library.unshift(target);
  } else {
    gs.hand.push(target);
  }

  gs.currentTurnRecord.effectsFired.push(`${tutorCard.name}:tutor:${target.name}`);
}

/**
 * Resolve all simulatable tutor effects with a given timing from a card subset.
 *
 * @param {GameState} gs
 * @param {string} timing
 * @param {Array<{card: Card}>} [subset]
 * @param {import('./types.js').TutorPriorityRule[]} tutorPriorityRules
 */
function resolveTutorEffects(gs, timing, subset, tutorPriorityRules) {
  const permanents = subset ?? gs.battlefield;
  for (const { card } of permanents) {
    if (!card.effectTags) continue;
    for (const tag of card.effectTags) {
      if (tag.tier !== 'simulatable') continue;
      if (tag.category !== 'tutor') continue;
      const timingMatch = tag.timing === timing ||
        (timing === 'on_resolution' && tag.timing === 'passive');
      if (!timingMatch) continue;

      if (tag.source === 'auto') {
        const hasUserOverride = card.effectTags.some(
          t => t.source === 'user' && t.category === 'tutor' && t.timing === tag.timing
        );
        if (hasUserOverride) continue;
      }

      resolveTutor(card, tag, tutorPriorityRules, gs);
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
      if (tag.category !== 'draw') continue; // mana_rock and other ramp tags are handled by tapAvailableMana

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
        if (!drawCards(gs, drawCount, `${bf.card.name}:tap:draw`)) return tappedAny;
      } else if (tag.subtype === 'loot') {
        const drawCount = tag.value ?? 1;
        const discardCount = tag.discardCount ?? 1;
        if (!drawCards(gs, drawCount, `${bf.card.name}:tap:loot:draw`)) return tappedAny;
        for (let d = 0; d < discardCount && gs.hand.length > 0; d++) {
          const toDiscard = selectCardToDiscard(gs.hand, gs.discardPriorities);
          if (!toDiscard) break;
          const idx = gs.hand.indexOf(toDiscard);
          gs.hand.splice(idx, 1);
          gs.graveyard.push(toDiscard);
          gs.currentTurnRecord.effectsFired.push(`${bf.card.name}:tap:loot:discard`);
        }
      } else {
        // draw_n: fractional value = expected draws per trigger (e.g. 0.7 = conditional)
        if (!drawCards(gs, fractionalToCount(tag.value ?? 1), `${bf.card.name}:tap:draw`)) return tappedAny;
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
 * Check whether a card matches a CastPriorityRule.
 * For MDFCs, type/subtype checks use the spell face.
 *
 * @param {Card} card
 * @param {import('./types.js').CastPriorityRule} rule
 * @returns {boolean}
 */
function matchesCastPriorityRule(card, rule) {
  const spellFace = getMDFCSpellFace(card);
  switch (rule.match) {
    case 'named':
      return card.name === rule.cardName;
    case 'type': {
      const types = spellFace?.types ?? card.types ?? [];
      return types.includes(rule.cardType);
    }
    case 'subtype': {
      const subtypes = spellFace?.subtypes ?? card.subtypes ?? [];
      return subtypes.includes(rule.cardSubtype);
    }
    case 'effect_category':
      return (card.effectTags || []).some(t => t.category === rule.effectCategory);
    default:
      return false;
  }
}

/**
 * Score a hand card for greedy casting priority.
 * Lower score = higher priority (cast first).
 *
 * Cast priority rules are checked first (Phase 1: match only, no conditions).
 * Rule at index i of N total rules → score = (i - N) * 10000, which always
 * beats any category-based score. Unmatched cards fall through to the existing
 * category + CMC tiebreak.
 *
 * @param {Card} card
 * @param {StrategyConfig} strategy
 * @returns {number} sort key (lower = higher priority)
 */
function castScore(card, strategy) {
  // Check cast priority rules first — first matching rule wins.
  const rules = strategy.castPriorityRules ?? [];
  const N = rules.length;
  for (let i = 0; i < N; i++) {
    if (matchesCastPriorityRule(card, rules[i])) {
      return (i - N) * 10000;
    }
  }

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

// ─── Mana Tapping ─────────────────────────────────────────────────────────────

/**
 * Tap all currently untapped mana sources on the battlefield and add their
 * mana to gs.manaAvailable. Called at the top of each main-phase loop
 * iteration so that permanents entering mid-turn (mana rocks, ETB-untapped
 * lands) contribute mana in the same turn.
 *
 * Land mana value: checks for a simulatable mana_rock tag first (handles
 * lands like Ancient Tomb that tap for 2); falls back to 1.
 * Non-land mana rocks: uses the mana_rock tag value directly.
 *
 * Summoning sickness applies to creatures only.
 *
 * @param {GameState} gs
 * @param {number} turn  - current turn number (for summoning sickness check)
 */
function tapAvailableMana(gs, turn) {
  for (const bf of gs.battlefield) {
    if (bf.tapped) continue;
    const isCreature = bf.card.types?.some(t => t.toLowerCase() === 'creature');
    if (isCreature && bf.turnEntered === turn) continue; // summoning sickness
    const card = bf.card;
    if (isLand(card)) {
      // Lands that produce more than 1 mana (e.g. Ancient Tomb) carry a mana_rock tag.
      const landRockTag = card.effectTags?.find(
        t => t.tier === 'simulatable' && t.subtype === 'mana_rock' && t.timing === 'tap'
      );
      bf.tapped = true;
      const manaAdded = landRockTag?.value ?? 1;
      gs.manaAvailable += manaAdded;
      gs.currentTurnRecord.manaAvailable += manaAdded;
    } else {
      const rockTag = card.effectTags?.find(
        t => t.tier === 'simulatable' && t.category === 'ramp' && t.subtype === 'mana_rock' && t.timing === 'tap'
      );
      if (rockTag) {
        bf.tapped = true;
        const manaAdded = rockTag.value ?? 1;
        gs.manaAvailable += manaAdded;
        gs.currentTurnRecord.manaAvailable += manaAdded;
        gs.currentTurnRecord.manaFromRocks += manaAdded;
      }
    }
  }
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
    gs.cardsDrawnThisTurn = 0;
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
    if (!drawCards(gs)) break;

    // ── Land ───────────────────────────────────────────────────────────────
    // Prefer pure lands. If none, choose the MDFC land-back whose spell face
    // has the worst cast score (highest score number = lowest priority). This
    // keeps higher-priority MDFC spell faces in hand when multiple land-backs
    // are available — e.g. keep Creature CMC 2, sacrifice Sorcery CMC 4.
    //
    // ETB-tapped lands enter with tapped:true so tapAvailableMana skips them
    // this turn; they untap normally at the start of the next turn.
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
      gs.battlefield.push({ card: land, tapped: land.etbTapped ?? false, turnEntered: turn, counters: {} });
      gs.landPlayedThisTurn = true;
      gs.currentTurnRecord.landsPlayed.push(land);
      // Fire land ETB triggers (e.g. Tatyova, Benthic Druid)
      resolveDrawEffects(gs, 'land_etb');
      resolveLootEffects(gs, 'land_etb');
    }

    // ── Main Phase ─────────────────────────────────────────────────────────
    // Each iteration: tap available mana sources → tap-draw → cast spells.
    // Restarting the loop handles permanents that entered this turn (mana rocks,
    // lands) which can be tapped for mana or abilities in the same turn.
    // ETB-tapped lands are already marked tapped above; they contribute 0 mana
    // until they untap next turn.
    let mainPhaseProgress = true;
    while (mainPhaseProgress) {
      mainPhaseProgress = false;

      // ── Tap Mana ─────────────────────────────────────────────────────────
      // Tap all untapped lands and mana rocks. Lands use their mana_rock tag
      // value if present (e.g. Ancient Tomb → 2), otherwise 1.
      // Running this each iteration lets newly cast mana rocks contribute mana
      // on the same turn they enter.
      tapAvailableMana(gs, turn);

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
            // Tutors: only castable when a valid target exists in the library
            const hasTutor = c.effectTags?.some(t => t.category === 'tutor' && t.tier === 'simulatable');
            if (hasTutor && !canResolveTutor(c, strategy.tutorPriorityRules, gs)) return false;
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
          resolveTutorEffects(gs, 'etb', [bfEntry], strategy.tutorPriorityRules);
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
          // Resolve the spell's own draw/loot/tutor effects on resolution
          resolveDrawEffects(gs, 'on_resolution', [{ card: toCast }]);
          resolveLootEffects(gs, 'on_resolution', [{ card: toCast }]);
          resolveTutorEffects(gs, 'on_resolution', [{ card: toCast }], strategy.tutorPriorityRules);
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
    discardPriorities:  deck.discardPriorities  || [],
    xCosts:             deck.xCosts             || {},
    castPriorityRules:  deck.castPriorityRules  || [],
    tutorPriorityRules: deck.tutorPriorityRules || [],
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
