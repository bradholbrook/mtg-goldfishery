/**
 * MTG Goldfish Simulator - App Entry Point
 *
 * Wires together: parser → storage → simulator → ui
 * Handles all user events.
 */

import { parseMoxfieldDecklist, parseMoxfieldApiResponse } from './parser.js';
import { runSimulation } from './simulator.js';
import {
  addDeck, removeDeck, addResults,
  getDeckById, saveToFile, loadFromFile,
  updateDeckGoodHandDefs, removeGoodHandDef,
} from './storage.js';
import {
  renderDeckList, renderActiveDeck, renderSimResults, showToast,
  setImportLoading,
} from './ui.js';
import { generateId } from './types.js';
import { CRITERION_TYPES } from './criteria.js';
import { enrichDeckWithScryfall } from './enrichment.js';

// ─── State ────────────────────────────────────────────────────────────────────

let activeDeckId = null;

/**
 * When non-null, the active deck panel shows the definition editor.
 * Shape: { defId: string|null, name: string, criteria: Criterion[] }
 *   defId = null  → creating a new definition
 *   defId = uuid  → editing an existing definition
 */
let editingDef = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindImportPanel();
  bindSaveLoad();
  refresh();
});

// ─── Refresh (re-render everything from state) ────────────────────────────────

function refresh() {
  renderDeckList(handleSelectDeck, handleDeleteDeck);
  renderActiveDeck(getDeckById(activeDeckId), handleRunSimulation, editingDef, handleReenrich);
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

const MOXFIELD_URL_RE = /moxfield\.com\/decks\/([\w-]+)/i;

// Moxfield's API doesn't set CORS headers, so browsers block direct fetches.
// corsproxy.io proxies the request server-side and adds CORS headers for us.
// Swap this constant if a self-hosted proxy is added later.
const CORS_PROXY = 'https://corsproxy.io/?url=';

function logEnrichedDeck(deck) {
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  console.groupCollapsed(`[goldfishery] Enriched deck: "${deck.name}" — ${deck.cards.length} unique / ${total} total`);
  console.table(deck.cards.map(c => ({
    name:     c.name,
    qty:      c.quantity,
    types:    c.types?.join(', ') ?? '—',
    cmc:      c.cmc ?? '—',
    tags:     c.effectTags?.map(t => t.tag).join(', ') || '',
    enriched: c.enriched ?? false,
  })));
  const unenriched = deck.cards.filter(c => !c.enriched);
  if (unenriched.length) console.warn('Failed Scryfall enrichment:', unenriched.map(c => c.name));
  console.groupEnd();
}

function bindImportPanel() {
  const importBtn     = document.getElementById('import-btn');
  const importTextarea = document.getElementById('import-textarea');
  const importNameInput = document.getElementById('import-name');
  const importToggle  = document.getElementById('import-toggle');
  const importPanel   = document.getElementById('import-panel');

  function clearImportPanel() {
    if (importTextarea)  importTextarea.value = '';
    if (importNameInput) importNameInput.value = '';
    importPanel?.classList.add('hidden');
    if (importToggle) importToggle.textContent = '+ Import Deck';
  }

  // Toggle panel visibility
  importToggle?.addEventListener('click', () => {
    importPanel.classList.toggle('hidden');
    importToggle.textContent = importPanel.classList.contains('hidden')
      ? '+ Import Deck' : '− Cancel';
  });

  importBtn?.addEventListener('click', async () => {
    const text = importTextarea?.value?.trim();
    if (!text) {
      showToast('Paste a decklist or Moxfield URL first.', 'warn');
      return;
    }

    const name = importNameInput?.value?.trim() || '';
    const urlMatch = text.match(MOXFIELD_URL_RE);

    if (urlMatch) {
      // ── URL import path ──────────────────────────────────────────────────
      const publicId = urlMatch[1];
      importBtn.disabled = true;
      importBtn.textContent = '⏳ Fetching…';

      try {
        const apiUrl = `https://api2.moxfield.com/v2/decks/all/${publicId}`;
        const res = await fetch(CORS_PROXY + encodeURIComponent(apiUrl));
        if (!res.ok) throw new Error(`Moxfield returned HTTP ${res.status}`);

        const apiData = await res.json();

        const mainboardEntries = Object.values(apiData.mainboard || {});
        const { deck, errors } = parseMoxfieldApiResponse(apiData, name);
        const noTypeLine = mainboardEntries.filter(e => !e.card?.type_line);
        if (noTypeLine.length) console.warn('[goldfishery] Moxfield entries with missing type_line:', noTypeLine.map(e => e.card?.name));
        console.log(`[goldfishery] Moxfield: parsed ${deck.cards.length} unique cards (${mainboardEntries.reduce((s, e) => s + (e.quantity || 1), 0)} total)`);

        errors.forEach(e => showToast(e, 'warn'));

        if (deck.cards.length === 0) {
          showToast('Could not parse any cards from Moxfield.', 'error');
          return;
        }

        // Enrich with Scryfall data
        importBtn.textContent = '⏳ Enriching…';
        setImportLoading(true, 'Fetching card data from Scryfall…');
        let deckToSave = deck;
        try {
          deckToSave = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg));
        } catch (enrichErr) {
          showToast(`Scryfall enrichment failed: ${enrichErr.message}`, 'warn');
        }
        setImportLoading(false);

        logEnrichedDeck(deckToSave);
        addDeck(deckToSave);
        activeDeckId = deckToSave.id;
        clearImportPanel();
        showToast(`Imported "${deckToSave.name}" — ${deckToSave.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();
      } catch (err) {
        showToast(`Moxfield fetch failed: ${err.message}`, 'error');
        setImportLoading(false);
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }

    } else {
      // ── Plain-text paste path ────────────────────────────────────────────
      const { deck, errors } = parseMoxfieldDecklist(text, name || 'Unnamed Deck');

      errors.forEach(e => showToast(e, 'warn'));

      if (deck.cards.length === 0) {
        showToast('Could not parse any cards. Check the format.', 'error');
        return;
      }

      // Enrich with Scryfall data
      importBtn.disabled = true;
      importBtn.textContent = '⏳ Enriching…';
      setImportLoading(true, 'Fetching card data from Scryfall…');
      try {
        const enriched = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg));
        setImportLoading(false);

        logEnrichedDeck(enriched);
        addDeck(enriched);
        activeDeckId = enriched.id;
        clearImportPanel();
        showToast(`Imported "${enriched.name}" — ${enriched.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();
      } catch (err) {
        // Enrichment failure: still import the deck, just without enrichment
        setImportLoading(false);
        addDeck(deck);
        activeDeckId = deck.id;
        clearImportPanel();
        showToast(`Imported "${deck.name}" without enrichment (${err.message})`, 'warn');
        refresh();
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }
    }
  });
}

// ─── Deck Selection ───────────────────────────────────────────────────────────

function handleSelectDeck(deckId) {
  activeDeckId = deckId;
  editingDef = null; // clear any in-progress edit when switching decks

  document.querySelectorAll('.deck-card').forEach(el => {
    el.classList.toggle('deck-card--active', el.dataset.deckId === deckId);
  });

  renderActiveDeck(getDeckById(deckId), handleRunSimulation, editingDef, handleReenrich);
}

function handleDeleteDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  if (!confirm(`Remove "${deck.name}"?`)) return;

  removeDeck(deckId);
  if (activeDeckId === deckId) activeDeckId = null;

  showToast(`Removed "${deck.name}"`, 'info');
  refresh();
}

