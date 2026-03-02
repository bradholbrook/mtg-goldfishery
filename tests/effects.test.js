/**
 * Effects tests — detectEffectTags() oracle text parsing.
 *
 * EXTENDING:
 *   • Add a new assertTag() call for any oracle text pattern you want to verify.
 *   • Add a new assertNoTags() call for texts that should produce no draw effects.
 *   • Each assertTag() accepts a partial expected object — only specify the
 *     fields that matter for your test case.
 *
 * Examples of easy additions:
 *   assertTag('Whenever you cast a spell, draw a card.', { timing: 'cast', tier: 'simulatable_soon' });
 *   assertTag('When ~ dies, draw a card.', { timing: 'death', tier: 'simulatable_soon' });
 *   assertTag('Draw three cards.', { value: 3, tier: 'simulatable' });
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectEffectTags } from '../js/effects.js';

/**
 * Assert that detectEffectTags(oracleText) produces at least one tag whose
 * fields include all key/value pairs in `expected`.
 *
 * Only the fields listed in `expected` are checked — other fields on the tag
 * are ignored. This keeps tests focused on what matters for each oracle text.
 */
function assertTag(oracleText, expected, keywords = []) {
  const tags = detectEffectTags(oracleText, keywords);
  const drawTags = tags.filter(t => t.category === 'draw');
  assert.ok(
    drawTags.length > 0,
    `Expected at least one draw tag for: "${oracleText}"\nGot: ${JSON.stringify(tags)}`,
  );
  const match = drawTags.find(tag =>
    Object.entries(expected).every(([k, v]) => tag[k] === v),
  );
  assert.ok(
    match,
    `No tag matched ${JSON.stringify(expected)} for: "${oracleText}"\nGot tags: ${JSON.stringify(drawTags)}`,
  );
}

/**
 * Assert that detectEffectTags(oracleText) produces no draw-effect tags.
 */
function assertNoTags(oracleText, keywords = []) {
  const tags = detectEffectTags(oracleText, keywords);
  const drawTags = tags.filter(t => t.category === 'draw');
  assert.equal(
    drawTags.length,
    0,
    `Expected no draw tags for: "${oracleText}"\nGot: ${JSON.stringify(drawTags)}`,
  );
}

// ── ETB draw detection ────────────────────────────────────────────────────────

describe('ETB draw detection', () => {

  it('detects "When ~ enters, draw a card"', () => {
    assertTag('When ~ enters, draw a card.', {
      timing: 'etb',
      value: 1,
      tier: 'simulatable',
      isConditional: false,
    });
  });

  it('detects "When this creature enters the battlefield, draw a card"', () => {
    assertTag('When this creature enters the battlefield, draw a card.', {
      timing: 'etb',
      value: 1,
      tier: 'simulatable',
    });
  });

  it('detects ETB draw two', () => {
    assertTag('When ~ enters, draw two cards.', {
      timing: 'etb',
      value: 2,
      tier: 'simulatable',
    });
  });

  it('detects ETB draw three', () => {
    assertTag('When ~ enters, draw three cards.', {
      timing: 'etb',
      value: 3,
      tier: 'simulatable',
    });
  });

});

// ── Upkeep draw detection ─────────────────────────────────────────────────────

describe('upkeep draw detection', () => {

  it('detects "At the beginning of your upkeep, draw a card"', () => {
    assertTag('At the beginning of your upkeep, draw a card.', {
      timing: 'upkeep',
      value: 1,
      tier: 'simulatable',
      isConditional: false,
    });
  });

});

// ── Tap draw detection ────────────────────────────────────────────────────────

describe('tap draw detection', () => {

  it('detects "{T}: Draw a card"', () => {
    assertTag('{T}: Draw a card.', {
      timing: 'tap',
      value: 1,
      tier: 'simulatable',
      isConditional: false,
    });
  });

  it('detects loot "{T}: Draw a card, then discard a card"', () => {
    assertTag('{T}: Draw a card, then discard a card.', {
      subtype: 'loot',
      timing: 'tap',
      tier: 'simulatable',
    });
  });

});

// ── Conditional draws ─────────────────────────────────────────────────────────

