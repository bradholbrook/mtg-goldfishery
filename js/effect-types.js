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

/**
 * Short timing labels used inside effect chips (space is tight).
 * null = no suffix (timing implied by describe() format or is implicit).
 */
export const TIMING_CHIP_LABELS = {
  etb:           'ETB',
  land_etb:      'landfall',
  creature_etb:  'creature ETB',
  upkeep:        'upkeep',
  cast:          'on cast',
  draw_step:     'draw step',
  on_draw:       'on draw',
  end_step:      'end step',
  on_resolution: null,        // instant/sorcery — timing is implicit
  opponent_cast: 'opp cast',
  opponent_draw: 'opp draw',
  attack:        'attack',
  combat_damage: 'damage',
  sacrifice:     'sacrifice',
  death:         'death',
  tap:           null,        // "tap: X" prefix already in describe()
  static:        null,        // always-on, no timing annotation needed
  passive:       null,        // legacy alias
};

export const EFFECT_TYPES = {

  draw_n: {
    id:            'draw_n',
    label:         'Draw N cards',
    category:      'draw',
    validTimings:  ['etb', 'land_etb', 'creature_etb', 'upkeep', 'cast', 'tap', 'death', 'draw_step', 'on_draw', 'end_step', 'sacrifice', 'combat_damage', 'opponent_cast', 'opponent_draw', 'attack', 'on_resolution'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields: [
      // min: 0 and step: 0.1 allow fractional "expected draws per trigger" for conditional effects
      { key: 'value', widget: 'number', label: 'Cards/trigger', min: 0, max: 20, step: 0.1, default: 1 },
    ],
    defaultValues: () => ({ value: 1 }),
    describe(tag) {
      const v = tag.value == null
        ? (tag.condition === 'draw X' ? 'X' : '?')
        : tag.value;
      let cond = '';
      if (tag.isConditional) {
        if (tag.condition === 'mana_payment') cond = ' [pay]';
        else if (tag.condition === 'life_payment') cond = ' [life]';
        else cond = '?';
      }
      const chipTiming = TIMING_CHIP_LABELS[tag.timing];
      if (chipTiming == null) return `draw ${v}${cond}`;
      return `draw ${v}${cond} · ${chipTiming}`;
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
      { key: 'value',        widget: 'number', label: 'Draw',    min: 0, max: 10, step: 1, default: 1 },
      { key: 'discardCount', widget: 'number', label: 'Discard', min: 0, max: 10, step: 1, default: 1 },
    ],
    defaultValues: () => ({ value: 1, discardCount: 1, isAdditionalCost: false }),
    describe(tag) {
      const v = tag.value ?? 1;
      const d = tag.discardCount ?? 1;
      const cost = tag.isAdditionalCost ? ' (cost)' : '';
      const chipTiming = TIMING_CHIP_LABELS[tag.timing];
      if (chipTiming == null) return `loot ${v}/${d}${cost}`;
      return `loot ${v}/${d}${cost} · ${chipTiming}`;
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
      const v = tag.value ?? 1;
      const chipTiming = TIMING_CHIP_LABELS[tag.timing] ?? tag.timing;
      return `ramp ${v} land${v !== 1 ? 's' : ''} · ${chipTiming}`;
    },
  },

  draw_replacement: {
    id:            'draw_replacement',
    label:         'Draw replacement (doubles draws)',
    category:      'replacement',
    validTimings:  ['static'],
    permanentOnly: true,
    defaultTier:   'simulatable',
    fields: [
      { key: 'multiplier',  widget: 'number',   label: 'Multiplier',             min: 2, max: 4, default: 2 },
      { key: 'exceptFirst', widget: 'checkbox', label: 'Except first draw/turn', default: false },
    ],
    defaultValues: () => ({ multiplier: 2, exceptFirst: false }),
    describe(tag) {
      const ex = tag.exceptFirst ? ' (except first/turn)' : '';
      return `draw ×${tag.multiplier ?? 2}${ex}`;
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
      return `+${tag.value ?? 3} mana · on cast`;
    },
  },

  tutor: {
    id:            'tutor',
    label:         'Tutor (search library)',
    category:      'tutor',
    validTimings:  ['etb', 'creature_etb', 'upkeep', 'cast', 'on_resolution', 'sacrifice', 'death'],
    permanentOnly: false,
    defaultTier:   'simulatable',
    fields:        [],
    defaultValues: () => ({
      putWhere:  'hand',
      fetchType: { any: true, nonland: false, supertype: null, type: null, subtypes: null },
    }),
    describe(tag) {
      const fc = tag.fetchType;
      let what = 'any';
      if (fc && !fc.any) {
        const parts = [];
        if (fc.supertype) parts.push(fc.supertype.toLowerCase());
        if (fc.nonland)   parts.push('nonland');
        if (fc.subtype)   parts.push(fc.subtype.toLowerCase());
        else if (fc.type) parts.push(fc.type === 'InstantOrSorcery' ? 'instant/sorc' : fc.type.toLowerCase());
        if (parts.length) what = parts.join(' ');
      }
      const where = tag.putWhere === 'battlefield' ? '→BF'
        : tag.putWhere === 'top_of_library' ? '→top'
        : '→hand';
      const chipTiming = TIMING_CHIP_LABELS[tag.timing];
      if (chipTiming == null) return `tutor ${what} ${where}`;
      return `tutor ${what} ${where} · ${chipTiming}`;
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
  static:         'Static (always-on)',
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
