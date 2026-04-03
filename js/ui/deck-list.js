import { getDecks, getResultsForDeck } from '../storage.js';
import { escapeHtml, formatRelativeTime } from './shared.js';

export function renderDeckList(onSelectDeck, onDeleteDeck) {
  const container = document.getElementById('deck-list');
  if (!container) return;

  const decks = getDecks();

  if (decks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 40 52" width="36" height="46" xmlns="http://www.w3.org/2000/svg" style="color:var(--text-muted)">
          <rect x="6" y="2" width="28" height="48" rx="4" fill="currentColor" opacity="0.15"/>
          <rect x="6" y="2" width="28" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>
          <line x1="6" y1="14" x2="13" y2="14" stroke="currentColor" stroke-width="2.5"/>
          <line x1="6" y1="24" x2="16" y2="24" stroke="currentColor" stroke-width="2.5"/>
          <line x1="6" y1="34" x2="13" y2="34" stroke="currentColor" stroke-width="2.5"/>
          <line x1="6" y1="44" x2="16" y2="44" stroke="currentColor" stroke-width="2.5"/>
        </svg>
        <p>No decks yet.</p>
        <p class="muted">Paste a Moxfield decklist to get started.</p>
      </div>`;
    return;
  }

  container.innerHTML = decks.map(deck => {
    const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
    const results = getResultsForDeck(deck.id);
    const lastRun = results.length > 0
      ? `Last run: ${formatRelativeTime(results[results.length - 1].simulatedAt)}`
      : 'Not yet simulated';

    return `
      <div class="deck-card" data-deck-id="${deck.id}">
        <div class="deck-card-header">
          <div class="deck-card-name">${escapeHtml(deck.name)}</div>
          <button class="btn-icon btn-danger" data-action="delete" data-deck-id="${deck.id}" title="Remove deck">✕</button>
        </div>
        <div class="deck-card-meta">
          ${deck.commander ? `<span class="tag tag-commander">${escapeHtml(deck.commander)}</span>` : ''}
        </div>
        <div class="deck-card-footer muted">${lastRun}</div>
      </div>`;
  }).join('');

  // Single delegated listener on the container — avoids leaking per-element listeners on re-render
  container.onclick = (e) => {
    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      onDeleteDeck(deleteBtn.dataset.deckId);
      return;
    }
    const deckCard = e.target.closest('.deck-card');
    if (deckCard) onSelectDeck(deckCard.dataset.deckId);
  };
}
