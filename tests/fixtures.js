/**
 * Test fixtures — pre-built card and deck constants for reuse across test files.
 *
 * EXTENDING: Add new card or deck exports here so any test file can import them.
 * Use makeCard() with only the fields that make the card meaningful for the test.
 */

import { makeCard, makeDeck } from './helpers.js';

// ── Canonical card fixtures ──────────────────────────────────────────────────

/** A basic land — plays as land, contributes to land count. */
export const LAND = makeCard({
  name: 'Forest',
  types: ['Land'],
  cmc: 0,
  effectTags: [],
});

/** A vanilla 2-CMC creature — no effects. */
export const CREATURE_2 = makeCard({
  name: 'Grizzly Bears',
  types: ['Creature'],
  cmc: 2,
});

/** A creature with an ETB draw-1 effect (fires during simulation). */
export const ETB_DRAW = makeCard({
  name: 'ETB Drawer',
  types: ['Creature'],
  cmc: 3,
  effectTags: [{
    category: 'draw',
    subtype: 'draw_n',
    timing: 'etb',
    value: 1,
    isConditional: false,
    condition: null,
    tier: 'simulatable',
    source: 'auto',
  }],
});

/** An artifact with an upkeep draw-1 effect. */
export const UPKEEP_DRAW = makeCard({
  name: 'Howling Mine',
  types: ['Artifact'],
  cmc: 2,
  effectTags: [{
    category: 'draw',
    subtype: 'draw_n',
    timing: 'upkeep',
    value: 1,
    isConditional: false,
    condition: null,
    tier: 'simulatable',
    source: 'auto',
  }],
});

/** An MDFC — Sorcery face (CMC 2) // Land face. Counts as Sorcery, Land, and MDFC. */
export const MDFC_SPELL_LAND = makeCard({
  name: 'Spell // Land',
  types: ['Sorcery', 'Land', 'MDFC'],
  cmc: 2,
  isMDFC: true,
  faces: [
    { name: 'Spell Face', types: ['Sorcery'], cmc: 2, oracleText: '', effectTags: [] },
    { name: 'Land Face', types: ['Land'], cmc: 0, oracleText: '', effectTags: [] },
  ],
});

/** A multi-type single-faced card — counts as both Land and Enchantment. */
export const ENCHANTMENT_LAND = makeCard({
  name: "Urza's Saga",
  types: ['Land', 'Enchantment'],
  cmc: 0,
});

// ── Deck fixtures ────────────────────────────────────────────────────────────

/**
 * 60 unique pure lands — every opening hand contains exactly 7 lands.
 * Use enriched:false (opening hand only) since there's nothing to cast.
 */
export const ALL_LANDS_DECK = makeDeck(
  Array.from({ length: 60 }, (_, i) => makeCard({ name: `Forest${i}`, types: ['Land'], cmc: 0 })),
  { enriched: false },
);

/**
 * 60 unique vanilla creatures — every opening hand has 0 lands.
 * Use enriched:false for fast stat tests.
 */
export const ALL_CREATURES_DECK = makeDeck(
  Array.from({ length: 60 }, (_, i) => makeCard({ name: `Bear${i}`, types: ['Creature'], cmc: 2 })),
  { enriched: false },
);

/**
 * 60 unique MDFCs — every opening hand has 7 cards that count as Sorcery, Land, and MDFC.
 * avgTypeCounts for Sorcery, Land, and MDFC should all equal 7.0.
 */
export const ALL_MDFC_DECK = makeDeck(
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
  { enriched: false },
);

/**
 * 53 lands + 7 ETB-draw creatures (enriched).
 * Running full simulation should produce avgEffectDrawsPerGame > 0.
 */
export const ETB_DRAW_DECK = makeDeck(
  [
    ...Array.from({ length: 53 }, (_, i) => makeCard({ name: `Forest${i}`, types: ['Land'], cmc: 0 })),
    ...Array.from({ length: 7 }, (_, i) => ({ ...ETB_DRAW, name: `ETBDrawer${i}` })),
  ],
  { enriched: true },
);

/** An artifact with a tap-loot effect ({T}: Draw 1, then discard 1). */
export const LOOT_TAP = makeCard({
  name: 'Loot Rock',
  types: ['Artifact'],
  cmc: 2,
  effectTags: [{
    category: 'draw',
    subtype: 'loot',
    timing: 'tap',
    value: 1,
    discardCount: 1,
    isAdditionalCost: false,
    isConditional: false,
    condition: null,
    triggerFilter: null,
    tier: 'simulatable',
    source: 'auto',
  }],
});

/**
 * 50 lands + 10 tap-loot artifacts (enriched).
 * Loot rocks enter turn 2 (CMC 2) and tap immediately (no summoning sickness).
 * avgEffectDrawsPerGame should be > 0.
 */
export const LOOT_DECK = makeDeck(
  [
    ...Array.from({ length: 50 }, (_, i) => makeCard({ name: `Forest${i}`, types: ['Land'], cmc: 0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ ...LOOT_TAP, name: `LootRock${i}` })),
  ],
  { enriched: true },
);

/**
 * 50 lands + 10 Howling Mine (upkeep draw 1, CMC 2) — enriched.
 * Upkeep draw fires from turn 3 onward after the Mine enters on turn 2.
 * avgEffectDrawsPerGame should be > 0.
 */
export const UPKEEP_DRAW_DECK = makeDeck(
  [
    ...Array.from({ length: 50 }, (_, i) => makeCard({ name: `Forest${i}`, types: ['Land'], cmc: 0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ ...UPKEEP_DRAW, name: `HowlingMine${i}` })),
  ],
  { enriched: true },
);
