/**
 * Criteria tests — evaluateGoodHandDef() and individual CRITERION_TYPES.evaluate().
 *
 * EXTENDING:
 *   • To test a new criterion type, add a describe() block below.
 *   • Build a hand with makeCard() and a criterion literal, then call
 *     evaluateGoodHandDef() or CRITERION_TYPES[type].evaluate() directly.
 *   • Each test needs 3–5 lines: build hand → build criterion → assert.
 *
 * Pattern:
 *   const hand = [makeCard({ types: ['Land'] }), makeCard({ types: ['Creature'] })];
 *   const criterion = { type: 'at_least_type', count: 1, cardType: 'Land' };
 *   assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CRITERION_TYPES, evaluateGoodHandDef } from '../js/criteria.js';
import { makeCard, makeGoodHandDef } from './helpers.js';
import { LAND, CREATURE_2, MDFC_SPELL_LAND, ENCHANTMENT_LAND } from './fixtures.js';

// ── at_least_type ─────────────────────────────────────────────────────────────

describe('at_least_type criterion', () => {

  it('passes when hand has exactly the required count', () => {
    const hand = [LAND, LAND, LAND, CREATURE_2];
    const criterion = { type: 'at_least_type', count: 3, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('passes when hand exceeds the required count', () => {
    const hand = [LAND, LAND, LAND, LAND, CREATURE_2];
    const criterion = { type: 'at_least_type', count: 3, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('fails when hand is one short', () => {
    const hand = [LAND, LAND, CREATURE_2, CREATURE_2];
    const criterion = { type: 'at_least_type', count: 3, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), false);
  });

  it('MDFC counts toward Sorcery (its spell-face type)', () => {
    const hand = [MDFC_SPELL_LAND];
    const criterion = { type: 'at_least_type', count: 1, cardType: 'Sorcery' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('MDFC counts toward Land (its land-face type)', () => {
    const hand = [MDFC_SPELL_LAND];
    const criterion = { type: 'at_least_type', count: 1, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('multi-type card (Enchantment Land) counts toward Land', () => {
    const hand = [ENCHANTMENT_LAND];
    const criterion = { type: 'at_least_type', count: 1, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('multi-type card (Enchantment Land) counts toward Enchantment', () => {
    const hand = [ENCHANTMENT_LAND];
    const criterion = { type: 'at_least_type', count: 1, cardType: 'Enchantment' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('fails when hand is empty', () => {
    const criterion = { type: 'at_least_type', count: 1, cardType: 'Land' };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), []), false);
  });

});

// ── at_least_n_of_types ───────────────────────────────────────────────────────

describe('at_least_n_of_types criterion', () => {

  it('passes when count is met across multiple types', () => {
    const hand = [LAND, CREATURE_2, CREATURE_2];
    // Need ≥2 cards that are Land or Creature.
    const criterion = { type: 'at_least_n_of_types', count: 2, cardTypes: ['Land', 'Creature'] };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('each card is counted once even if it matches multiple types in the list', () => {
    // ENCHANTMENT_LAND matches both Land and Enchantment.
    // It should count as 1 card toward ≥1 of [Land, Enchantment].
    const hand = [ENCHANTMENT_LAND];
    const criterion = { type: 'at_least_n_of_types', count: 1, cardTypes: ['Land', 'Enchantment'] };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), true);
  });

  it('fails when count is not met', () => {
    const hand = [CREATURE_2];
    // Need ≥2 cards that are Land or Creature, but only 1 creature is present.
    const criterion = { type: 'at_least_n_of_types', count: 2, cardTypes: ['Land', 'Creature'] };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), false);
  });

  it('fails when cardTypes list is empty', () => {
    const hand = [LAND, CREATURE_2];
    const criterion = { type: 'at_least_n_of_types', count: 1, cardTypes: [] };
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([criterion]), hand), false);
  });

});

// ── evaluateGoodHandDef — AND logic ──────────────────────────────────────────

describe('evaluateGoodHandDef AND logic', () => {

  it('passes when all criteria are satisfied', () => {
    const hand = [LAND, LAND, LAND, CREATURE_2];
    const def = makeGoodHandDef([
      { type: 'at_least_type', count: 3, cardType: 'Land' },
      { type: 'at_least_type', count: 1, cardType: 'Creature' },
    ]);
    assert.equal(evaluateGoodHandDef(def, hand), true);
  });

  it('fails when one criterion fails', () => {
    const hand = [LAND, LAND, CREATURE_2];
    const def = makeGoodHandDef([
      { type: 'at_least_type', count: 3, cardType: 'Land' },  // fails: only 2 lands
      { type: 'at_least_type', count: 1, cardType: 'Creature' },
    ]);
    assert.equal(evaluateGoodHandDef(def, hand), false);
  });

  it('fails when criteria list is empty', () => {
    // An empty def is never a "good hand" — prevents vacuous passes.
    assert.equal(evaluateGoodHandDef(makeGoodHandDef([]), [LAND]), false);
  });

  it('fails when def is undefined', () => {
    assert.equal(evaluateGoodHandDef(undefined, [LAND]), false);
  });

  it('fails when def.criteria is missing', () => {
    assert.equal(evaluateGoodHandDef({ id: 'x', name: 'x' }, [LAND]), false);
  });

  it('unknown criterion type does not throw — returns false', () => {
    const hand = [LAND];
    const def = makeGoodHandDef([{ type: 'nonexistent_criterion_type' }]);
    assert.equal(evaluateGoodHandDef(def, hand), false);
  });

});

// ── CRITERION_TYPES registry ──────────────────────────────────────────────────

describe('CRITERION_TYPES registry', () => {

  it('contains at_least_type, at_least_n_of_types, n_of_cards', () => {
    assert.ok('at_least_type' in CRITERION_TYPES);
    assert.ok('at_least_n_of_types' in CRITERION_TYPES);
    assert.ok('n_of_cards' in CRITERION_TYPES);
  });

  it('each entry has id, label, fields, defaultValues, evaluate, describe', () => {
    for (const [key, entry] of Object.entries(CRITERION_TYPES)) {
      assert.equal(entry.id, key, `${key}.id should match its registry key`);
      assert.equal(typeof entry.label, 'string', `${key}.label should be a string`);
      assert.ok(Array.isArray(entry.fields), `${key}.fields should be an array`);
      assert.equal(typeof entry.defaultValues, 'function', `${key}.defaultValues should be a function`);
      assert.equal(typeof entry.evaluate, 'function', `${key}.evaluate should be a function`);
      assert.equal(typeof entry.describe, 'function', `${key}.describe should be a function`);
    }
  });

  it('defaultValues() returns a non-null object for every type', () => {
    for (const [key, entry] of Object.entries(CRITERION_TYPES)) {
      const defaults = entry.defaultValues();
      assert.ok(defaults && typeof defaults === 'object', `${key}.defaultValues() should return an object`);
    }
  });

  it('describe() returns a non-empty string with real values', () => {
    assert.equal(
      CRITERION_TYPES.at_least_type.describe({ count: 2, cardType: 'Land' }),
      '≥2 Land',
    );
    assert.equal(
      CRITERION_TYPES.at_least_n_of_types.describe({ count: 1, cardTypes: ['Land', 'Creature'] }),
      '≥1 Land or Creature',
    );
  });

  it('describe() handles missing/empty values gracefully', () => {
    const desc = CRITERION_TYPES.at_least_n_of_types.describe({ count: 1, cardTypes: [] });
    assert.ok(desc.includes('no types'), `expected "(no types)" in "${desc}"`);
  });

});
