/**
 * Simulator tests — flattenDeck, getPrimaryType, and runSimulation stats.
 *
 * EXTENDING:
 *   • Add a new test() block below any existing group.
 *   • Use makeDeck() + makeCard() from helpers.js to build custom scenarios.
 *   • Use gameCount: 1 for structural/shape tests; gameCount: 10000 for
 *     statistical assertions (keeps variance below ±0.1 cards per hand).
 *   • Access results via result.summary.avgTypeCounts, result.summary.goodLandHandPct, etc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flattenDeck, getPrimaryType, runSimulation } from '../js/simulator.js';
import { makeCard, makeDeck, makeGoodHandDef } from './helpers.js';
import {
  ALL_LANDS_DECK,
  ALL_CREATURES_DECK,
  ALL_MDFC_DECK,
  ETB_DRAW_DECK,
  UPKEEP_DRAW_DECK,
  LOOT_DECK,
} from './fixtures.js';

// ── flattenDeck ───────────────────────────────────────────────────────────────

describe('flattenDeck', () => {

  it('expands quantity into individual card instances', () => {
    const deck = makeDeck([makeCard({ name: 'Lightning Bolt', quantity: 4 })]);
    const flat = flattenDeck(deck);
    assert.equal(flat.length, 4);
    assert.ok(flat.every(c => c.name === 'Lightning Bolt'));
  });

  it('each expanded card has quantity 1', () => {
    const deck = makeDeck([makeCard({ quantity: 3 })]);
    const flat = flattenDeck(deck);
    assert.ok(flat.every(c => c.quantity === 1));
  });

  it('handles mixed quantities', () => {
    const deck = makeDeck([
      makeCard({ name: 'A', quantity: 2 }),
      makeCard({ name: 'B', quantity: 3 }),
    ]);
    assert.equal(flattenDeck(deck).length, 5);
  });

  it('returns 60 cards for a 60-card all-lands deck', () => {
    assert.equal(flattenDeck(ALL_LANDS_DECK).length, 60);
  });

});

// ── getPrimaryType ────────────────────────────────────────────────────────────

describe('getPrimaryType', () => {

  it('returns Other for empty array', () => {
    assert.equal(getPrimaryType([]), 'Other');
  });

  it('returns Other for null/undefined', () => {
    assert.equal(getPrimaryType(null), 'Other');
    assert.equal(getPrimaryType(undefined), 'Other');
  });

  it('returns the single type when only one is present', () => {
    assert.equal(getPrimaryType(['Land']), 'Land');
    assert.equal(getPrimaryType(['Artifact']), 'Artifact');
  });

  it('prefers Creature over Land (multi-type card)', () => {
    assert.equal(getPrimaryType(['Land', 'Creature']), 'Creature');
  });

  it('prefers Creature over Artifact', () => {
    assert.equal(getPrimaryType(['Artifact', 'Creature']), 'Creature');
  });

  it('prefers Instant over Sorcery', () => {
    assert.equal(getPrimaryType(['Sorcery', 'Instant']), 'Instant');
  });

  it('is case-insensitive', () => {
    assert.equal(getPrimaryType(['land', 'creature']), 'Creature');
  });

  it('prefers Enchantment over Land (Enchantment Land priority)', () => {
    assert.equal(getPrimaryType(['Land', 'Enchantment']), 'Enchantment');
  });

  it('MDFC sentinel not in priority list — falls through to first type', () => {
    // ['Sorcery', 'Land', 'MDFC'] → Sorcery wins via priority
    assert.equal(getPrimaryType(['Sorcery', 'Land', 'MDFC']), 'Sorcery');
  });

  it('unknown-only type falls through to first element', () => {
    assert.equal(getPrimaryType(['MDFC']), 'MDFC');
  });

});

// ── runSimulation — error handling ────────────────────────────────────────────

describe('runSimulation — error handling', () => {

  it('throws when deck has fewer than 7 cards', () => {
    const tinyDeck = makeDeck([makeCard({ quantity: 6 })]);
    assert.throws(
      () => runSimulation(tinyDeck, 1),
      /at least 7 cards/,
    );
  });

});

// ── runSimulation — opening hand stats ────────────────────────────────────────

describe('runSimulation — opening hand stats', () => {

  it('returns expected result shape', () => {
    const result = runSimulation(ALL_LANDS_DECK, 1);
    assert.ok(result.summary);
    assert.ok(result.summary.avgTypeCounts);
    assert.equal(typeof result.summary.goodLandHandPct, 'number');
    assert.equal(result.gamesSimulated, 1);
  });

  it('ALL_LANDS_DECK: avgTypeCounts.Land === 7', () => {
    // Every card is a land; every hand of 7 must contain exactly 7 lands.
    const { summary } = runSimulation(ALL_LANDS_DECK, 10000);
    assert.equal(summary.avgTypeCounts.Land, 7);
  });

  it('ALL_LANDS_DECK: goodLandHandPct === 100', () => {
    // Built-in threshold is ≥3 lands. Every hand qualifies.
    const { summary } = runSimulation(ALL_LANDS_DECK, 10000);
    assert.equal(summary.goodLandHandPct, 100);
  });

  it('ALL_CREATURES_DECK: avgTypeCounts.Land === 0', () => {
    const { summary } = runSimulation(ALL_CREATURES_DECK, 10000);
    assert.equal(summary.avgTypeCounts.Land, 0);
  });

  it('ALL_CREATURES_DECK: goodLandHandPct === 0', () => {
    const { summary } = runSimulation(ALL_CREATURES_DECK, 10000);
    assert.equal(summary.goodLandHandPct, 0);
  });

  it('ALL_MDFC_DECK: MDFC cards count toward Sorcery, Land, and MDFC buckets', () => {
    // Each MDFC counts toward its two face types and the MDFC sentinel.
    // With all-MDFC deck, all three buckets equal 7.0.
    const { summary } = runSimulation(ALL_MDFC_DECK, 10000);
    assert.equal(summary.avgTypeCounts.Sorcery, 7);
    assert.equal(summary.avgTypeCounts.Land, 7);
    assert.equal(summary.avgTypeCounts.MDFC, 7);
  });

});

// ── runSimulation — goodHandDefs ──────────────────────────────────────────────

describe('runSimulation — goodHandDefs', () => {

  it('returns goodHandAnyPct === 100 when all hands pass the def', () => {
    const def = makeGoodHandDef([{ type: 'at_least_type', count: 3, cardType: 'Land' }]);
    // ALL_LANDS_DECK: every hand has 7 lands, so ≥3 lands is always satisfied.
    const { summary } = runSimulation(ALL_LANDS_DECK, 1000, [def]);
    assert.equal(summary.goodHandAnyPct, 100);
  });

  it('returns goodHandAnyPct === 0 when no hand passes the def', () => {
    const def = makeGoodHandDef([{ type: 'at_least_type', count: 1, cardType: 'Land' }]);
    // ALL_CREATURES_DECK: no lands, so this def can never pass.
    const { summary } = runSimulation(ALL_CREATURES_DECK, 1000, [def]);
    assert.equal(summary.goodHandAnyPct, 0);
  });

  it('goodHandAnyPct is null when no goodHandDefs are passed', () => {
    const { summary } = runSimulation(ALL_LANDS_DECK, 100);
    assert.equal(summary.goodHandAnyPct, null);
  });

  it('goodHandDefPcts contains an entry for each def id', () => {
    const def = makeGoodHandDef([{ type: 'at_least_type', count: 1, cardType: 'Land' }]);
    def.id = 'my-def';
    const { summary } = runSimulation(ALL_LANDS_DECK, 100, [def]);
    assert.ok('my-def' in summary.goodHandDefPcts);
  });

  it('goodHandAnyPct reflects union: 100% when at least one def always passes', () => {
    const always = makeGoodHandDef([{ type: 'at_least_type', count: 4, cardType: 'Land' }]);
    const never  = makeGoodHandDef([{ type: 'at_least_type', count: 1, cardType: 'Creature' }]);
    always.id = 'always'; never.id = 'never';
    const { summary } = runSimulation(ALL_LANDS_DECK, 500, [always, never]);
    assert.equal(summary.goodHandDefPcts['always'], 100);
    assert.equal(summary.goodHandDefPcts['never'], 0);
    assert.equal(summary.goodHandAnyPct, 100); // union: always passes
  });

  it('goodHandAnyPct is 0 when all defs always fail', () => {
    const d1 = makeGoodHandDef([{ type: 'at_least_type', count: 1, cardType: 'Creature' }]);
    const d2 = makeGoodHandDef([{ type: 'at_least_type', count: 1, cardType: 'Artifact' }]);
    d1.id = 'd1'; d2.id = 'd2';
    const { summary } = runSimulation(ALL_LANDS_DECK, 500, [d1, d2]);
    assert.equal(summary.goodHandAnyPct, 0);
  });

});

// ── runSimulation — enriched (turn-by-turn) ───────────────────────────────────

describe('runSimulation — enriched deck (turn-by-turn)', () => {

  it('avgEffectDrawsPerGame > 0 when ETB draw creatures are present', () => {
    // ETB_DRAW_DECK: 7 creatures each with ETB draw-1. Some will be in hand and cast.
    const { summary } = runSimulation(ETB_DRAW_DECK, 1000);
    assert.ok(
      summary.avgEffectDrawsPerGame > 0,
      `Expected avgEffectDrawsPerGame > 0, got ${summary.avgEffectDrawsPerGame}`,
    );
  });

  it('avgCardsDrawnByTurn[1] >= 8 (opening hand + at least 1 draw step)', () => {
    const { summary } = runSimulation(ETB_DRAW_DECK, 1000);
    assert.ok(
      summary.avgCardsDrawnByTurn[1] >= 8,
      `Expected ≥8 by turn 1, got ${summary.avgCardsDrawnByTurn[1]}`,
    );
  });

  it('avgCardsDrawnByTurn increases each turn', () => {
    const { summary } = runSimulation(ETB_DRAW_DECK, 1000);
    const turns = Object.keys(summary.avgCardsDrawnByTurn).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < turns.length; i++) {
      const prev = summary.avgCardsDrawnByTurn[turns[i - 1]];
      const curr = summary.avgCardsDrawnByTurn[turns[i]];
      assert.ok(
        curr >= prev,
        `avgCardsDrawnByTurn should be non-decreasing but turn ${turns[i]} (${curr}) < turn ${turns[i-1]} (${prev})`,
      );
    }
  });

  it('UPKEEP_DRAW_DECK: upkeep effects fire after Mine enters (avgEffectDrawsPerGame > 0)', () => {
    // Howling Mine costs 2; enters turn 2. Upkeep draw fires turn 3 onward.
    const { summary } = runSimulation(UPKEEP_DRAW_DECK, 1000);
    assert.ok(
      summary.avgEffectDrawsPerGame > 0,
      `Expected avgEffectDrawsPerGame > 0, got ${summary.avgEffectDrawsPerGame}`,
    );
  });

  it('LOOT_DECK: tap loot fires and shows up in avgEffectDrawsPerGame', () => {
    // Artifacts have no summoning sickness — loot rock taps the same turn it enters.
    const { summary } = runSimulation(LOOT_DECK, 1000);
    assert.ok(
      summary.avgEffectDrawsPerGame > 0,
      `Expected avgEffectDrawsPerGame > 0, got ${summary.avgEffectDrawsPerGame}`,
    );
  });

  it('LOOT_DECK: drawEffectSourceBreakdown tracks loot card by name', () => {
    const { summary } = runSimulation(LOOT_DECK, 200);
    const sources = Object.keys(summary.drawEffectSourceBreakdown ?? {});
    assert.ok(
      sources.some(s => s.startsWith('LootRock')),
      `Expected a LootRock entry in drawEffectSourceBreakdown, got: ${JSON.stringify(sources)}`,
    );
  });

  it('draw_replacement doubles the normal draw step after Archive enters', () => {
    // Archive costs 5 — enters around turn 5.
    // After it enters, each draw step should give 2 cards instead of 1.
    // Deck: 50 lands + 10 Archives (to ensure one is in hand early).
    const archive = makeCard({
      name: 'Alhammarret\'s Archive',
      types: ['Artifact'],
      cmc: 5,
      effectTags: [{
        category: 'replacement', subtype: 'draw_replacement', timing: 'static',
        multiplier: 2, exceptFirst: false, isConditional: false, tier: 'simulatable', source: 'auto',
      }],
      quantity: 10,
    });
    const land = makeCard({ name: 'Forest', types: ['Land'], cmc: 0, effectTags: [], quantity: 50 });
    const deck = makeDeck([archive, land], { enriched: true });
    const { summary } = runSimulation(deck, 2000);
    // By turn 10 with 2× draw step, cumulative draws >> turn 10 without amplification.
    // Baseline without Archive: 7 + 10 = 17 by turn 10.
    // With Archive after turn 5: 7 + 5 + ~10 (doubled for turns 6-10) ≈ 27.
    assert.ok(
      summary.avgCardsDrawnByTurn[10] > 19,
      `Expected >19 cards drawn by turn 10 with Archive doubling, got ${summary.avgCardsDrawnByTurn[10]}`,
    );
  });

  it('draw_replacement with exceptFirst: does not double the first draw, does double subsequent draws', () => {
    // Teferi's Ageless Insight: except the first draw each turn, draw two cards instead.
    // Give the deck an upkeep draw (Howling Mine style) — that's the second draw.
    // The upkeep draw fires before the normal draw step. cardsDrawnThisTurn = 0 → no multiplier.
    // Then the normal draw step fires: cardsDrawnThisTurn = 1 → multiplier applies → 2 cards.
    const insight = makeCard({
      name: "Teferi's Ageless Insight",
      types: ['Enchantment'],
      cmc: 4,
      effectTags: [{
        category: 'replacement', subtype: 'draw_replacement', timing: 'static',
        multiplier: 2, exceptFirst: true, isConditional: false, tier: 'simulatable', source: 'auto',
      }],
      quantity: 10,
    });
    const upkeepDrawer = makeCard({
      name: 'Upkeep Drawer',
      types: ['Artifact'],
      cmc: 2,
      effectTags: [{
        category: 'draw', subtype: 'draw_n', timing: 'upkeep',
        value: 1, isConditional: false, condition: null, tier: 'simulatable', source: 'auto',
      }],
      quantity: 10,
    });
    const land = makeCard({ name: 'Forest', types: ['Land'], cmc: 0, effectTags: [], quantity: 40 });
    const deck = makeDeck([insight, upkeepDrawer, land], { enriched: true });
    const { summary } = runSimulation(deck, 2000);
    // Should draw more than baseline (7 + 10 = 17 by turn 10) due to doubling.
    assert.ok(
      summary.avgCardsDrawnByTurn[10] > 19,
      `Expected >19 by turn 10 with Teferi's Insight, got ${summary.avgCardsDrawnByTurn[10]}`,
    );
  });

  it('MDFC-only deck plays a land drop each turn via the land face', () => {
    // When no pure land is in hand, the MDFC land-back should be played.
    // avgCardsDrawnByTurn[1] >= 8 means simulation ran (7 opening + at least 1 draw step).
    const mdfcDeck = makeDeck(
      Array.from({ length: 60 }, (_, i) => makeCard({
        name: `Spell${i} // Land${i}`,
        types: ['Sorcery', 'Land', 'MDFC'],
        cmc: 2,
        isMDFC: true,
        faces: [
          { name: `Spell${i}`, types: ['Sorcery'], cmc: 2, oracleText: '', effectTags: [] },
          { name: `Land${i}`, types: ['Land'], cmc: 0, oracleText: '', effectTags: [] },
        ],
      })),
      { enriched: true },
    );
    const { summary } = runSimulation(mdfcDeck, 200);
    assert.ok(
      summary.avgCardsDrawnByTurn[1] >= 8,
      `Expected ≥8 cards drawn by turn 1, got ${summary.avgCardsDrawnByTurn[1]}`,
    );
  });

});
