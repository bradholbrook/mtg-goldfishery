/**
 * MTG Goldfish Simulator - Save / Load Manager
 *
 * All persistence is via JSON file download/upload.
 * No server, no localStorage (for now — localStorage can be added as a cache later).
 *
 * Save file schema: SaveFile (see types.js)
 */

import { CURRENT_SAVE_VERSION } from './types.js';

// ─── In-Memory App State ──────────────────────────────────────────────────────

/**
 * The single source of truth for app state.
 * This is what gets serialized to/from the save file.
 */
let appState = {
  version: CURRENT_SAVE_VERSION,
  savedAt: null,
  decks: [],         // DeckConfig[]
  results: [],       // SimulationResults[]
};

export function getAppState() {
  return appState;
}

export function getDecks() {
  return appState.decks;
}

export function getResults() {
  return appState.results;
}

export function getDeckById(id) {
  return appState.decks.find(d => d.id === id) || null;
}

export function getResultsForDeck(deckId) {
  return appState.results.filter(r => r.deckId === deckId);
}

// ─── Deck Management ─────────────────────────────────────────────────────────

/**
 * Add a parsed deck to app state.
 * Replaces existing deck with same ID if present.
 */
export function addDeck(deck) {
  const idx = appState.decks.findIndex(d => d.id === deck.id);
  if (idx >= 0) {
    appState.decks[idx] = deck;
  } else {
    appState.decks.push(deck);
  }
}

export function renameDeck(deckId, newName) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  deck.name = newName.trim() || deck.name;
}

export function removeDeck(deckId) {
  appState.decks = appState.decks.filter(d => d.id !== deckId);
  // Optionally keep results for deleted decks (they reference deckId)
  // For now, prune them too
  appState.results = appState.results.filter(r => r.deckId !== deckId);
}

// ─── Results Management ───────────────────────────────────────────────────────

/**
 * Add simulation results to app state.
 * Keeps only the last 10 result sets per deck to avoid unbounded growth.
 */
export function addResults(results) {
  appState.results.push(results);

  // Prune old results for same deck — keep latest 10
  const deckResults = appState.results.filter(r => r.deckId === results.deckId);
  if (deckResults.length > 10) {
    const toRemove = deckResults.slice(0, deckResults.length - 10);
    const removeIds = new Set(toRemove.map(r => r.simulatedAt));
    appState.results = appState.results.filter(
      r => r.deckId !== results.deckId || !removeIds.has(r.simulatedAt)
    );
  }
}

// ─── Save to File ─────────────────────────────────────────────────────────────

/**
 * Serialize app state to JSON and trigger a file download.
 * Raw hand data is stripped before saving (it's large and re-generatable).
 */
