/**
 * mullstat - Category Configuration
 *
 * Manages user-editable categories and otag→category mappings.
 * Config is stored in localStorage and persists across sessions.
 * Defaults mirror CANONICAL_CATEGORIES and OTAG_TO_CATEGORY from tagger.js.
 */

import { OTAG_TO_CATEGORY } from './tagger.js';

const STORAGE_KEY = 'mullstat_category_config_v1';

// Default categories with display colors
export const DEFAULT_CATEGORIES = [
  { name: 'Ramp',        color: '#4ade80' },  // lime green
  { name: 'Mana Rock',   color: '#fcd34d' },  // warm yellow
  { name: 'Mana Dork',   color: '#5eead4' },  // teal
  { name: 'Card Draw',   color: '#60a5fa' },  // blue
  { name: 'Interaction', color: '#f87171' },  // red
  { name: 'Board Wipe',  color: '#c084fc' },  // violet
  { name: 'Tutor',       color: '#fb7185' },  // rose
  { name: 'Mill',        color: '#94a3b8' },  // slate
  { name: 'Cascade',     color: '#fb923c' },  // orange
  { name: 'Discover',    color: '#e879f9' },  // fuchsia
];

/**
 * @typedef {Object} CategoryDef
 * @property {string} name
 * @property {string} color   - hex color
 */

/**
 * @typedef {Object} CategoryConfig
 * @property {CategoryDef[]} categories       - ordered list; user can add/reorder/rename
 * @property {Object.<string,string|null>} otagOverrides
 *   - slug → category name (override default mapping)
 *   - slug → null (remove slug from all categories)
 */

/**
 * Read the stored config from localStorage, filling gaps with defaults.
 * @returns {CategoryConfig}
 */
export function getCategoryConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored && Array.isArray(stored.categories)) return stored;
    }
  } catch { /* ignore */ }
  return { categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), otagOverrides: {} };
}

/**
 * Save a config object to localStorage.
 * @param {CategoryConfig} config
 */
function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

/**
 * Returns the current list of categories (user-defined order, merged with defaults).
 * @returns {CategoryDef[]}
 */
export function getEffectiveCategories() {
  const config = getCategoryConfig();
  // Ensure all defaults exist (additive — never removes user categories)
  const names = new Set(config.categories.map(c => c.name));
  const merged = [...config.categories];
  for (const def of DEFAULT_CATEGORIES) {
    if (!names.has(def.name)) merged.push({ ...def });
  }
  return merged;
}

/**
 * Returns category names as a plain string array (for dropdown use).
 * @returns {string[]}
 */
export function getEffectiveCategoryNames() {
  return getEffectiveCategories().map(c => c.name);
}

/**
 * Returns the merged otag slug → category name map.
 * User overrides take precedence; null overrides remove a slug.
 * @returns {Object.<string, string>}
 */
export function getEffectiveOtagMappings() {
  const config = getCategoryConfig();
  const result = { ...OTAG_TO_CATEGORY };
  for (const [slug, cat] of Object.entries(config.otagOverrides || {})) {
    if (cat === null) {
      delete result[slug];
    } else {
      result[slug] = cat;
    }
  }
  return result;
}

/**
 * Add a new category. No-op if name already exists.
 * @param {string} name
 * @param {string} [color='#94a3b8']
 */
export function addCategory(name, color = '#94a3b8') {
  if (!name?.trim()) return;
  const config = getCategoryConfig();
  if (!config.categories.find(c => c.name === name)) {
    config.categories.push({ name: name.trim(), color });
    saveConfig(config);
  }
}

/**
 * Remove a category by name. Also removes any otag overrides pointing to it.
 * @param {string} name
 */
export function removeCategory(name) {
  const config = getCategoryConfig();
  config.categories = config.categories.filter(c => c.name !== name);
  // Remove overrides pointing to this category
  for (const [slug, cat] of Object.entries(config.otagOverrides || {})) {
    if (cat === name) delete config.otagOverrides[slug];
  }
  saveConfig(config);
}

/**
 * Rename a category.
 * @param {string} oldName
 * @param {string} newName
 */
export function renameCategory(oldName, newName) {
  if (!newName?.trim() || oldName === newName) return;
  const config = getCategoryConfig();
  const cat = config.categories.find(c => c.name === oldName);
  if (cat) {
    cat.name = newName.trim();
    // Update any overrides pointing to old name
    for (const slug of Object.keys(config.otagOverrides || {})) {
      if (config.otagOverrides[slug] === oldName) config.otagOverrides[slug] = newName.trim();
    }
    saveConfig(config);
  }
}

/**
 * Update a category's color.
 * @param {string} name
 * @param {string} color
 */
export function setCategoryColor(name, color) {
  const config = getCategoryConfig();
  const cat = config.categories.find(c => c.name === name);
  if (cat) { cat.color = color; saveConfig(config); }
}

/**
 * Map an otag slug to a category (override or add).
 * @param {string} slug
 * @param {string} categoryName
 */
export function setOtagMapping(slug, categoryName) {
  const config = getCategoryConfig();
  if (!config.otagOverrides) config.otagOverrides = {};
  config.otagOverrides[slug] = categoryName;
  saveConfig(config);
}

/**
 * Remove a slug from all category mappings (sets override to null).
 * @param {string} slug
 */
export function removeOtagMapping(slug) {
  const config = getCategoryConfig();
  if (!config.otagOverrides) config.otagOverrides = {};
  config.otagOverrides[slug] = null;
  saveConfig(config);
}

/**
 * Reset all overrides to defaults.
 */
export function resetCategoryConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Export current category config as a JSON string.
 */
export function exportCategoryConfig() {
  return JSON.stringify(getCategoryConfig(), null, 2);
}

/**
 * Validate and import a category config JSON string.
 * Fixes missing protected categories before saving.
 * @param {string} jsonString
 */
export function importCategoryConfig(jsonString) {
  let loaded;
  try { loaded = JSON.parse(jsonString); } catch { throw new Error('Invalid JSON'); }
  if (!loaded?.categories || !Array.isArray(loaded.categories)) {
    throw new Error('Invalid category config: missing "categories" array');
  }
  saveConfig(fixLoadedConfig(loaded));
}

/**
 * Ensure all DEFAULT_CATEGORIES exist and protected categories have at least
 * one active otag slug pointing to them (from OTAG_TO_CATEGORY defaults).
 */
function fixLoadedConfig(config) {
  const result = {
    categories: [...(config.categories || [])],
    otagOverrides: { ...(config.otagOverrides || {}) },
  };

  // Ensure all default categories exist (add missing ones)
  const existingNames = new Set(result.categories.map(c => c.name));
  for (const def of DEFAULT_CATEGORIES) {
    if (!existingNames.has(def.name)) {
      result.categories.push({ ...def });
      existingNames.add(def.name);
    }
  }

  // Protected categories must have at least one active mapping
  const PROTECTED = ['Card Draw', 'Mill'];
  for (const protCat of PROTECTED) {
    const defaultSlugs = Object.entries(OTAG_TO_CATEGORY)
      .filter(([, cat]) => cat === protCat)
      .map(([slug]) => slug);
    if (!defaultSlugs.length) continue;

    // A slug is "active" if it's not overridden to null
    const hasActive = defaultSlugs.some(slug => result.otagOverrides[slug] !== null);
    if (!hasActive) {
      // Restore the first default slug
      result.otagOverrides[defaultSlugs[0]] = protCat;
    }
  }

  return result;
}
