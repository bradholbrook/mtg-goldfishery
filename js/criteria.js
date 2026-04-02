/**
 * MTG Goldfish Simulator - Criterion Type Registry
 *
 * A "Good Hand Definition" is a named set of criteria.
 * Each criterion has a type (from this registry) plus type-specific values.
 *
 * ─── HOW TO ADD A NEW CRITERION TYPE ────────────────────────────────────────
 * Add one entry to CRITERION_TYPES below. Nothing else changes:
 * the UI, editor, simulator, and save/load all read from this registry.
 *
 * Field widget types:
 *   'number'           → <input type="number">
 *   'type_select'      → legacy <select> with CARD_TYPES
 *   'mv_select'        → legacy <select> for max MV
 *   'types_multiselect'→ popup multiselect of CARD_TYPES
 *   'mv_multiselect'   → popup multiselect of MV values (0–6+)
 *   'cards_multiselect'→ popup multiselect of deck card names
 *   'tags_multiselect' → popup multiselect of deck moxTags
 */

import { CARD_TYPES } from './types.js';

export const CRITERION_TYPES = {

  at_least_type: {
    // Legacy single-type criterion — kept for backward compat with old saves.
    // Not shown in CRITERION_TYPE_OPTIONS; use at_least_n_of_types instead.
    id:    'at_least_type',
    label: 'Card type (legacy)',
    fields: [
      { key: 'count',    widget: 'number',     label: 'Count', min: 1, max: 7 },
      { key: 'cardType', widget: 'type_select', label: 'Type' },
    ],
    defaultValues: () => ({ count: 2, cardType: 'Land' }),
    evaluate(criterion, hand) {
      const n = hand.filter(c => Array.isArray(c.types) && c.types.includes(criterion.cardType)).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      return `≥${criterion.count || 1} ${criterion.cardType || 'Land'}`;
    },
  },

  at_least_n_of_types: {
    // Legacy — kept for backward compat. Use types_and_tags instead.
    id:    'at_least_n_of_types',
    label: 'Card type(s)',
    fields: [
      { key: 'count',     widget: 'number',           label: 'Count', min: 1, max: 7 },
      { key: 'cardTypes', widget: 'types_multiselect', label: 'Types' },
    ],
    defaultValues: () => ({ count: 2, cardTypes: ['Land'] }),
    evaluate(criterion, hand) {
      const types = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      if (!types.length) return false;
      const n = hand.filter(c =>
        Array.isArray(c.types) && c.types.some(t => types.includes(t))
      ).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const types = Array.isArray(criterion.cardTypes) && criterion.cardTypes.length
        ? criterion.cardTypes.join(' or ')
        : '(no types)';
      return `≥${criterion.count || 1} ${types}`;
    },
  },

  at_least_types_at_mv: {
    // Legacy — kept for backward compat. Use types_and_tags_at_mv instead.
    id:    'at_least_types_at_mv',
    label: 'Card type(s) at MV',
    fields: [
      { key: 'count',     widget: 'number',           label: 'Count', min: 1, max: 7 },
      { key: 'cardTypes', widget: 'types_multiselect', label: 'Types' },
      { key: 'mvValues',  widget: 'mv_multiselect',    label: 'MV', prefix: 'at MV' },
    ],
    defaultValues: () => ({ count: 1, cardTypes: ['Land'], mvValues: [] }),
    evaluate(criterion, hand) {
      const types  = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      const mvs    = Array.isArray(criterion.mvValues)  ? criterion.mvValues  : [];
      if (!types.length) return false;
      const n = hand.filter(c => {
        if (!Array.isArray(c.types) || !c.types.some(t => types.includes(t))) return false;
        if (!mvs.length) return true;
        return mvs.some(mv => {
          if (mv === '6+') return c.cmc != null && c.cmc >= 6;
          return c.cmc != null && c.cmc === Number(mv);
        });
      }).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const types = Array.isArray(criterion.cardTypes) && criterion.cardTypes.length
        ? criterion.cardTypes.join(' or ') : '(no types)';
      const mvs = Array.isArray(criterion.mvValues) && criterion.mvValues.length
        ? ' at MV ' + criterion.mvValues.join('/') : '';
      return `≥${criterion.count || 1} ${types}${mvs}`;
    },
  },

  has_mana_rock: {
    // Kept for backward compat — not shown in dropdown.
    id:    'has_mana_rock',
    label: 'Has mana rock(s)',
    fields: [
      { key: 'count', widget: 'number',   label: 'Count', min: 1, max: 7 },
      { key: 'maxMv', widget: 'mv_select', label: 'MV' },
    ],
    defaultValues: () => ({ count: 1, maxMv: 'any' }),
    evaluate(criterion, hand) {
      const maxMv = criterion.maxMv ?? 'any';
      const n = hand.filter(c =>
        !c.isMDFC &&
        !c.types?.some(t => t.toLowerCase() === 'land') &&
        c.effectTags?.some(t => t.category === 'ramp' && t.subtype === 'mana_rock') &&
        (maxMv === 'any' || (c.cmc != null && c.cmc <= Number(maxMv)))
      ).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const mv = criterion.maxMv && criterion.maxMv !== 'any' ? ` MV≤${criterion.maxMv}` : '';
      return `≥${criterion.count || 1} mana rock${(criterion.count || 1) !== 1 ? 's' : ''}${mv}`;
    },
  },

  types_and_tags: {
    id:    'types_and_tags',
    label: 'Types/Tags',
    fields: [
      { key: 'count',          widget: 'number',                    label: 'Count', min: 1, max: 7 },
      { key: 'types_and_tags', widget: 'types_and_tags_multiselect' },
      { key: 'subtypes',       widget: 'subtypes_multiselect' },
      { key: 'mvValues',       widget: 'mv_multiselect',            label: 'MV', prefix: 'at MV' },
    ],
    defaultValues: () => ({ count: 1, cardTypes: [], subtypes: [], tagNames: [], mvValues: [] }),
    evaluate(criterion, hand) {
      const types    = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      const subtypes = Array.isArray(criterion.subtypes)  ? criterion.subtypes  : [];
      const tags     = Array.isArray(criterion.tagNames)  ? criterion.tagNames  : [];
      const mvs      = Array.isArray(criterion.mvValues)  ? criterion.mvValues  : [];
      // Empty types+tags+subtypes → matches any card; empty mvs → any MV
      const n = hand.filter(c => {
        const typeOk    = !types.length    || (Array.isArray(c.types)    && c.types.some(t => types.includes(t)));
        const subtypeOk = !subtypes.length || (Array.isArray(c.subtypes) && c.subtypes.some(s => subtypes.includes(s)));
        const tagOk     = !tags.length     || (Array.isArray(c.moxTags)  && c.moxTags.some(t => tags.includes(t)));
        if (!typeOk || !subtypeOk || !tagOk) return false;
        if (!mvs.length) return true;
        return mvs.some(mv => mv === '6+' ? c.cmc != null && c.cmc >= 6 : c.cmc != null && c.cmc === Number(mv));
      }).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const types    = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      const subtypes = Array.isArray(criterion.subtypes)  ? criterion.subtypes  : [];
      const tags     = Array.isArray(criterion.tagNames)  ? criterion.tagNames  : [];
      const mvs      = Array.isArray(criterion.mvValues)  ? criterion.mvValues  : [];
      const parts = [];
      if (types.length) {
        parts.push(subtypes.length ? `${types.join('/')} [${subtypes.join('/')}]` : types.join('/'));
      } else if (subtypes.length) {
        parts.push(`[${subtypes.join('/')}]`);
      }
      if (tags.length) parts.push(tags.join('/'));
      const mvStr = mvs.length ? ' @ MV ' + mvs.join('/') : '';
      return `≥${criterion.count || 1} ${parts.length ? parts.join(' & ') : 'any'}${mvStr}`;
    },
  },

  types_and_tags_at_mv: {
    id:    'types_and_tags_at_mv',
    label: 'Types/Tags at MV',
    fields: [
      { key: 'count',          widget: 'number',                    label: 'Count', min: 1, max: 7 },
      { key: 'types_and_tags', widget: 'types_and_tags_multiselect' },
      { key: 'subtypes',       widget: 'subtypes_multiselect' },
      { key: 'mvValues',       widget: 'mv_multiselect',            label: 'MV', prefix: 'at MV' },
    ],
    defaultValues: () => ({ count: 1, cardTypes: [], subtypes: [], tagNames: [], mvValues: [] }),
    evaluate(criterion, hand) {
      const types    = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      const subtypes = Array.isArray(criterion.subtypes)  ? criterion.subtypes  : [];
      const tags     = Array.isArray(criterion.tagNames)  ? criterion.tagNames  : [];
      const mvs      = Array.isArray(criterion.mvValues)  ? criterion.mvValues  : [];
      if (!types.length && !subtypes.length && !tags.length) return false;
      const n = hand.filter(c => {
        const typeOk    = !types.length    || (Array.isArray(c.types)    && c.types.some(t => types.includes(t)));
        const subtypeOk = !subtypes.length || (Array.isArray(c.subtypes) && c.subtypes.some(s => subtypes.includes(s)));
        const tagOk     = !tags.length     || (Array.isArray(c.moxTags)  && c.moxTags.some(t => tags.includes(t)));
        if (!typeOk || !subtypeOk || !tagOk) return false;
        if (!mvs.length) return true;
        return mvs.some(mv => {
          if (mv === '6+') return c.cmc != null && c.cmc >= 6;
          return c.cmc != null && c.cmc === Number(mv);
        });
      }).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const types    = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
      const subtypes = Array.isArray(criterion.subtypes)  ? criterion.subtypes  : [];
      const tags     = Array.isArray(criterion.tagNames)  ? criterion.tagNames  : [];
      const mvs      = Array.isArray(criterion.mvValues)  ? criterion.mvValues  : [];
      const parts = [];
      if (types.length) {
        parts.push(subtypes.length ? `${types.join('/')} [${subtypes.join('/')}]` : types.join('/'));
      } else if (subtypes.length) {
        parts.push(`[${subtypes.join('/')}]`);
      }
      if (tags.length) parts.push(tags.join('/'));
      const label = parts.length ? parts.join(' & ') : '(nothing selected)';
      const mvStr = mvs.length ? ' at MV ' + mvs.join('/') : '';
      return `≥${criterion.count || 1} ${label}${mvStr}`;
    },
  },

  n_of_cards: {
    id:    'n_of_cards',
    label: 'Cards',
    fields: [
      { key: 'count',     widget: 'number',           label: 'Count', min: 1, max: 7 },
      { key: 'cardNames', widget: 'cards_multiselect', label: 'Cards' },
    ],
    defaultValues: () => ({ count: 1, cardNames: [] }),
    evaluate(criterion, hand) {
      const names = Array.isArray(criterion.cardNames) ? criterion.cardNames : [];
      if (!names.length) return false;
      const n = hand.filter(c => names.includes(c.name)).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const names = Array.isArray(criterion.cardNames) && criterion.cardNames.length
        ? criterion.cardNames.join(' / ')
        : '(no cards selected)';
      return `≥${criterion.count || 1} of: ${names}`;
    },
  },

  has_category: {
    // Legacy — kept for backward compat. Use types_and_tags instead.
    id:    'has_category',
    label: 'Tag(s)',
    fields: [
      { key: 'count',    widget: 'number',          label: 'Count', min: 1, max: 7 },
      { key: 'tagNames', widget: 'tags_multiselect', label: 'Tags' },
    ],
    defaultValues: () => ({ count: 1, tagNames: [] }),
    evaluate(criterion, hand) {
      // Support both new tagNames[] and legacy category string
      const tags = Array.isArray(criterion.tagNames) && criterion.tagNames.length
        ? criterion.tagNames
        : (criterion.category ? [criterion.category] : []);
      if (!tags.length) return false;
      const n = hand.filter(c => Array.isArray(c.moxTags) && c.moxTags.some(t => tags.includes(t))).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      const tags = Array.isArray(criterion.tagNames) && criterion.tagNames.length
        ? criterion.tagNames.join(' or ')
        : (criterion.category || '(none)');
      return `≥${criterion.count || 1} tagged: ${tags}`;
    },
  },

};

/** Active criterion types shown in the dropdown (legacy types omitted) */
export const CRITERION_TYPE_OPTIONS = [
  CRITERION_TYPES.types_and_tags,
  CRITERION_TYPES.n_of_cards,
];

/**
 * Evaluate all criteria in a good hand definition against a drawn hand.
 * Returns true only if ALL criteria pass (AND logic).
 *
 * @param {GoodHandDef} def
 * @param {Card[]} hand  - flat array of single-card objects (quantity=1 each)
 * @returns {boolean}
 */
export function evaluateGoodHandDef(def, hand) {
  if (!def?.criteria?.length) return false;
  return def.criteria.every(criterion => {
    const type = CRITERION_TYPES[criterion.type];
    return type ? type.evaluate(criterion, hand) : false;
  });
}
