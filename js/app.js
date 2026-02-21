/**
 * MTG Goldfish Simulator - App Entry Point
 *
 * Wires together: parser → storage → simulator → ui
 * Handles all user events.
 */

import { parseMoxfieldDecklist } from './parser.js';
import { runSimulation } from './simulator.js';
import {
  addDeck, removeDeck, addResults,
  getDeckById, saveToFile, loadFromFile,
} from './storage.js';
import {
  renderDeckList, renderActiveDeck, renderSimResults, showToast,
} from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────

let activeDeckId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindImportPanel();
  bindSaveLoad();
  refresh();
});

// ─── Refresh (re-render everything from state) ────────────────────────────────

function refresh() {
  renderDeckList(handleSelectDeck, handleDeleteDeck);
  renderActiveDeck(getDeckById(activeDeckId), handleRunSimulation);
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

function bindImportPanel() {
  const importBtn = document.getElementById('import-btn');
  const importTextarea = document.getElementById('import-textarea');
  const importNameInput = document.getElementById('import-name');
  const importToggle = document.getElementById('import-toggle');
  const importPanel = document.getElementById('import-panel');

  // Toggle panel
  importToggle?.addEventListener('click', () => {
    importPanel.classList.toggle('hidden');
    importToggle.textContent = importPanel.classList.contains('hidden')
      ? '+ Import Deck' : '− Cancel';
  });

  importBtn?.addEventListener('click', () => {
    const text = importTextarea?.value?.trim();
    if (!text) {
      showToast('Paste a decklist first.', 'warn');
      return;
    }

    const name = importNameInput?.value?.trim() || 'Unnamed Deck';
    const { deck, errors } = parseMoxfieldDecklist(text, name);

    if (errors.length > 0) {
      errors.forEach(e => showToast(e, 'warn'));
    }

    if (deck.cards.length === 0) {
      showToast('Could not parse any cards. Check the format.', 'error');
      return;
    }

    addDeck(deck);
    activeDeckId = deck.id;

    // Clear form and hide panel
    if (importTextarea) importTextarea.value = '';
    if (importNameInput) importNameInput.value = '';
    importPanel?.classList.add('hidden');
    if (importToggle) importToggle.textContent = '+ Import Deck';

    showToast(`Imported "${deck.name}" — ${deck.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
    refresh();
  });
}

// ─── Deck Selection ───────────────────────────────────────────────────────────

function handleSelectDeck(deckId) {
  activeDeckId = deckId;

  // Highlight selected card
  document.querySelectorAll('.deck-card').forEach(el => {
    el.classList.toggle('deck-card--active', el.dataset.deckId === deckId);
  });

  renderActiveDeck(getDeckById(deckId), handleRunSimulation);

  // Show latest results if any
  const { getResultsForDeck } = window._storage || {};
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

// ─── Simulation ───────────────────────────────────────────────────────────────

function handleRunSimulation(deckId, gameCount) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  const btn = document.getElementById('run-sim-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Simulating…'; }

  // Defer to next tick so the UI updates before the heavy loop
  setTimeout(() => {
    try {
      const results = runSimulation(deck, gameCount);
      addResults(results);
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
      const { loaded, warnings } = await loadFromFile(file);
      warnings?.forEach(w => showToast(w, 'warn'));
      showToast(`Loaded ${loaded.decks} deck(s), ${loaded.results} result(s).`, 'success');

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
