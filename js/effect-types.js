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
    validTimings:  ['etb', 'land_etb', 'creature_etb', 'upkeep', 'cast', 'tap', 'death', 'draw_step', 'on_draw', 'end_step', 'sacrifice', 'combat_damage', 'opponent_cast', 'opponent_draw', 'attack', 'on_resolution'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields: [
      { key: 'value', widget: 'number', label: 'Cards', min: 1, max: 20, default: 1 },
    ],
    defaultValues: () => ({ value: 1, expectedValue: null }),
    describe(tag) {
      const cond = tag.isConditional ? ' (may)' : '';
      const v    = tag.expectedValue != null ? Math.floor(tag.expectedValue) : (tag.value ?? 1);
      if (tag.timing === 'on_resolution') return `draw ${v}${cond}`;
      return `draw ${v}${cond}   ${tag.timing}`;
    },
  },

  loot: {
    id:            'loot',
    label:         'Loot (draw, then discard)',
    category:      'draw',
    validTimings:  ['etb', 'land_etb', 'creature_etb', 'upkeep', 'cast', 'tap', 'death', 'draw_step', 'on_draw', 'end_step', 'sacrifice', 'combat_damage', 'opponent_cast', 'opponent_draw', 'attack', 'on_resolution'],
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
      if (tag.timing === 'on_resolution') return `loot draw ${v} / discard ${d}${cost}`;
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
    defaultTier:   'simulatable',
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

/** Human-readable labels for timing values, used in editor dropdowns */
export const TIMING_LABELS = {
  etb:            'Triggered: Self ETB',
  land_etb:       'Triggered: Land ETB',
  creature_etb:   'Triggered: Creature ETB',
  cast:           'Triggered: Spell cast',
  death:          'Triggered: Death',
  upkeep:         'Triggered: Upkeep',
  draw_step:      'Triggered: Draw step (beginning of)',
  on_draw:        'Triggered: Whenever you draw',
  end_step:       'Triggered: End step',
  on_resolution:  'On resolution',
  opponent_cast:  'Triggered: Opponent casts',
  opponent_draw:  'Triggered: Opponent draws',
  attack:         'Triggered: Attacks',
  combat_damage:  'Triggered: Combat damage',
  sacrifice:      'Triggered: Sacrifice',
  tap:            'Activated: Tap',
  passive:        'On resolution (legacy)',
};

/** Cast spell-type filter options for the editor dropdown */
export const CAST_FILTER_OPTIONS = [
  { key: 'any',             label: 'Any spell' },
  { key: 'creature',        label: 'Creature' },
  { key: 'noncreature',     label: 'Noncreature' },
  { key: 'instant_sorcery', label: 'Instant or Sorcery' },
  { key: 'artifact',        label: 'Artifact' },
  { key: 'enchantment',     label: 'Enchantment' },
  { key: 'planeswalker',    label: 'Planeswalker' },
  { key: 'commander',       label: 'Your commander' },
];

/**
 * Map a cast filter dropdown key to a TriggerFilter object (or null for "any").
 * @param {string} key
 * @returns {import('./types.js').TriggerFilter|null}
 */
export function resolveCastFilter(key) {
  switch (key) {
    case 'creature':        return { spellTypes: ['Creature'],          excludeTypes: null,         isCommander: false };
    case 'noncreature':     return { spellTypes: null,                  excludeTypes: ['Creature'], isCommander: false };
    case 'instant_sorcery': return { spellTypes: ['Instant','Sorcery'], excludeTypes: null,         isCommander: false };
    case 'artifact':        return { spellTypes: ['Artifact'],          excludeTypes: null,         isCommander: false };
    case 'enchantment':     return { spellTypes: ['Enchantment'],       excludeTypes: null,         isCommander: false };
    case 'planeswalker':    return { spellTypes: ['Planeswalker'],      excludeTypes: null,         isCommander: false };
    case 'commander':       return { spellTypes: null,                  excludeTypes: null,         isCommander: true  };
    default:                return null; // 'any' = no filter
  }
}

/**
 * Read the current cast filter key from a TriggerFilter object.
 * @param {import('./types.js').TriggerFilter|null} tf
 * @returns {string}
 */
export function getCastFilterKey(tf) {
  if (!tf) return 'any';
  if (tf.isCommander) return 'commander';
  if (tf.excludeTypes?.includes('Creature')) return 'noncreature';
  if (tf.spellTypes?.includes('Instant') && tf.spellTypes?.includes('Sorcery')) return 'instant_sorcery';
  if (tf.spellTypes?.length === 1) return tf.spellTypes[0].toLowerCase();
  return 'any';
}