describe('conditional draw detection', () => {

  it('"you may draw a card" is marked conditional and track_only', () => {
    assertTag('You may draw a card.', {
      isConditional: true,
      tier: 'track_only',
      condition: 'may draw',
    });
  });

  it('"draw a card if" is marked conditional', () => {
    assertTag('Draw a card if you control a Forest.', {
      isConditional: true,
      tier: 'track_only',
    });
  });

});

// ── No false positives ────────────────────────────────────────────────────────

describe('no false positives', () => {

  it('empty string produces no tags', () => {
    assertNoTags('');
  });

  it('null produces no tags', () => {
    const tags = detectEffectTags(null, []);
    assert.deepEqual(tags, []);
  });

  it('vanilla keyword text produces no draw tags', () => {
    assertNoTags('Flying. Trample.');
  });

  it('land oracle text produces no draw tags', () => {
    assertNoTags('{T}: Add {G}.');
  });

  it('protection text produces no draw tags', () => {
    assertNoTags('Protection from blue and from black.');
  });

});

// ── Tier assignment ───────────────────────────────────────────────────────────

describe('tier assignment', () => {

  it('ETB unconditional draw is simulatable', () => {
    assertTag('When ~ enters, draw a card.', { tier: 'simulatable' });
  });

  it('upkeep unconditional draw is simulatable', () => {
    assertTag('At the beginning of your upkeep, draw a card.', { tier: 'simulatable' });
  });

  it('conditional draw is track_only', () => {
    assertTag('You may draw a card.', { tier: 'track_only' });
  });

  it('loot is simulatable', () => {
    assertTag('Draw a card, then discard a card.', { tier: 'simulatable', subtype: 'loot' });
  });

});

// ── Triggered ability framework: land_etb / creature_etb timings ──────────────

describe('land_etb timing', () => {

  it('detects Tatyova-style land ETB draw', () => {
    assertTag(
      'Whenever a land enters the battlefield under your control, you gain 1 life and draw a card.',
      { timing: 'land_etb', value: 1, tier: 'simulatable', isConditional: false },
    );
  });

  it('land_etb does not get a triggerFilter', () => {
    const tags = detectEffectTags(
      'Whenever a land enters the battlefield under your control, draw a card.',
    );
    const tag = tags.find(t => t.timing === 'land_etb');
    assert.ok(tag, 'expected land_etb tag');
    assert.equal(tag.triggerFilter, null);
  });

});

describe('creature_etb timing', () => {

  it('detects Soul of the Harvest style creature ETB draw (simulatable_soon)', () => {
    assertTag(
      'Whenever another nontoken creature enters the battlefield under your control, draw a card.',
      { timing: 'creature_etb', value: 1, tier: 'simulatable_soon' },
    );
  });

});

// ── Cast trigger filters ───────────────────────────────────────────────────────

describe('cast trigger filters', () => {

  it('Hazoret Monument: creature spell filter on loot', () => {
    // "Whenever you cast a creature spell, you may discard a card. If you do, draw a card."
    const tags = detectEffectTags(
      'Colored spells you cast cost {1} less to cast. Whenever you cast a creature spell, you may discard a card. If you do, draw a card.',
    );
    const loot = tags.find(t => t.subtype === 'loot' && t.timing === 'cast');
    assert.ok(loot, 'expected cast loot tag');
    assert.deepEqual(loot.triggerFilter, { spellTypes: ['Creature'] });
  });

  it('generic "whenever you cast a spell" has null triggerFilter', () => {
    const tags = detectEffectTags('Whenever you cast a spell, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.equal(tag.triggerFilter, null);
  });

  it('noncreature spell filter', () => {
    const tags = detectEffectTags('Whenever you cast a noncreature spell, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.deepEqual(tag.triggerFilter, { spellTypes: null, excludeTypes: ['Creature'] });
  });

  it('etb timing draws have null triggerFilter', () => {
    const tags = detectEffectTags('When ~ enters, draw a card.');
    const tag = tags.find(t => t.timing === 'etb');
    assert.ok(tag, 'expected etb tag');
    assert.equal(tag.triggerFilter, null);
  });

});
