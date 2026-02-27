/**
 * MTG Goldfish Simulator - UI Renderer
 *
 * Pure functions that build/update DOM from app state.
 * No framework — direct DOM manipulation, clean and fast.
 */

import { CARD_TYPES } from './types.js';
import { getDecks, getResults, getResultsForDeck } from './storage.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from './criteria.js';

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
  MDFC:         '#818cf8',
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

export function renderActiveDeck(deck, onRunSimulation, editingDef = null, onReenrich = null) {
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

  // Build type breakdown bars.
  // MDFCs count toward each face type + 'MDFC' so the bar shows their dual nature.
  const typeCounts = {};
  for (const card of deck.cards) {
    const typesToCount = card.isMDFC && Array.isArray(card.faces)
      ? [...new Set([...card.faces.flatMap(f => f.types || []), 'MDFC'])]
      : (card.types?.length > 0 ? [...new Set(card.types)] : ['Unknown']);
    for (const t of typesToCount) {
      typeCounts[t] = (typeCounts[t] || 0) + card.quantity;
    }
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
        ${onReenrich ? `<button id="reenrich-btn" class="btn-secondary" style="font-size:11px;padding:2px 8px" title="Re-fetch card data from Scryfall">⟳ Re-enrich</button>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-label">Deck Composition</div>
      ${typeBreakdownHTML}
    </div>

    ${buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id))}

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

  if (onReenrich) {
    document.getElementById('reenrich-btn')?.addEventListener('click', () => onReenrich(deck.id));
  }
}

// ─── Simulation Results ───────────────────────────────────────────────────────

export function renderSimResults(results) {
  const container = document.getElementById('sim-results-area');
  if (!container || !results) return;

  const { summary, gamesSimulated, simulatedAt, enriched } = results;

  container.innerHTML = `
    <div class="results-panel section">
      <div class="section-label">
        Results — ${gamesSimulated.toLocaleString()} games
        <span class="muted" style="font-weight:400;margin-left:8px">${formatRelativeTime(simulatedAt)}</span>
        ${enriched ? `<span class="tag tag-enriched" style="margin-left:8px;font-size:10px">Turn-by-turn</span>` : ''}
      </div>

      <div class="results-grid">
        ${buildGoodHandsPctCard(summary)}
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

      ${buildGoodHandDefResults(results)}

      <div class="section-label" style="margin-top:20px">Opening Hand Type Breakdown</div>
      ${buildCombinedTypeChart(summary.avgTypeCounts, summary.typeSeenPct, 7)}

      ${enriched ? buildTurnByTurnPanel(summary) : ''}
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

/**
 * Build the "Good Opening Hands" stat card.
 * Uses goodHandAnyPct (% matching any definition) when definitions exist,
 * otherwise falls back to the land-count heuristic.
 */
function buildGoodHandsPctCard(summary) {
  const anyPct = summary.goodHandAnyPct;
  if (anyPct !== null && anyPct !== undefined) {
    const quality = anyPct >= 60 ? 'good' : anyPct >= 40 ? 'warn' : 'bad';
    return buildResultCard('Good Opening Hands', `${anyPct}%`, 'Matches any good hand definition', quality);
  }
  // Fallback: land heuristic
  const landPct = summary.goodLandHandPct;
  const quality = landPct >= 60 ? 'good' : landPct >= 40 ? 'warn' : 'bad';
  return buildResultCard('Good Opening Hands', `${landPct}%`, 'Hands with ≥3 lands (add definitions to customize)', quality);
}

/**
 * Combined chart: avg count per type (bar) + % of hands containing each type.
 */
function buildCombinedTypeChart(avgCounts, seenPcts, handSize) {
  const entries = Object.entries(avgCounts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return `
    <div class="hand-chart">
      <div class="hand-chart-row hand-chart-header">
        <div class="hand-chart-label"></div>
        <div class="hand-chart-bar-track"></div>
        <div class="hand-chart-value muted" style="font-size:10px">Avg</div>
        <div class="hand-chart-seen muted" style="font-size:10px">% of Hands</div>
      </div>
      ${entries.map(([type, avg]) => {
        const barPct = (avg / handSize) * 100;
        const seenPct = seenPcts[type] ?? 0;
        const color = TYPE_COLORS[type] || TYPE_COLORS.Other;
        return `
          <div class="hand-chart-row">
            <div class="hand-chart-label">
              <span class="legend-dot" style="background:${color}"></span>
              ${type}
            </div>
            <div class="hand-chart-bar-track">
              <div class="hand-chart-bar" style="width:${barPct}%;background:${color}"></div>
            </div>
            <div class="hand-chart-value">${avg.toFixed(2)}</div>
            <div class="hand-chart-seen muted">${seenPct}%</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ─── Good Hand Section ────────────────────────────────────────────────────────

/**
 * Render the full "Good Hand Definitions" config section.
 * Embeds the inline editor when editingDef is non-null.
 * Uses window.__ghh.* for all mutations (no callback props needed).
 */
function buildGoodHandSection(deck, editingDef, allResults) {
  const defs = deck.goodHandDefs || [];
  const latestResult = allResults[allResults.length - 1] || null;

  const defListHTML = defs.map(def => {
    const pct = latestResult?.summary?.goodHandDefPcts?.[def.id];
    const pctBadge = pct !== undefined
      ? `<span class="def-pct ${pct >= 60 ? 'def-pct--good' : pct >= 40 ? 'def-pct--warn' : 'def-pct--bad'}">${pct}%</span>`
      : `<span class="def-pct def-pct--none">—</span>`;
    const criteriaDesc = def.criteria.map(c => {
      const t = CRITERION_TYPES[c.type];
      return t ? t.describe(c) : c.type;
    }).join(' + ');

    return `
      <div class="def-item">
        <div class="def-item-info">
          <span class="def-item-name">${escapeHtml(def.name)}</span>
          <span class="def-item-desc muted">${escapeHtml(criteriaDesc)}</span>
        </div>
        <div class="def-item-actions">
          ${pctBadge}
          <button class="btn-icon btn-edit" onclick="window.__ghh.editDef('${def.id}')" title="Edit">✏</button>
          <button class="btn-icon btn-danger" onclick="window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');

  const editorHTML = editingDef ? buildGoodHandEditor(editingDef, deck) : '';
  const addBtn = editingDef
    ? ''
    : `<button class="btn-secondary btn-sm" onclick="window.__ghh.addDef()">+ Add Definition</button>`;

  return `
    <div class="section">
      <div class="section-label">Good Hand Definitions</div>
      ${defs.length === 0 && !editingDef
        ? `<p class="muted" style="font-size:12px;margin-bottom:10px">No definitions yet. Define what a keepable hand looks like.</p>`
        : defListHTML}
      ${editorHTML}
      ${addBtn}
    </div>`;
}

/**
 * Render the inline editor for adding or modifying a GoodHandDef.
 */
function buildGoodHandEditor(editingDef, deck) {
  const criteriaRows = editingDef.criteria.map((crit, idx) =>
    buildCriterionRow(crit, idx, deck)
  ).join('');

  return `
    <div class="def-editor">
      <div class="def-editor-field">
        <label class="input-label">Definition Name</label>
        <input id="def-name-input" class="input-text" type="text"
          value="${escapeHtml(editingDef.name)}"
          placeholder="e.g. Keepable Ramp Hand"
          oninput="window.__ghh.setName(this.value)" />
      </div>
      <div class="def-editor-field">
        <label class="input-label">Criteria <span class="muted">(all must be true)</span></label>
        <div id="criteria-list">
          ${criteriaRows}
        </div>
        <button class="btn-secondary btn-add btn-sm" style="margin-top:6px"
          onclick="window.__ghh.addCrit()">+ Add Criterion</button>
      </div>
      <div class="def-editor-actions">
        <button class="btn-primary" onclick="window.__ghh.saveDef()">Save Definition</button>
        <button class="btn-secondary" onclick="window.__ghh.cancelEdit()">Cancel</button>
      </div>
    </div>`;
}

/**
 * Render a single criterion row: [type dropdown] [field widgets] [remove btn].
 */
function buildCriterionRow(crit, idx, deck) {
  const typeSelect = `
    <select class="select select-sm" onchange="window.__ghh.changeType(${idx}, this.value)">
      ${CRITERION_TYPE_OPTIONS.map(ct =>
        `<option value="${ct.id}" ${ct.id === crit.type ? 'selected' : ''}>${ct.label}</option>`
      ).join('')}
    </select>`;

  const typeInfo = CRITERION_TYPES[crit.type];
  const fieldWidgets = typeInfo
    ? typeInfo.fields.map(f => buildFieldWidget(f, crit, idx, deck)).join('')
    : '';

  return `
    <div class="criterion-row">
      ${typeSelect}
      ${fieldWidgets}
      <button class="btn-icon btn-danger" onclick="window.__ghh.removeCrit(${idx})" title="Remove">✕</button>
    </div>`;
}

/**
 * Render a single field widget inside a criterion row.
 */
function buildFieldWidget(field, crit, idx, deck) {
  const val = crit[field.key];

  if (field.widget === 'card_select') {
    const names = [...new Set(deck.cards.map(c => c.name))].sort();
    const opts = names.map(n =>
      `<option value="${escapeHtml(n)}" ${n === val ? 'selected' : ''}>${escapeHtml(n)}</option>`
    ).join('');
    return `
      <select class="select select-sm"
        onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">
        <option value="">— pick a card —</option>
        ${opts}
      </select>`;
  }

  if (field.widget === 'type_select') {
    const opts = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown').map(t =>
      `<option value="${t}" ${t === val ? 'selected' : ''}>${t}</option>`
    ).join('');
    return `
      <select class="select select-sm"
        onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">
        ${opts}
      </select>`;
  }

  if (field.widget === 'number') {
    return `
      <input type="number" class="input-number"
        value="${val ?? (field.min || 1)}"
        min="${field.min || 1}" max="${field.max || 7}"
        oninput="window.__ghh.setVal(${idx}, '${field.key}', Number(this.value))" />`;
  }

  if (field.widget === 'types_multiselect') {
    const selected = Array.isArray(val) ? val : [];
    const checkboxes = CARD_TYPES.filter(t => t !== 'Other').map(t => {
      const checked = selected.includes(t) ? 'checked' : '';
      return `<label class="type-checkbox-label">
        <input type="checkbox" ${checked} onchange="window.__ghh.toggleType(${idx}, '${t}')">
        ${t}
      </label>`;
    }).join('');
    return `<div class="types-multiselect">${checkboxes}</div>`;
  }

  return '';
}

/**
 * Build the turn-by-turn stats panel (only shown for enriched decks).
 * @param {Object} summary
 */
function buildTurnByTurnPanel(summary) {
  const { avgCardsDrawnByTurn, avgEffectDrawsPerGame, pctGamesWithDrawEffect, drawEffectSourceBreakdown } = summary;

  if (!avgCardsDrawnByTurn || Object.keys(avgCardsDrawnByTurn).length === 0) return '';

  // Cards drawn by turn table
  const turnEntries = Object.entries(avgCardsDrawnByTurn).sort(([a], [b]) => Number(a) - Number(b));
  const turnRows = turnEntries.map(([turn, avg]) => `
    <div class="hand-chart-row">
      <div class="hand-chart-label">Turn ${turn}</div>
      <div class="hand-chart-bar-track">
        <div class="hand-chart-bar" style="width:${Math.min((avg / 30) * 100, 100)}%;background:#60a5fa"></div>
      </div>
      <div class="hand-chart-value">${avg.toFixed(1)}</div>
    </div>`).join('');

  // Draw engine source breakdown
  const sourceEntries = Object.entries(drawEffectSourceBreakdown || {})
    .sort(([, a], [, b]) => b - a);

  const sourceRows = sourceEntries.map(([name, avg], idx) => {
    const colors = ['#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#f87171', '#34d399'];
    const color = colors[idx % colors.length];
    return `
      <div class="hand-chart-row">
        <div class="hand-chart-label" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">
          <span class="legend-dot" style="background:${color}"></span>
          ${escapeHtml(name)}
        </div>
        <div class="hand-chart-bar-track">
          <div class="hand-chart-bar" style="width:${Math.min(avg * 20, 100)}%;background:${color}"></div>
        </div>
        <div class="hand-chart-value">${avg.toFixed(1)}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Cumulative Cards Drawn by Turn</div>
    <div class="hand-chart">
      <div class="hand-chart-row hand-chart-header">
        <div class="hand-chart-label"></div>
        <div class="hand-chart-bar-track"></div>
        <div class="hand-chart-value muted" style="font-size:10px">Avg</div>
      </div>
      ${turnRows}
    </div>

    <div class="results-grid" style="margin-top:16px">
      ${buildResultCard(
        'Avg Effect Draws/Game',
        (avgEffectDrawsPerGame ?? 0).toFixed(1),
        'Cards from ETB/upkeep effects',
        null
      )}
      ${buildResultCard(
        'Games with Draw Engine',
        `${pctGamesWithDrawEffect ?? 0}%`,
        'Had ≥1 draw source on board',
        null
      )}
    </div>

    ${sourceEntries.length > 0 ? `
      <div class="section-label" style="margin-top:16px">Draw Effect Sources (avg draws/game)</div>
      <div class="hand-chart">${sourceRows}</div>
    ` : ''}
  `;
}

/**
 * Render good hand def percentage bars inside the simulation results panel.
 */
function buildGoodHandDefResults(results) {
  const pcts = results?.summary?.goodHandDefPcts;
  const deck = null; // we only have the results here, not the deck

  // Retrieve def names from the stored results snapshot
  const defEntries = Object.entries(pcts || {});
  if (!defEntries.length) return '';

  // We need def names — they're available on the deck but not in results.
  // The caller (renderSimResults) only has results. We'll display the IDs
  // unless the calling code passes deck info. For now, store def names
  // in the results object when simulating.
  // Distinct palette so each definition gets a unique bar color
  const DEF_PALETTE = [
    '#60a5fa', // blue
    '#4ade80', // green
    '#fbbf24', // amber
    '#c084fc', // purple
    '#fb923c', // orange
    '#f87171', // red
    '#34d399', // emerald
    '#a78bfa', // violet
  ];

  const rows = defEntries.map(([defId, pct], idx) => {
    const name = results.goodHandDefNames?.[defId] || defId;
    const color = DEF_PALETTE[idx % DEF_PALETTE.length];
    return `
      <div class="hand-chart-row">
        <div class="hand-chart-label" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">
          <span class="legend-dot" style="background:${color}"></span>
          ${escapeHtml(name)}
        </div>
        <div class="hand-chart-bar-track">
          <div class="hand-chart-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="hand-chart-value">${pct}%</div>
      </div>`;
  }).join('');

  const anyPct = results?.summary?.goodHandAnyPct;
  const totalRow = anyPct !== null && anyPct !== undefined ? `
      <div class="hand-chart-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">
        <div class="hand-chart-label" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;font-weight:600">
          <span class="legend-dot" style="background:#94a3b8"></span>
          Any Definition
        </div>
        <div class="hand-chart-bar-track">
          <div class="hand-chart-bar" style="width:${anyPct}%;background:#94a3b8"></div>
        </div>
        <div class="hand-chart-value" style="font-weight:600">${anyPct}%</div>
      </div>` : '';

  return `
    <div class="section-label" style="margin-top:20px">Good Hand Definition Results</div>
    <div class="hand-chart">${rows}${totalRow}</div>`;
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
