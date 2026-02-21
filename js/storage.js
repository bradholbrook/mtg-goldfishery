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
  a.download = `mtg-goldfish-${formatDateForFilename(new Date())}.json`;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateForFilename(date) {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}