// ─── Good Hand Definition Actions ────────────────────────────────────────────
//
// Exposed on window.__ghh so that inline onclick= attributes in ui.js templates
// can reach them without circular imports or prop-drilling callbacks.
// All mutating actions call refresh() to re-render from the updated state.

function freshCriterion() {
  const firstType = Object.values(CRITERION_TYPES)[0];
  return { type: firstType.id, ...firstType.defaultValues() };
}

window.__ghh = {

  addDef() {
    editingDef = { defId: null, name: '', criteria: [freshCriterion()] };
    refresh();
  },

  editDef(defId) {
    const deck = getDeckById(activeDeckId);
    const def = deck?.goodHandDefs?.find(d => d.id === defId);
    if (!def) return;
    // Deep-copy so edits don't mutate the stored def until Save
    editingDef = { defId, name: def.name, criteria: def.criteria.map(c => ({ ...c })) };
    refresh();
  },

  removeDef(defId) {
    const deck = getDeckById(activeDeckId);
    if (!deck || !confirm('Remove this good hand definition?')) return;
    removeGoodHandDef(deck.id, defId);
    refresh();
  },

  saveDef() {
    if (!editingDef) return;
    // Read name directly from DOM as safety net (oninput may not fire on rapid click)
    const nameEl = document.getElementById('def-name-input');
    const name = (nameEl?.value ?? editingDef.name).trim();
    if (!name) { showToast('Give this definition a name.', 'warn'); return; }
    if (!editingDef.criteria.length) { showToast('Add at least one criterion.', 'warn'); return; }

    const deck = getDeckById(activeDeckId);
    if (!deck) return;

    updateDeckGoodHandDefs(deck.id, {
      id: editingDef.defId || generateId(),
      name,
      criteria: editingDef.criteria,
    });

    editingDef = null;
    refresh();
    showToast(`Saved "${name}"`, 'success');
  },

  cancelEdit() {
    editingDef = null;
    refresh();
  },

  addCrit() {
    if (!editingDef) return;
    editingDef.criteria.push(freshCriterion());
    refresh();
  },

  removeCrit(idx) {
    if (!editingDef) return;
    editingDef.criteria.splice(idx, 1);
    refresh();
  },

  /** Change the TYPE of a criterion — structural change, triggers re-render */
  changeType(idx, type) {
    if (!editingDef) return;
    const typeInfo = CRITERION_TYPES[type];
    if (!typeInfo) return;
    editingDef.criteria[idx] = { type, ...typeInfo.defaultValues() };
    refresh();
  },

  /** Update a criterion value — no re-render needed */
  setVal(idx, key, val) {
    if (!editingDef?.criteria[idx]) return;
    editingDef.criteria[idx][key] = val;
  },

  /** Toggle a type in/out of a criterion's cardTypes array and re-render. */
  toggleType(idx, typeName) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].cardTypes || [];
    editingDef.criteria[idx].cardTypes = current.includes(typeName)
      ? current.filter(t => t !== typeName)
      : [...current, typeName];
    refresh();
  },

  /** Update the definition name — no re-render needed */
  setName(val) {
    if (!editingDef) return;
    editingDef.name = val;
  },
};

