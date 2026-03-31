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
 *   'card_select'  → <select> populated with every unique card in the deck
 *   'type_select'  → <select> with CARD_TYPES (Land, Creature, …)
 *   'number'       → <input type="number"> with optional min/max
 */

import { CARD_TYPES } from './types.js';

export const CRITERION_TYPES = {

  at_least_type: {
    id:    'at_least_type',
    label: 'At least N of type',
    fields: [
      { key: 'count',    widget: 'number',      label: 'Count', min: 1, max: 7 },
      { key: 'cardType', widget: 'type_select',  label: 'Type' },
    ],
    defaultValues: () => ({ count: 2, cardType: 'Land' }),
    evaluate(criterion, hand) {
      // Use types.includes() so MDFCs count toward any of their face types
      const n = hand.filter(c => Array.isArray(c.types) && c.types.includes(criterion.cardType)).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      return `≥${criterion.count || 1} ${criterion.cardType || 'Land'}`;
    },
  },

  at_least_n_of_types: {
    id:    'at_least_n_of_types',
    label: 'At least N of any of these types',
    fields: [
      { key: 'count',     widget: 'number',           label: 'Count', min: 1, max: 7 },
      { key: 'cardTypes', widget: 'types_multiselect', label: 'Types' },
    ],
    defaultValues: () => ({ count: 1, cardTypes: ['Creature'] }),
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
      return `≥${criterion.count || 1} of: ${types}`;
    },
  },

  has_mana_rock: {
    id:    'has_mana_rock',
    label: 'Has mana rock(s)',
    fields: [
      { key: 'count', widget: 'number', label: 'Count', min: 1, max: 7 },
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

  n_of_cards: {
    id:    'n_of_cards',
    label: 'N of selected cards',
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
    id:    'has_category',
    label: 'Has card(s) of category',
    fields: [
      { key: 'count',    widget: 'number',          label: 'Count', min: 1, max: 7 },
      { key: 'category', widget: 'category_select', label: 'Category' },
    ],
    defaultValues: () => ({ count: 1, category: 'Ramp' }),
    evaluate(criterion, hand) {
      const cat = criterion.category || 'Ramp';
      const n = hand.filter(c => Array.isArray(c.categories) && c.categories.includes(cat)).length;
      return n >= (Number(criterion.count) || 1);
    },
    describe(criterion) {
      return `≥${criterion.count || 1} ${criterion.category || 'Ramp'}`;
    },
  },

};

/** Ordered array for populating the type dropdown */
export const CRITERION_TYPE_OPTIONS = Object.values(CRITERION_TYPES);

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
