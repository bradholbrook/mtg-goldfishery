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
 *   assertTag('Whenever you cast a spell, draw a card.', { timing: 'cast', tier: 'simulatable' });
 *   assertTag('When ~ dies, draw a card.', { timing: 'death', tier: 'track_only' });
 *   assertTag('Draw three cards.', { value: 3, tier: 'simulatable' });
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectEffectTags, getSimulatableTags, getTrackOnlyTags, hasDrawEffect, detectEtbTapped } from '../js/effects.js';

/**
 * Assert that detectEffectTags(oracleText) produces at least one tag whose
 * fields include all key/value pairs in `expected`.
 *
 * Only the fields listed in `expected` are checked — other fields on the tag
 * are ignored. This keeps tests focused on what matters for each oracle text.
 */
function assertTag(oracleText, expected, keywords = [], cardTypes = []) {
  const tags = detectEffectTags(oracleText, keywords, cardTypes);
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
 * Assert that detectEffectTags(oracleText) produces at least one replacement tag
 * whose fields include all key/value pairs in `expected`.
 */
function assertReplacementTag(oracleText, expected, keywords = [], cardTypes = []) {
  const tags = detectEffectTags(oracleText, keywords, cardTypes);
  const replacementTags = tags.filter(t => t.category === 'replacement');
  assert.ok(
    replacementTags.length > 0,
    `Expected at least one replacement tag for: "${oracleText}"\nGot: ${JSON.stringify(tags)}`,
  );
  const match = replacementTags.find(tag =>
    Object.entries(expected).every(([k, v]) => tag[k] === v),
  );
  assert.ok(
    match,
    `No replacement tag matched ${JSON.stringify(expected)} for: "${oracleText}"\nGot: ${JSON.stringify(replacementTags)}`,
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

  it('"you may draw a card" is unconditional simulatable — goldfishing always draws', () => {
    assertTag('You may draw a card.', {
      isConditional: false,
      tier: 'simulatable',
      condition: null,
    }, [], ['Sorcery']);
  });

  it('"draw a card if" is marked conditional', () => {
    assertTag('Draw a card if you control a Forest.', {
      isConditional: true,
      tier: 'track_only',
    }, [], ['Sorcery']);
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

  it('"draw a card if condition" is track_only', () => {
    assertTag('Draw a card if you control a Forest.', { tier: 'track_only', isConditional: true }, [], ['Sorcery']);
  });

  it('loot is simulatable', () => {
    assertTag('Draw a card, then discard a card.', { tier: 'simulatable', subtype: 'loot' }, [], ['Sorcery']);
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

  it('detects Soul of the Harvest style creature ETB draw (simulatable)', () => {
    assertTag(
      'Whenever another nontoken creature enters the battlefield under your control, draw a card.',
      { timing: 'creature_etb', value: 1, tier: 'simulatable' },
    );
  });

  it('detects Mentor of the Meek mana-gated "if you do, draw" as conditional (track_only)', () => {
    assertTag(
      'Whenever a creature with power 2 or less enters the battlefield under your control, you may pay {1}. If you do, draw a card.',
      { timing: 'creature_etb', value: 1, isConditional: true, condition: 'mana_payment', tier: 'track_only' },
    );
  });

});

// ── draw_step / on_draw timings ───────────────────────────────────────────────

describe('draw_step timing', () => {

  it('detects "at the beginning of your draw step, draw a card" (simulatable)', () => {
    assertTag('At the beginning of your draw step, draw a card.', {
      timing: 'draw_step',
      value: 1,
      tier: 'simulatable',
    });
  });

});

describe('on_draw timing', () => {

  it('"whenever you draw a card, draw an additional card" is on_draw (track_only)', () => {
    assertTag('Whenever you draw a card, draw an additional card.', {
      timing: 'on_draw',
      tier: 'track_only',
    });
  });

});

// ── New timings (Phase B) ─────────────────────────────────────────────────────

describe('end_step timing', () => {

  it('detects "at the beginning of your end step, draw a card" (Jin-Gitaxias)', () => {
    assertTag('At the beginning of your end step, draw seven cards.', {
      timing: 'end_step',
      value: 7,
      tier: 'simulatable',
    });
  });

  it('detects "at the beginning of each end step"', () => {
    assertTag('At the beginning of each end step, draw a card.', {
      timing: 'end_step',
      value: 1,
      tier: 'simulatable',
    });
  });

});

describe('opponent_cast timing', () => {

  it('detects Rhystic Study as simulatable opponent_cast draw', () => {
    assertTag('Whenever an opponent casts a spell, you may pay {1}. If you don\'t, draw a card.', {
      timing: 'opponent_cast',
      value: 1,
      isConditional: false,
      tier: 'simulatable',
    });
  });

  it('detects Mystic Remora as simulatable opponent_cast draw', () => {
    assertTag('Whenever an opponent casts a noncreature spell, draw a card unless that player pays {4}.', {
      timing: 'opponent_cast',
      value: 1,
      isConditional: false,
      tier: 'simulatable',
    });
  });

});

describe('opponent_draw timing', () => {

  it('detects Consecrated Sphinx as simulatable — "you may draw" is unconditional in goldfish', () => {
    assertTag('Whenever an opponent draws a card, you may draw two cards.', {
      timing: 'opponent_draw',
      value: 2,
      isConditional: false,
      tier: 'simulatable',
    });
  });

});

describe('attack timing', () => {

  it('detects "whenever ~ attacks" draw (Edric-style)', () => {
    assertTag('Whenever a creature attacks, its controller may draw a card.', {
      timing: 'attack',
      tier: 'track_only',
    });
  });

});

describe('combat_damage timing', () => {

  it('detects "deals combat damage, draw a card"', () => {
    assertTag('Whenever ~ deals combat damage to a player, draw a card.', {
      timing: 'combat_damage',
      value: 1,
      tier: 'track_only',
    });
  });

});

describe('sacrifice timing', () => {

  it('detects "whenever you sacrifice a permanent, draw a card" (Korvold)', () => {
    assertTag('Whenever you sacrifice a permanent, draw a card.', {
      timing: 'sacrifice',
      value: 1,
      tier: 'track_only',
    });
  });

});

describe('put card into hand pattern', () => {

  it('detects "put that card into your hand" as upkeep draw (Dark Confidant)', () => {
    assertTag('At the beginning of your upkeep, reveal the top card of your library and put that card into your hand.', {
      timing: 'upkeep',
      value: 1,
      tier: 'simulatable',
      isConditional: false,
    });
  });

});

describe('draw X cards pattern', () => {

  it('detects "draw X cards" as simulatable (value comes from xCosts config)', () => {
    assertTag('Target player draws X cards.', {
      condition: 'draw X',
      isConditional: false,
      tier: 'simulatable',
    }, [], ['Sorcery']);
  });

  it('detects Gadwick ETB draw X as simulatable', () => {
    assertTag('When Gadwick, the Wizened enters the battlefield, draw X cards.', {
      timing: 'etb',
      condition: 'draw X',
      isConditional: false,
      tier: 'simulatable',
    });
  });

  it('detects life-payment gated draw (Gix-style) as conditional with life_payment', () => {
    assertTag(
      'Whenever a creature dealt combat damage by ~ this turn is put into a graveyard, you may pay 2 life. If you do, draw a card.',
      { isConditional: true, condition: 'life_payment', tier: 'track_only' },
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

// ── Proposal F: trigger-clause separation ─────────────────────────────────────

describe('trigger-clause false positive prevention', () => {

  it('Sheoldred: "Whenever you draw a card, you gain 2 life" produces no draw tag', () => {
    assertNoTags('Whenever you draw a card, you gain 2 life.');
  });

  it('Sheoldred full text: only the "opponent draws" discard tag, no controller draw tag', () => {
    const oracle = 'Whenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, that player loses 2 life.';
    const tags = detectEffectTags(oracle);
    const drawTags = tags.filter(t => t.category === 'draw');
    assert.equal(drawTags.length, 0, `Expected no draw tags, got: ${JSON.stringify(drawTags)}`);
  });

  it('"whenever you draw a card" with no draw effect produces no draw tag', () => {
    assertNoTags('Whenever you draw a card, target opponent mills a card.');
  });

});

describe('creature_etb trigger filters', () => {

  it('Tocasia\'s Welcome: creature_etb with maxCmc:3 and nontoken filter', () => {
    const oracle = 'Whenever a nontoken creature with mana value 3 or less enters the battlefield under your control, draw a card.';
    const tags = detectEffectTags(oracle);
    const tag = tags.find(t => t.timing === 'creature_etb');
    assert.ok(tag, 'expected creature_etb tag');
    assert.equal(tag.triggerFilter?.maxCmc, 3);
    assert.equal(tag.triggerFilter?.nontoken, true);
  });

  it('Welcoming Vampire: creature_etb with maxPower:2 filter', () => {
    const oracle = 'Whenever a creature with power 2 or less enters the battlefield under your control, you may draw a card.';
    const tags = detectEffectTags(oracle);
    const tag = tags.find(t => t.timing === 'creature_etb');
    assert.ok(tag, 'expected creature_etb tag');
    assert.equal(tag.triggerFilter?.maxPower, 2);
  });

  it('Soul of the Harvest (no filter): creature_etb triggerFilter is null', () => {
    const oracle = 'Whenever another nontoken creature enters the battlefield under your control, draw a card.';
    const tags = detectEffectTags(oracle);
    const tag = tags.find(t => t.timing === 'creature_etb');
    assert.ok(tag, 'expected creature_etb tag');
    // nontoken is in the trigger but no CMC/power filter
    assert.equal(tag.triggerFilter?.maxCmc, undefined);
    assert.equal(tag.triggerFilter?.maxPower, undefined);
  });

});

// ── Mana rock detection ────────────────────────────────────────────────────────

describe('mana rock detection', () => {

  it('{T}: Add {G} produces a ramp/mana_rock tag', () => {
    const tags = detectEffectTags('{T}: Add {G}.');
    const rock = tags.find(t => t.category === 'ramp' && t.subtype === 'mana_rock');
    assert.ok(rock, 'expected mana_rock tag');
    assert.equal(rock.tier, 'simulatable');
    assert.equal(rock.timing, 'tap');
    assert.equal(rock.value, 1);
  });

  it('{T}: Add {2}{G} produces mana_rock with value 3', () => {
    const tags = detectEffectTags('{T}: Add {2}{G}.');
    const rock = tags.find(t => t.subtype === 'mana_rock');
    assert.ok(rock, 'expected mana_rock tag');
    assert.equal(rock.value, 3);
  });

  it('{T}: Add {G}{G} produces mana_rock with value 2', () => {
    const tags = detectEffectTags('{T}: Add {G}{G}.');
    const rock = tags.find(t => t.subtype === 'mana_rock');
    assert.ok(rock);
    assert.equal(rock.value, 2);
  });

  it('{T}: Add one mana of any color produces mana_rock with value 1', () => {
    const tags = detectEffectTags('{T}: Add one mana of any color.');
    const rock = tags.find(t => t.subtype === 'mana_rock');
    assert.ok(rock, 'expected mana_rock tag');
    assert.equal(rock.value, 1);
  });

  it('mana rock produces no draw tags', () => {
    const tags = detectEffectTags('{T}: Add {G}.');
    assert.equal(tags.filter(t => t.category === 'draw').length, 0);
  });

});

// ── Rummage / loot variant detection ─────────────────────────────────────────

describe('rummage pattern (discard first, then draw)', () => {

  it('"Discard a card, then draw a card" produces a loot tag', () => {
    const tags = detectEffectTags('Discard a card, then draw a card.', [], ['Sorcery']);
    const loot = tags.find(t => t.subtype === 'loot');
    assert.ok(loot, 'expected loot tag');
    assert.equal(loot.value, 1);
    assert.equal(loot.discardCount, 1);
    assert.equal(loot.tier, 'simulatable');
  });

});

describe('loot with count > 1 (Faithless Looting)', () => {

  it('"draw two cards, then discard two cards" — value:2, discardCount:2', () => {
    const tags = detectEffectTags('Draw two cards, then discard two cards.', [], ['Sorcery']);
    const loot = tags.find(t => t.subtype === 'loot');
    assert.ok(loot, 'expected loot tag');
    assert.equal(loot.value, 2);
    assert.equal(loot.discardCount, 2);
    assert.equal(loot.tier, 'simulatable');
  });

});

describe('additional cost discard loot (Tormenting Voice)', () => {

  it('period-separated "additional cost discard. Draw N" produces isAdditionalCost loot', () => {
    // Note: uses period-space separator so both sentences are in one ability clause.
    // Newline-separated oracle text splits into two blocks and loses the draw count.
    const oracle = 'As an additional cost to cast this spell, discard a card. Draw two cards.';
    const tags = detectEffectTags(oracle, [], ['Sorcery']);
    const loot = tags.find(t => t.subtype === 'loot' && t.isAdditionalCost === true);
    assert.ok(loot, 'expected isAdditionalCost loot tag');
    assert.equal(loot.discardCount, 1);
    assert.equal(loot.value, 2);
    assert.equal(loot.tier, 'simulatable');
  });

});

// ── Scaling tap draw ──────────────────────────────────────────────────────────

describe('scaling tap draw (The One Ring)', () => {

  it('detects counter-scaling draw pattern and extracts counterType', () => {
    const oracle = '{T}: Put a burden counter on ~, then draw a card for each burden counter on ~.';
    const tags = detectEffectTags(oracle);
    const tag = tags.find(t => t.subtype === 'draw_scaling_tap');
    assert.ok(tag, 'expected draw_scaling_tap tag');
    assert.equal(tag.timing, 'tap');
    assert.equal(tag.counterType, 'burden');
    assert.equal(tag.tier, 'simulatable');
    assert.equal(tag.value, null); // dynamic — resolved at sim time via counters
  });

  it('does not produce a conditional draw tag for the counter draw clause', () => {
    const oracle = '{T}: Put a burden counter on ~, then draw a card for each burden counter on ~.';
    const tags = detectEffectTags(oracle);
    const drawTags = tags.filter(t => t.category === 'draw' && t.subtype !== 'draw_scaling_tap');
    assert.equal(drawTags.length, 0, 'should not also produce a draw_n tag');
  });

});

// ── Death trigger filter ──────────────────────────────────────────────────────

describe('death trigger filter detection', () => {

  it('"when this creature dies" → deathSubject: self', () => {
    const tags = detectEffectTags('When this creature dies, draw a card.');
    const tag = tags.find(t => t.timing === 'death');
    assert.ok(tag, 'expected death tag');
    assert.equal(tag.triggerFilter?.deathSubject, 'self');
    assert.equal(tag.tier, 'track_only');
  });

  it('"whenever a creature dies" → deathSubject: any_creature', () => {
    const tags = detectEffectTags('Whenever a creature dies, draw a card.');
    const tag = tags.find(t => t.timing === 'death');
    assert.ok(tag, 'expected death tag');
    assert.equal(tag.triggerFilter?.deathSubject, 'any_creature');
  });

  it('"~ dies" (self-referential tilde) → deathSubject: self', () => {
    const tags = detectEffectTags('When ~ dies, draw a card.');
    const tag = tags.find(t => t.timing === 'death');
    assert.ok(tag, 'expected death tag');
    assert.equal(tag.triggerFilter?.deathSubject, 'self');
  });

});

// ── Commander cast filter ─────────────────────────────────────────────────────

describe('commander cast filter', () => {

  it('"whenever you cast your commander" → isCommander: true triggerFilter', () => {
    const tags = detectEffectTags('Whenever you cast your commander, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.equal(tag.triggerFilter?.isCommander, true);
    assert.equal(tag.triggerFilter?.spellTypes, null);
  });

});

// ── Additional cast trigger filter types ─────────────────────────────────────

describe('cast trigger filter: artifact and instant/sorcery', () => {

  it('artifact spell filter', () => {
    const tags = detectEffectTags('Whenever you cast an artifact spell, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.deepEqual(tag.triggerFilter, { spellTypes: ['Artifact'] });
  });

  it('instant or sorcery spell filter', () => {
    const tags = detectEffectTags('Whenever you cast an instant or sorcery spell, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.deepEqual(tag.triggerFilter, { spellTypes: ['Instant', 'Sorcery'] });
  });

  it('enchantment spell filter', () => {
    const tags = detectEffectTags('Whenever you cast an enchantment spell, draw a card.');
    const tag = tags.find(t => t.timing === 'cast');
    assert.ok(tag, 'expected cast tag');
    assert.deepEqual(tag.triggerFilter, { spellTypes: ['Enchantment'] });
  });

});

// ── Additional conditional draw patterns ──────────────────────────────────────

describe('additional conditional draw patterns', () => {

  it('"you may draw two cards" is unconditional simulatable — goldfishing always draws', () => {
    assertTag('You may draw two cards.', {
      isConditional: false,
      value: 2,
      condition: null,
      tier: 'simulatable',
    }, [], ['Sorcery']);
  });

  it('"draw a card for each" is conditional with null value', () => {
    assertTag('Draw a card for each creature you control.', {
      isConditional: true,
      value: null,
      condition: 'draw per condition',
      tier: 'track_only',
    }, [], ['Sorcery']);
  });

  it('"draw cards equal to" is conditional with null value', () => {
    assertTag('Draw cards equal to the number of creatures you control.', {
      isConditional: true,
      condition: 'draw equal to',
      tier: 'track_only',
    }, [], ['Sorcery']);
  });

});

// ── Digit draw count ──────────────────────────────────────────────────────────

describe('digit draw count', () => {

  it('"draw 3 cards" with a digit produces value 3', () => {
    assertTag('When ~ enters, draw 3 cards.', {
      timing: 'etb',
      value: 3,
      tier: 'simulatable',
    });
  });

});

// ── on_resolution for Instant card type ──────────────────────────────────────

describe('on_resolution for Instant card type', () => {

  it('"draw a card" in Instant oracle text produces on_resolution, simulatable', () => {
    assertTag('Draw a card.', {
      timing: 'on_resolution',
      value: 1,
      tier: 'simulatable',
    }, [], ['Instant']);
  });

});

// ── Ability word prefix stripping ─────────────────────────────────────────────

describe('ability word prefix stripping', () => {

  it('Landfall prefix stripped so land_etb timing is correctly detected', () => {
    assertTag(
      'Landfall — Whenever a land enters the battlefield under your control, you gain 1 life and draw a card.',
      { timing: 'land_etb', value: 1, tier: 'simulatable' },
    );
  });

});

// ── Utility functions ────────────────────────────────────────────────────────

describe('getSimulatableTags', () => {

  it('returns only simulatable-tier tags', () => {
    const tags = [
      { tier: 'simulatable', category: 'draw' },
      { tier: 'track_only', category: 'draw' },
      { tier: 'simulatable', category: 'ramp' },
      { tier: 'skip', category: 'draw' },
    ];
    const result = getSimulatableTags(tags);
    assert.equal(result.length, 2);
    assert.ok(result.every(t => t.tier === 'simulatable'));
  });

  it('returns empty array when no simulatable tags', () => {
    assert.deepEqual(getSimulatableTags([{ tier: 'track_only' }]), []);
  });

});

describe('getTrackOnlyTags', () => {

  it('returns track_only and legacy simulatable_soon tags', () => {
    const tags = [
      { tier: 'simulatable' },
      { tier: 'track_only' },
      { tier: 'simulatable_soon' },
      { tier: 'skip' },
    ];
    const result = getTrackOnlyTags(tags);
    assert.equal(result.length, 2);
    assert.ok(result.every(t => t.tier === 'track_only' || t.tier === 'simulatable_soon'));
  });

  it('returns empty array when no track_only or simulatable_soon tags', () => {
    assert.deepEqual(getTrackOnlyTags([{ tier: 'simulatable' }]), []);
  });

});

describe('hasDrawEffect', () => {

  it('returns true when a draw-category tag is present', () => {
    assert.ok(hasDrawEffect([{ category: 'draw' }]));
  });

  it('returns false when only non-draw tags are present', () => {
    assert.equal(hasDrawEffect([{ category: 'ramp' }]), false);
  });

  it('returns false for an empty array', () => {
    assert.equal(hasDrawEffect([]), false);
  });

  it('returns false for mana rock (ramp category)', () => {
    const tags = detectEffectTags('{T}: Add {G}.');
    assert.equal(hasDrawEffect(tags), false);
  });

});

// ── draw_replacement detection ────────────────────────────────────────────────

describe('draw_replacement detection', () => {

  it('Alhammarret\'s Archive: "draw twice that many cards instead" produces draw_replacement', () => {
    assertReplacementTag(
      'If you would draw cards, you draw twice that many cards instead.',
      { subtype: 'draw_replacement', multiplier: 2, exceptFirst: false, tier: 'simulatable', timing: 'static' },
    );
  });

  it('Thought Reflection: "draw a card instead" variant produces draw_replacement', () => {
    assertReplacementTag(
      'If you would draw a card, you draw two cards instead.',
      { subtype: 'draw_replacement', multiplier: 2, exceptFirst: false, tier: 'simulatable' },
    );
  });

  it('Teferi\'s Ageless Insight: exceptFirst is true', () => {
    assertReplacementTag(
      'If you would draw a card except the first one you draw each turn, draw two cards instead.',
      { subtype: 'draw_replacement', multiplier: 2, exceptFirst: true, tier: 'simulatable' },
    );
  });

  it('draw_replacement has category: replacement (not draw)', () => {
    const tags = detectEffectTags('If you would draw cards, you draw twice that many cards instead.');
    const tag = tags.find(t => t.subtype === 'draw_replacement');
    assert.ok(tag, 'expected draw_replacement tag');
    assert.equal(tag.category, 'replacement');
  });

  it('draw_replacement does not produce a draw-category tag', () => {
    const tags = detectEffectTags('If you would draw cards, you draw twice that many cards instead.');
    const drawTags = tags.filter(t => t.category === 'draw');
    assert.equal(drawTags.length, 0, 'should not produce a draw tag alongside the replacement tag');
  });

  it('Sheoldred "whenever you draw" does not produce draw_replacement', () => {
    const tags = detectEffectTags('Whenever you draw a card, you gain 2 life.');
    assert.equal(tags.filter(t => t.subtype === 'draw_replacement').length, 0);
  });

  it('draw_replacement has triggerFilter: null', () => {
    const tags = detectEffectTags('If you would draw cards, you draw twice that many cards instead.');
    const tag = tags.find(t => t.subtype === 'draw_replacement');
    assert.equal(tag.triggerFilter, null);
  });

});

describe('detectEtbTapped', () => {

  it('plain ETB tapped (Temple of Mystery)', () => {
    assert.equal(detectEtbTapped('Temple of Mystery enters the battlefield tapped.'), true);
  });

  it('ETB tapped using short form "enters tapped"', () => {
    assert.equal(detectEtbTapped('This land enters tapped.'), true);
  });

  it('check land: enters tapped unless you control a basic land type', () => {
    assert.equal(
      detectEtbTapped('Isolated Chapel enters the battlefield tapped unless you control a Plains or a Swamp.'),
      true,
    );
  });

  it('fast land: enters tapped unless you control two or fewer other lands', () => {
    assert.equal(
      detectEtbTapped('Darkslick Shores enters the battlefield tapped unless you control two or fewer other lands.'),
      true,
    );
  });

  it('shock land pattern (Sacred Foundry) — always pay in goldfish → untapped', () => {
    assert.equal(
      detectEtbTapped('({T}: Add {R} or {W}.) As Sacred Foundry enters the battlefield, you may pay 2 life. If you don\'t, Sacred Foundry enters the battlefield tapped.'),
      false,
    );
  });

  it('"unless you control two or more opponents" — always met in Commander → untapped', () => {
    assert.equal(
      detectEtbTapped('Spectator Seating enters the battlefield tapped unless you control two or more opponents.'),
      false,
    );
  });

  it('basic land — no ETB tapped text → false', () => {
    assert.equal(detectEtbTapped('({T}: Add {G}.)'), false);
  });

  it('null oracle text → false', () => {
    assert.equal(detectEtbTapped(null), false);
  });

  it('non-land oracle text that happens to contain "enters" → false', () => {
    assert.equal(detectEtbTapped('Whenever a creature enters the battlefield, draw a card.'), false);
  });

});