// ─── Re-enrich ────────────────────────────────────────────────────────────────

async function handleReenrich(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  const btn = document.getElementById('reenrich-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enriching…'; }

  setImportLoading(true, 'Re-fetching card data from Scryfall…');
  try {
    const enriched = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg));
    setImportLoading(false);

    const unknownCards = enriched.cards.filter(c => !c.enriched);
    if (unknownCards.length) {
      console.warn('[goldfishery] Cards still unenriched after re-enrich:', unknownCards.map(c => c.name));
      showToast(`Re-enriched with ${unknownCards.length} card(s) still not found on Scryfall — check console for names.`, 'warn');
    } else {
      showToast('Re-enrichment complete — all cards updated.', 'success');
    }

    addDeck(enriched);
    refresh();
  } catch (err) {
    setImportLoading(false);
    showToast(`Re-enrichment failed: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Re-enrich'; }
  }
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function handleRunSimulation(deckId, gameCount) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  const btn = document.getElementById('run-sim-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Simulating…'; }

  // Defer to next tick so the UI updates before the heavy loop
  setTimeout(() => {
    try {
      const goodHandDefs = deck.goodHandDefs || [];
      const results = runSimulation(deck, gameCount, goodHandDefs);
      // Store def names alongside pcts so results panel can display them
      results.goodHandDefNames = Object.fromEntries(
        goodHandDefs.map(d => [d.id, d.name])
      );
      addResults(results);
      refresh(); // re-renders deck panel so good hand def percentages update
      renderSimResults(results);
      showToast(`Simulated ${gameCount.toLocaleString()} games`, 'success');
    } catch (err) {
      showToast(`Simulation error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run Simulation'; }
    }
  }, 20);
}

// ─── Save / Load ──────────────────────────────────────────────────────────────

function bindSaveLoad() {
  document.getElementById('save-btn')?.addEventListener('click', () => {
    try {
      saveToFile();
      showToast('Save file downloaded.', 'success');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  });

  const loadInput = document.getElementById('load-input');
  document.getElementById('load-btn')?.addEventListener('click', () => {
    loadInput?.click();
  });

  loadInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { decks: decksLoaded, results: resultsLoaded, warnings } = await loadFromFile(file);
      warnings?.forEach(w => showToast(w, 'warn'));
      showToast(`Loaded ${decksLoaded} deck(s), ${resultsLoaded} result(s).`, 'success');

      // Select first loaded deck
      const decks = (await import('./storage.js')).getDecks();
      if (decks.length > 0 && !activeDeckId) {
        activeDeckId = decks[0].id;
      }
      refresh();
    } catch (err) {
      showToast(`Load failed: ${err.message}`, 'error');
    }

    // Reset input so same file can be loaded again
    e.target.value = '';
  });
}
