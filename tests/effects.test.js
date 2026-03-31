/**
 * Effects tests — detectEffectTags() oracle text parsing.
 *
 * Covers the three auto-detected subtypes: mana_rock, draw_n, tutor.
 * No timing, tier, or triggerFilter — those were removed in the Phase 2 simplification.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectEffectTags, hasDrawEffect, detectEtbTapped } from '../js/effects.js';

// ── Mana rock detection ────────────────────────────────────────────────────────

describe('mana rock detection', () => {

  it('{T}: Add {G} produces a ramp/mana_rock tag with value 1', () => {
    const tags = detectEffectTags('{T}: Add {G}.');
    const rock = tags.find(t => t.category === 'ramp' && t.subtype === 'mana_rock');
    assert.ok(rock, 'expected mana_rock tag');
    assert.equal(rock.value, 1);
    assert.equal(rock.source, 'auto');
  });

  it('{T}: Add {2}{G} produces mana_rock with value 3', () => {
    const tags = detectEffectTags('{T}: Add {2}{G}.');
    const rock = tags.find(t => t.subtype === 'mana_rock');
    assert.ok(rock);
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

  it('card with both mana rock and draw produces two tags', () => {
    const tags = detectEffectTags('{T}: Add {U}. When ~ enters, draw a card.');
    assert.ok(tags.find(t => t.subtype === 'mana_rock'), 'expected mana_rock');
    assert.ok(tags.find(t => t.subtype === 'draw_n'), 'expected draw_n');
  });

});

// ── Draw N detection ──────────────────────────────────────────────────────────

describe('draw_n detection', () => {

  it('"draw a card" produces draw_n with value 1', () => {
    const tags = detectEffectTags('Draw a card.');
    const draw = tags.find(t => t.subtype === 'draw_n');
    assert.ok(draw, 'expected draw_n tag');
    assert.equal(draw.value, 1);
    assert.equal(draw.category, 'draw');
    assert.equal(draw.source, 'auto');
  });

  it('"draw two cards" produces draw_n with value 2', () => {
    const tags = detectEffectTags('Draw two cards.');
    const draw = tags.find(t => t.subtype === 'draw_n');
    assert.ok(draw);
    assert.equal(draw.value, 2);
  });

  it('"draw three cards" produces draw_n with value 3', () => {
    const tags = detectEffectTags('Draw three cards.');
    assert.equal(tags.find(t => t.subtype === 'draw_n')?.value, 3);
  });

  it('"draw 3 cards" with a digit produces value 3', () => {
    const tags = detectEffectTags('When ~ enters, draw 3 cards.');
    assert.equal(tags.find(t => t.subtype === 'draw_n')?.value, 3);
  });

  it('takes max draw count across oracle text', () => {
    // e.g. a card with draw 1 and draw 3 in different abilities
    const tags = detectEffectTags('Draw a card. At the beginning of your upkeep, draw three cards.');
    assert.equal(tags.find(t => t.subtype === 'draw_n')?.value, 3);
  });

  it('produces at most one draw_n tag', () => {
    const tags = detectEffectTags('Draw a card. Draw two cards.');
    assert.equal(tags.filter(t => t.subtype === 'draw_n').length, 1);
  });

});

// ── Tutor detection ───────────────────────────────────────────────────────────

describe('tutor detection', () => {

  it('"search your library for a basic land" produces tutor with Land type', () => {
    const tags = detectEffectTags('Search your library for a basic land card, then shuffle.');
    const tutor = tags.find(t => t.subtype === 'tutor');
    assert.ok(tutor, 'expected tutor tag');
    assert.equal(tutor.category, 'tutor');
    assert.equal(tutor.fetchType?.type, 'Land');
    assert.equal(tutor.fetchType?.supertype, 'Basic');
    assert.equal(tutor.putWhere, 'hand');
  });

  it('"search your library for a creature card" produces Creature type', () => {
    const tags = detectEffectTags('Search your library for a creature card and put it into your hand.');
    const tutor = tags.find(t => t.subtype === 'tutor');
    assert.ok(tutor);
    assert.equal(tutor.fetchType?.type, 'Creature');
  });

  it('"put it onto the battlefield" sets putWhere to battlefield', () => {
    const tags = detectEffectTags('Search your library for a creature card and put it onto the battlefield.');
    const tutor = tags.find(t => t.subtype === 'tutor');
    assert.ok(tutor);
    assert.equal(tutor.putWhere, 'battlefield');
  });

  it('"on top of your library" sets putWhere to top_of_library', () => {
    const tags = detectEffectTags('Search your library for a card and put it on top of your library.');
    const tutor = tags.find(t => t.subtype === 'tutor');
    assert.ok(tutor);
    assert.equal(tutor.putWhere, 'top_of_library');
  });

  it('"search your library for any card" produces any: true fetchType', () => {
    const tags = detectEffectTags('Search your library for any card and put it into your hand.');
    const tutor = tags.find(t => t.subtype === 'tutor');
    assert.ok(tutor);
    assert.equal(tutor.fetchType?.any, true);
  });

  it('produces at most one tutor tag', () => {
    const tags = detectEffectTags('Search your library for a land card. Search your library for a creature card.');
    assert.equal(tags.filter(t => t.subtype === 'tutor').length, 1);
  });

});

// ── No false positives ────────────────────────────────────────────────────────

describe('no false positives', () => {

  it('null produces no tags', () => {
    assert.deepEqual(detectEffectTags(null), []);
  });

  it('empty string produces no tags', () => {
    assert.deepEqual(detectEffectTags(''), []);
  });

  it('vanilla keyword text produces no tags', () => {
    const tags = detectEffectTags('Flying. Trample.');
    assert.equal(tags.length, 0);
  });

  it('protection text produces no draw tags', () => {
    const tags = detectEffectTags('Protection from blue and from black.');
    assert.equal(tags.filter(t => t.category === 'draw').length, 0);
  });

});

// ── hasDrawEffect ─────────────────────────────────────────────────────────────

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

  it('returns false for a mana rock (ramp category)', () => {
    const tags = detectEffectTags('{T}: Add {G}.');
    assert.equal(hasDrawEffect(tags), false);
  });

  it('returns true for oracle text that has a draw effect', () => {
    const tags = detectEffectTags('When ~ enters, draw a card.');
    assert.ok(hasDrawEffect(tags));
  });

});

// ── detectEtbTapped ───────────────────────────────────────────────────────────

describe('detectEtbTapped', () => {

  it('plain ETB tapped', () => {
    assert.equal(detectEtbTapped('Temple of Mystery enters the battlefield tapped.'), true);
  });

  it('short form "enters tapped"', () => {
    assert.equal(detectEtbTapped('This land enters tapped.'), true);
  });

  it('check land: enters tapped unless condition', () => {
    assert.equal(
      detectEtbTapped('Isolated Chapel enters the battlefield tapped unless you control a Plains or a Swamp.'),
      true,
    );
  });

  it('shock land — "you may pay 2 life. If you don\'t, enters tapped" → false (goldfish pays)', () => {
    assert.equal(
      detectEtbTapped("({T}: Add {R} or {W}.) As Sacred Foundry enters the battlefield, you may pay 2 life. If you don't, Sacred Foundry enters the battlefield tapped."),
      false,
    );
  });

  it('"unless you control two or more opponents" → false (always met in Commander)', () => {
    assert.equal(
      detectEtbTapped('Spectator Seating enters the battlefield tapped unless you control two or more opponents.'),
      false,
    );
  });

  it('basic land — no ETB tapped text → false', () => {
    assert.equal(detectEtbTapped('({T}: Add {G}.)'), false);
  });

  it('null → false', () => {
    assert.equal(detectEtbTapped(null), false);
  });

  it('creature ETB text that mentions "enters" → false', () => {
    assert.equal(detectEtbTapped('Whenever a creature enters the battlefield, draw a card.'), false);
  });

});