export function saveToFile() {
  const saveData = {
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    decks: appState.decks,
    // Strip raw hands array from results (summary is enough for persistence)
    results: appState.results.map(r => ({
      ...r,
      hands: [],  // Don't persist raw hand data — too large, re-runnable
    })),
  };

  const json = JSON.stringify(saveData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = buildSaveFilename(appState.decks);
  a.click();

  URL.revokeObjectURL(url);
  return saveData;
}

// ─── Load from File ───────────────────────────────────────────────────────────

/**
 * Load app state from a JSON file the user selects.
 * Returns a Promise that resolves with the loaded state, or rejects with an error.
 *
 * @param {File} file
 * @returns {Promise<{decks: number, results: number}>}
 */
export function loadFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const { loaded, warnings } = mergeLoadedData(data);
        resolve({ ...loaded, warnings });
      } catch (err) {
        reject(new Error(`Failed to parse save file: ${err.message}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

/**
 * Merge loaded save data into current app state.
 * Strategy: loaded decks/results are added; existing ones with same ID are replaced.
 */
function mergeLoadedData(data) {
  const warnings = [];

  if (!data.version) {
    warnings.push('Save file has no version field — it may be from an older format.');
  }

  if (data.version && data.version !== CURRENT_SAVE_VERSION) {
    warnings.push(`Save file version ${data.version} differs from current ${CURRENT_SAVE_VERSION}. Loading anyway.`);
  }

  let decksLoaded = 0;
  let resultsLoaded = 0;

  if (Array.isArray(data.decks)) {
    for (const deck of data.decks) {
      if (deck && deck.id && deck.cards) {
        // Migrate: auto-detected opponent_cast/draw draw tags that previously saved as
        // track_only (before the simulatable fix) should now be simulatable when the
        // detection criteria are met (concrete, non-conditional value ≥ 1).
        for (const card of deck.cards) {
          for (const tag of (card.effectTags ?? [])) {
            if (tag.source !== 'auto') continue;
            if (tag.category !== 'draw') continue;
            if (!['opponent_cast', 'opponent_draw'].includes(tag.timing)) continue;
            if (!tag.isConditional && tag.value != null && tag.value >= 1) {
              tag.tier = 'simulatable';
            }
          }
        }
        addDeck(deck);
        decksLoaded++;
      } else {
        warnings.push(`Skipped a malformed deck entry.`);
      }
    }
  }

  if (Array.isArray(data.results)) {
    for (const result of data.results) {
      if (result && result.deckId) {
        appState.results.push(result);
        resultsLoaded++;
      }
    }
  }

  return {
    loaded: { decks: decksLoaded, results: resultsLoaded },
    warnings,
  };
}

// ─── Good Hand Definitions ────────────────────────────────────────────────────

/**
 * Upsert a GoodHandDef on the deck identified by deckId.
 * If def.id already exists it's replaced; otherwise it's appended.
 */
export function updateDeckGoodHandDefs(deckId, def) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  if (!Array.isArray(deck.goodHandDefs)) deck.goodHandDefs = [];
  const idx = deck.goodHandDefs.findIndex(d => d.id === def.id);
  if (idx >= 0) {
    deck.goodHandDefs[idx] = def;
  } else {
    deck.goodHandDefs.push(def);
  }
}

/**
 * Remove a GoodHandDef by id from the specified deck.
 */
export function removeGoodHandDef(deckId, defId) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck?.goodHandDefs) return;
  deck.goodHandDefs = deck.goodHandDefs.filter(d => d.id !== defId);
}

// ─── X Costs ──────────────────────────────────────────────────────────────────

/**
 * Merge an individual X cost update into the deck's xCosts map.
 * Pass value=null to remove an entry.
 */
export function updateDeckXCost(deckId, cardName, value) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  if (!deck.xCosts) deck.xCosts = {};
  if (value === null || value === undefined) {
    delete deck.xCosts[cardName];
  } else {
    deck.xCosts[cardName] = value;
  }
}

// ─── Discard Priorities ───────────────────────────────────────────────────────

/**
 * Replace the full discardPriorities array on a deck.
 */
export function updateDeckDiscardPriorities(deckId, priorities) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  deck.discardPriorities = priorities;
}

// ─── Cast Priority Rules ──────────────────────────────────────────────────────

/**
 * Replace the full castPriorityRules array on a deck.
 */
export function updateDeckCastPriorityRules(deckId, rules) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  deck.castPriorityRules = rules;
}

// ─── Tutor Priority Rules ─────────────────────────────────────────────────────

/**
 * Replace the full tutorPriorityRules array on a deck.
 */
export function updateDeckTutorPriorityRules(deckId, rules) {
  const deck = appState.decks.find(d => d.id === deckId);
  if (!deck) return;
  deck.tutorPriorityRules = rules;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateForFilename(date) {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}

/**
 * Build a save filename that includes deck names and a timestamp.
 * e.g. "mtg-goldfish-raffine-reanimator-2026-02-21-1430.json"
 */
function buildSaveFilename(decks) {
  const stamp = formatDateForFilename(new Date());
  if (!decks.length) return `mtg-goldfish-${stamp}.json`;
  const nameSlug = decks
    .slice(0, 3)
    .map(d => d.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20))
    .filter(Boolean)
    .join('_');
  return `mtg-goldfish-${nameSlug || 'decks'}-${stamp}.json`;
}
