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

});
