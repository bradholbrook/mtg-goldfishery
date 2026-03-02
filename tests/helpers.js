/**
 * Test helpers — factory functions for building minimal valid objects.
 *
 * Only specify what your test cares about; everything else gets a sensible default.
 *
 * EXTENDING: Add new factory functions here if you need to build other
 * data shapes (e.g. makeStrategy(), makeEffectTag()).
 */

/**
 * Build a minimal valid Card object.
 * @param {Object} overrides - Any Card fields to override.
 * @returns {Object}
 */
export function makeCard(overrides = {}) {
  return {
    name: 'Test Card',
    quantity: 1,
    types: ['Creature'],
    cmc: 2,
    enriched: true,
    effectTags: [],
    isMDFC: false,
    faces: null,
    ...overrides,
  };
}

/**
 * Build a minimal valid DeckConfig.
 * @param {Object[]} cards - Array of card objects (each with quantity set).
 * @param {Object}   opts
 * @param {boolean}  [opts.enriched=false] - Set true to enable turn-by-turn simulation.
 * @param {Object[]} [opts.goodHandDefs=[]]
 * @returns {Object}
 */
export function makeDeck(cards, opts = {}) {
  return {
    id: 'test-deck',
    name: 'Test Deck',
    cards,
    enriched: opts.enriched ?? false,
    goodHandDefs: opts.goodHandDefs ?? [],
    format: 'commander',
  };
}

/**
 * Build a GoodHandDef from an array of criterion objects.
 * @param {Object[]} criteria
 * @returns {Object}
 */
export function makeGoodHandDef(criteria) {
  return { id: 'test-def', name: 'Test Def', criteria };
}

/**
 * Build a minimal EffectTag.
 * @param {Object} overrides
 * @returns {Object}
 */
export function makeEffectTag(overrides = {}) {
  return {
    category: 'draw',
    subtype: 'draw_n',
    timing: 'etb',
    value: 1,
    isConditional: false,
    condition: null,
    tier: 'simulatable',
    source: 'auto',
    ...overrides,
  };
}
