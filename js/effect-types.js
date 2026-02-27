/**
 * MTG Goldfish Simulator - Effect Type Registry
 *
 * Canonical definitions for all supported effect subtypes.
 * Parallel to criteria.js — add one entry here → UI, simulation, and save/load work automatically.
 *
 * Each entry describes one effect subtype: its category, valid timings,
 * which fields appear in the editor UI, and how to describe it in plain text.
 *
 * Exported: EFFECT_TYPES (object keyed by subtype id), EFFECT_TYPE_OPTIONS (array)
 */

export const EFFECT_TYPES = {

  draw_n: {
    id:            'draw_n',
    label:         'Draw N cards',
    category:      'draw',
    validTimings:  ['etb', 'upkeep', 'cast', 'tap', 'death', 'draw_step', 'passive'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields: [
      { key: 'value',         widget: 'number',   label: 'Cards', min: 1, max: 20, default: 1 },
      { key: 'isConditional', widget: 'checkbox', label: 'May / conditional' },
    ],
    defaultValues: () => ({ value: 1, isConditional: false, expectedValue: null }),
    describe(tag) {
      const cond = tag.isConditional ? ' (may)' : '';
      return `draw ${tag.value ?? 1}${cond} @ ${tag.timing}`;
    },
  },

  loot: {
    id:            'loot',
    label:         'Loot (draw, then discard)',
    category:      'draw',
    validTimings:  ['etb', 'upkeep', 'cast', 'tap', 'death', 'passive'],
    permanentOnly: false,
    defaultTier:   'simulatable_soon',
    fields: [],
    defaultValues: () => ({}),
    describe(tag) {
      return `loot @ ${tag.timing}`;
    },
  },

  draw_scaling_tap: {
    id:            'draw_scaling_tap',
    label:         'Tap: scaling draw (counter)',
    category:      'draw',
    validTimings:  ['tap'],
    permanentOnly: true,
    defaultTier:   'simulatable',
    fields: [
      { key: 'counterType', widget: 'text', label: 'Counter name', default: 'charge' },
    ],
    defaultValues: () => ({ counterType: 'charge' }),
    describe(tag) {
      return `tap: draw per ${tag.counterType || 'counter'} counter`;
    },
  },

  mana_rock: {
    id:            'mana_rock',
    label:         'Tap for mana',
    category:      'ramp',
    validTimings:  ['tap'],
    permanentOnly: true,
    defaultTier:   'track_only',
    fields: [
      { key: 'value', widget: 'number', label: 'Mana', min: 1, max: 10, default: 1 },
    ],
    defaultValues: () => ({ value: 1 }),
    describe(tag) {
      return `tap: +${tag.value ?? 1} mana`;
    },
  },

  land_ramp: {
    id:            'land_ramp',
    label:         'Land ramp (fetch/put into play)',
    category:      'ramp',
    validTimings:  ['etb', 'cast', 'upkeep'],
    permanentOnly: false,
    defaultTier:   'track_only',
    fields: [
      { key: 'value', widget: 'number', label: 'Lands', min: 1, max: 5, default: 1 },
    ],
    defaultValues: () => ({ value: 1 }),
    describe(tag) {
      return `${tag.timing}: fetch ${tag.value ?? 1} land(s)`;
    },
  },

  ritual: {
    id:            'ritual',
    label:         'Ritual (one-time mana burst)',
    category:      'ramp',
    validTimings:  ['cast'],
    permanentOnly: false,
    defaultTier:   'track_only',
    fields: [
      { key: 'value', widget: 'number', label: 'Mana', min: 1, max: 20, default: 3 },
    ],
    defaultValues: () => ({ value: 3 }),
    describe(tag) {
      return `cast: +${tag.value ?? 3} mana (ritual)`;
    },
  },

};

/** Ordered array for populating dropdowns */
export const EFFECT_TYPE_OPTIONS = Object.values(EFFECT_TYPES);
