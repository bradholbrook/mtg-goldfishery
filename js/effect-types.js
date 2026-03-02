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
    validTimings:  ['etb', 'land_etb', 'creature_etb', 'upkeep', 'cast', 'tap', 'death', 'draw_step', 'passive'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields: [
      { key: 'value', widget: 'number', label: 'Cards', min: 1, max: 20, default: 1 },
    ],
    defaultValues: () => ({ value: 1, expectedValue: null }),
    describe(tag) {
      const cond = tag.isConditional ? ' (may)' : '';
      const v    = tag.expectedValue != null ? Math.floor(tag.expectedValue) : (tag.value ?? 1);
      return `draw ${v}${cond}   ${tag.timing}`;
    },
  },

  loot: {
    id:            'loot',
    label:         'Loot (draw, then discard)',
    category:      'draw',
    validTimings:  ['etb', 'land_etb', 'creature_etb', 'upkeep', 'cast', 'tap', 'death', 'passive'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields: [
      { key: 'value',        widget: 'number', label: 'Draw',    min: 1, max: 10, default: 1 },
      { key: 'discardCount', widget: 'number', label: 'Discard', min: 1, max: 10, default: 1 },
    ],
    defaultValues: () => ({ value: 1, discardCount: 1, isAdditionalCost: false }),
    describe(tag) {
      const v = tag.value ?? 1;
      const d = tag.discardCount ?? 1;
      const cost = tag.isAdditionalCost ? ' (cost)' : '';
      return `loot draw ${v} / discard ${d}${cost} @ ${tag.timing}`;
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
      const v = tag.expectedValue != null ? Math.floor(tag.expectedValue) : (tag.value ?? 1);
      return `tap: +${v} mana`;
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
      const v = tag.expectedValue != null ? Math.floor(tag.expectedValue) : (tag.value ?? 1);
      return `${tag.timing}: fetch ${v} land(s)`;
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
      const v = tag.expectedValue != null ? Math.floor(tag.expectedValue) : (tag.value ?? 3);
      return `cast: +${v} mana (ritual)`;
    },
  },

};

/** Ordered array for populating dropdowns */
export const EFFECT_TYPE_OPTIONS = Object.values(EFFECT_TYPES);
