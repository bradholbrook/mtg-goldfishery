/**
 * MTG Goldfish Simulator - UI Renderer
 *
 * Pure functions that build/update DOM from app state.
 * No framework — direct DOM manipulation, clean and fast.
 */

import { CARD_TYPES } from './types.js';
import { getDecks, getResults, getResultsForDeck } from './storage.js';

// ─── Type Colors ─────────────────────────────────────────────────────────────

export const TYPE_COLORS = {
  Land:         '#a0845c',
  Creature:     '#4ade80',
  Instant:      '#60a5fa',
  Sorcery:      '#c084fc',
  Artifact:     '#94a3b8',
  Enchantment:  '#fbbf24',
  Planeswalker: '#f87171',
  Battle:       '#fb923c',
  Other:        '#6b7280',
  Unknown:      '#6b7280',
};

// ─── Deck List Panel ──────────────────────────────────────────────────────────

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
          ${deck.commander ? `<span class="tag tag-commander">⚔ ${escapeHtml(deck.commander)}</span>` : ''}
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

// ─── Active Deck Panel ────────────────────────────────────────────────────────

export function renderActiveDeck(deck, onRunSimulation) {
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

  // Build type breakdown bars
  const typeCounts = {};
  for (const card of deck.cards) {
    const t = card.types[0] || 'Unknown';
    typeCounts[t] = (typeCounts[t] || 0) + card.quantity;
  }

  const typeBreakdownHTML = buildTypeBreakdownBars(typeCounts, total);

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

    <div class="section">
      <div class="section-label">Deck Composition</div>
      ${typeBreakdownHTML}
    </div>

    <div class="sim-controls section">
      <div class="section-label">Simulate Opening Hands</div>
      <div class="control-row">
        <label for="game-count">Games to simulate</label>
        <select id="game-count" class="select">
          <option value="100">100</option>
          <option value="1000" selected>1,000</option>
          <option value="5000">5,000</option>
          <option value="10000">10,000</option>
        </select>
        <button id="run-sim-btn" class="btn-primary" data-deck-id="${deck.id}">
          ▶ Run Simulation
        </button>
      </div>
    </div>

    <div id="sim-results-area"></div>
  `;

  document.getElementById('run-sim-btn').addEventListener('click', () => {
    const count = parseInt(document.getElementById('game-count').value, 10);
    onRunSimulation(deck.id, count);
  });
}

// ─── Simulation Results ───────────────────────────────────────────────────────

export function renderSimResults(results) {
  const container = document.getElementById('sim-results-area');
  if (!container || !results) return;

  const { summary, gamesSimulated, simulatedAt } = results;

  container.innerHTML = `
    <div class="results-panel section">
      <div class="section-label">
        Results — ${gamesSimulated.toLocaleString()} games
        <span class="muted" style="font-weight:400;margin-left:8px">${formatRelativeTime(simulatedAt)}</span>
      </div>

      <div class="results-grid">
        ${buildResultCard(
          'Good Opening Hands',
          `${summary.goodLandHandPct}%`,
          'Hands with 2–4 lands',
          summary.goodLandHandPct >= 60 ? 'good' : summary.goodLandHandPct >= 40 ? 'warn' : 'bad'
        )}
        ${buildResultCard(
          'Avg Lands in Hand',
          summary.avgTypeCounts['Land']?.toFixed(2) ?? '—',
          'Out of 7 cards drawn',
          null
        )}
        ${buildResultCard(
          'Avg Non-Land Spells',
          ((7 - (summary.avgTypeCounts['Land'] || 0)).toFixed(2)),
          'Available turn 1',
          null
        )}
      </div>

      <div class="section-label" style="margin-top:20px">Average Card Types in Opening Hand</div>
      ${buildHandTypeChart(summary.avgTypeCounts, 7)}

      <div class="section-label" style="margin-top:20px">% of Hands Containing Each Type</div>
      ${buildSeenPctBars(summary.typeSeenPct)}
    </div>
  `;
}

// ─── Component Builders ───────────────────────────────────────────────────────

function buildTypeBreakdownBars(typeCounts, total) {
  const entries = Object.entries(typeCounts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return `
    <div class="type-bars">
      <div class="bar-track">
        ${entries.map(([type, count]) => {
          const pct = (count / total) * 100;
          return `<div class="bar-segment tooltip-parent"
            style="width:${pct}%;background:${TYPE_COLORS[type] || TYPE_COLORS.Other}"
            title="${type}: ${count} (${pct.toFixed(1)}%)">
            <span class="tooltip">${type}: ${count}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="bar-legend">
        ${entries.map(([type, count]) => `
          <div class="legend-item">
            <span class="legend-dot" style="background:${TYPE_COLORS[type] || TYPE_COLORS.Other}"></span>
            <span>${type}</span>
            <span class="muted">${count}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function buildResultCard(label, value, sublabel, quality) {
  const qualityClass = quality ? `result-card--${quality}` : '';
  return `
    <div class="result-card ${qualityClass}">
      <div class="result-value">${value}</div>
      <div class="result-label">${label}</div>
      <div class="result-sub muted">${sublabel}</div>
    </div>`;
}

function buildHandTypeChart(avgCounts, handSize) {
  // Horizontal bar chart — avg count out of 7
  const entries = Object.entries(avgCounts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return `
    <div class="hand-chart">
      ${entries.map(([type, avg]) => {
        const pct = (avg / handSize) * 100;
        return `
          <div class="hand-chart-row">
            <div class="hand-chart-label">
              <span class="legend-dot" style="background:${TYPE_COLORS[type] || TYPE_COLORS.Other}"></span>
              ${type}
            </div>
            <div class="hand-chart-bar-track">
              <div class="hand-chart-bar"
                style="width:${pct}%;background:${TYPE_COLORS[type] || TYPE_COLORS.Other}">
              </div>
            </div>
            <div class="hand-chart-value">${avg.toFixed(2)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

function buildSeenPctBars(typeSeenPct) {
  const entries = Object.entries(typeSeenPct)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return `
    <div class="hand-chart">
      ${entries.map(([type, pct]) => `
        <div class="hand-chart-row">
          <div class="hand-chart-label">
            <span class="legend-dot" style="background:${TYPE_COLORS[type] || TYPE_COLORS.Other}"></span>
            ${type}
          </div>
          <div class="hand-chart-bar-track">
            <div class="hand-chart-bar"
              style="width:${pct}%;background:${TYPE_COLORS[type] || TYPE_COLORS.Other}">
            </div>
          </div>
          <div class="hand-chart-value">${pct}%</div>
        </div>`).join('')}
    </div>`;
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(isoString).toLocaleDateString();
}
