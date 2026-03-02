import { getDecks, getResultsForDeck } from '../storage.js';
import { escapeHtml, formatRelativeTime } from './shared.js';

export function renderDeckList(onSelectDeck, onDeleteDeck) {
  const container = document.getElementById('deck-list');
  if (!container) return;

  const decks = getDecks();

  if (decks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🃏</span>
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
          <span class="tag">${total} cards</span>
        </div>
        <div class="deck-card-footer muted">${lastRun}</div>
      </div>`;
  }).join('');

  // Event delegation
  container.querySelectorAll('.deck-card').forEach(el => {
    el.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        onDeleteDeck(deleteBtn.dataset.deckId);
        return;
      }
      onSelectDeck(el.dataset.deckId);
    });
  });
}
