/**
 * MTG Goldfish Simulator - UI Entry Point
 *
 * Thin shell: imports from js/ui/* modules, exposes the public API used by app.js.
 */

export { TYPE_COLORS } from './ui/shared.js';
export { renderDeckList } from './ui/deck-list.js';

import { escapeHtml } from './ui/shared.js';
import { buildCardsTab } from './ui/cards-tab.js';
import { buildConfigTab } from './ui/config-tab.js';
import { buildResultsTab } from './ui/results-tab.js';

// ─── Active Deck Panel ────────────────────────────────────────────────────────

export function renderActiveDeck(deck, onRunSimulation, editingDef = null, activeTab = 'overview', expandedEffectCards = new Set(), expandedTypeGroups = new Set(), simGameCount = 1000, simMaxTurns = 10) {
  const container = document.getElementById('active-deck');
  if (!container) return;

  if (!deck) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="muted">Select a deck to simulate.</p>
      </div>`;
    return;
  }

  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  const TAB_LABELS = { cards: 'Cards', config: 'Config', results: 'Simulate' };
  const resolvedTab = activeTab === 'overview' ? 'cards' : activeTab;

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="deck-title">${escapeHtml(deck.name)}</h2>
        ${deck.commander
          ? `<div class="muted" style="margin-top:2px">Commander: <strong>${escapeHtml(deck.commander)}</strong></div>`
          : ''}
      </div>
      <div class="deck-stats">
        <span class="stat-chip">${total} cards</span>
        <span class="stat-chip">${deck.cards.length} unique</span>
      </div>
    </div>
    <div class="tab-bar">
      ${['cards', 'config', 'results'].map(t => `
        <button class="tab-btn ${resolvedTab === t ? 'tab-btn--active' : ''}"
          onclick="window.__tab('${t}')">
          ${TAB_LABELS[t]}
        </button>`).join('')}
    </div>
    <div class="tab-content">
      ${resolvedTab === 'cards'   ? buildCardsTab(deck, expandedEffectCards, expandedTypeGroups) : ''}
      ${resolvedTab === 'config'  ? buildConfigTab(deck, editingDef)                            : ''}
      ${resolvedTab === 'results' ? buildResultsTab(deck, simGameCount, simMaxTurns)            : ''}
    </div>
  `;

  // Wire run-sim button (only present in results tab)
  document.getElementById('run-sim-btn')?.addEventListener('click', () => {
    onRunSimulation(deck.id);
  });
}

// ─── Import Loading State ─────────────────────────────────────────────────────

/**
 * Show or hide a loading indicator in the sidebar during Scryfall enrichment.
 * The message replaces the deck list while loading.
 *
 * @param {boolean} loading
 * @param {string}  [message]
 */
export function setImportLoading(loading, message = 'Loading…') {
  const deckList = document.getElementById('deck-list');
  if (!deckList) return;

  if (loading) {
    deckList.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-msg muted">${escapeHtml(message)}</div>
      </div>`;
  } else {
    // Will be overwritten by the next renderDeckList() call; no action needed
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
}
