/**
 * mullstat - UI Entry Point
 *
 * Thin shell: imports from js/ui/* modules, exposes the public API used by app.js.
 */

export { TYPE_COLORS } from './ui/shared.js';
export { renderDeckList } from './ui/deck-list.js';

import { escapeHtml, CATEGORY_COLORS, TYPE_COLORS } from './ui/shared.js';
import { CANONICAL_CATEGORIES, CARD_TYPES } from './types.js';
import { hypgeomAtLeast, expectedValue } from './hypergeometric.js';
import { buildCardsTab } from './ui/cards-tab.js';
import { buildMulliganTab } from './ui/config-tab.js';
import { buildResultsTab } from './ui/results-tab.js';
import { getEffectiveCategories, getEffectiveOtagMappings } from './category-config.js';
import { getDecks } from './storage.js';

// ─── Active Deck Panel ────────────────────────────────────────────────────────

export function renderActiveDeck(deck, onRunSimulation, editingDef = null, activeTab = 'dashboard', expandedTypeGroups = new Set(), expandedCards = new Set(), categoryConfigOpen = false) {
  const container = document.getElementById('active-deck');
  if (!container) return;

  if (!deck) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="muted">Select a deck to analyze.</p>
      </div>`;
    return;
  }

  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  const TAB_LABELS = { dashboard: 'Dashboard', cards: 'Card Tags', mulligan: 'Mulligan', results: 'Results' };
  const resolvedTab = ['dashboard', 'cards', 'mulligan', 'results'].includes(activeTab) ? activeTab : 'dashboard';

  container.innerHTML = `
    <div class="panel-header">
      <h2 class="deck-title">
        ${escapeHtml(deck.name)}
        <button class="btn-icon btn-rename" onclick="window.__deck.rename()" title="Rename deck">✏</button>
      </h2>
    </div>
    <div class="tab-bar">
      ${['dashboard', 'cards', 'mulligan', 'results'].map(t => `
        <button class="tab-btn ${resolvedTab === t ? 'tab-btn--active' : ''}"
          onclick="window.__tab('${t}')">
          ${TAB_LABELS[t]}
        </button>`).join('')}
    </div>
    <div class="tab-content">
      ${resolvedTab === 'dashboard' ? buildDashboardPlaceholder(deck)                              : ''}
      ${resolvedTab === 'cards'     ? buildCardsTab(deck, expandedTypeGroups, expandedCards, categoryConfigOpen, _collectAllOtags()) : ''}
      ${resolvedTab === 'mulligan'  ? buildMulliganTab(deck, editingDef)                           : ''}
      ${resolvedTab === 'results'   ? buildResultsTab(deck)                                        : ''}
    </div>
  `;

  // Wire run-sim button (only present in mulligan tab)
  document.getElementById('run-sim-btn')?.addEventListener('click', () => {
    onRunSimulation(deck.id);
  });
}

const MANA_CURVE_COLORS = [
  '#60a5fa', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#34d399', '#a78bfa',
];

/** Collect all unique otag slugs from all loaded decks. */
function _collectAllOtags() {
  try {
    const decks = getDecks();
    const slugs = new Set();
    for (const deck of decks) {
      for (const card of (deck.cards || [])) {
        for (const slug of (card.otags || [])) slugs.add(slug);
      }
    }
    // Also include all slugs from the effective otag mappings
    const otagMap = getEffectiveOtagMappings();
    for (const slug of Object.keys(otagMap)) slugs.add(slug);
    return [...slugs].sort();
  } catch { return []; }
}

/** Dashboard tab — commander hero, category breakdown, mana curve, opening hand math. */
function buildDashboardPlaceholder(deck) {
  const allCards = deck.cards;
  const commanderCards = allCards.filter(c => c.isCommander);
  const nonCommanderCards = allCards.filter(c => !c.isCommander);
  const totalAll = allCards.reduce((s, c) => s + c.quantity, 0);
  const basicLands = allCards.filter(c => c.types?.includes('Land') && c.supertypes?.includes('Basic'));
  const nonBasicUnique = allCards.filter(c => !(c.types?.includes('Land') && c.supertypes?.includes('Basic')));
  const totalNonBasicUnique = nonBasicUnique.length;
  // "valid uniqueness": all non-basics are singleton (qty=1) and total = 100
  const allNonBasicsSingleton = nonBasicUnique.every(c => c.quantity === 1);
  const uniqueIsValid = totalAll === 100 && allNonBasicsSingleton;
  const nonCmdrTotal = nonCommanderCards.reduce((s, c) => s + c.quantity, 0);
  const lands = nonCommanderCards.filter(c => c.types?.includes('Land')).reduce((s, c) => s + c.quantity, 0);
  const N = nonCmdrTotal;
  const n = 7;

  // ── Category counts ──────────────────────────────────────────────────────
  const effectiveCats = getEffectiveCategories();
  const catCounts = {};
  for (const cat of effectiveCats) catCounts[cat.name] = 0;
  for (const card of allCards) {
    for (const cat of (card.categories || [])) {
      if (catCounts[cat] !== undefined) catCounts[cat] += card.quantity;
    }
  }

  // ── Overview stat chips ─────────────────────────────────────────────────
  const totalColor = totalAll !== 100 ? 'var(--red)' : 'var(--green)';
  const uniqueColor = uniqueIsValid ? 'var(--green)' : 'var(--text-secondary)';

  // Basic land chips: one per unique basic land name (e.g. "3 Swamp", "2 Mountain")
  const basicByName = {};
  for (const card of basicLands) {
    basicByName[card.name] = (basicByName[card.name] || 0) + card.quantity;
  }
  const basicChips = Object.entries(basicByName)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, qty]) => `<span class="stat-chip">${qty} ${escapeHtml(name)}</span>`)
    .join('');

  const statChips = `
    <div class="deck-stats" style="flex-wrap:wrap;gap:6px">
      <span class="stat-chip" style="color:${totalColor}">${totalAll} cards</span>
      <span class="stat-chip" style="color:${uniqueColor}">${totalNonBasicUnique} unique non-basics</span>
      ${basicChips}
    </div>`;

  // ── Opening Hand Probabilities ───────────────────────────────────────────
  let handMathHTML = '';
  if (N >= 7) {
    const K_lands  = lands;
    const K_ramp   = (catCounts['Ramp'] || 0) + (catCounts['Mana Rock'] || 0) + (catCounts['Mana Dork'] || 0);
    const K_draw   = catCounts['Card Draw'] || 0;
    const K_inter  = catCounts['Interaction'] || 0;

    const eLands   = expectedValue(N, K_lands, n).toFixed(2);
    const p2Lands  = (hypgeomAtLeast(2, N, K_lands, n) * 100).toFixed(1);
    const p3Lands  = (hypgeomAtLeast(3, N, K_lands, n) * 100).toFixed(1);
    const p1Ramp   = K_ramp  > 0 ? (hypgeomAtLeast(1, N, K_ramp,  n) * 100).toFixed(1) : null;
    const p1Draw   = K_draw  > 0 ? (hypgeomAtLeast(1, N, K_draw,  n) * 100).toFixed(1) : null;
    const p1Inter  = K_inter > 0 ? (hypgeomAtLeast(1, N, K_inter, n) * 100).toFixed(1) : null;

    const landColor = (v) => parseFloat(v) >= 70 ? 'var(--green)' : parseFloat(v) >= 45 ? 'var(--yellow)' : 'var(--red)';

    handMathHTML = `
      <div class="section" style="margin-bottom:0">
        <div class="section-label">Opening Hand Analysis</div>
        <div class="hand-stats-grid">
          <div class="hand-stat-card">
            <div class="hand-stat-big">${eLands}</div>
            <div class="hand-stat-desc">avg lands in opening hand</div>
          </div>
          <div class="hand-stat-card">
            <div class="hand-stat-big" style="color:${landColor(p2Lands)}">${p2Lands}%</div>
            <div class="hand-stat-desc">at least 2 lands<br><span class="muted" style="font-size:9px">${K_lands} in deck</span></div>
          </div>
          <div class="hand-stat-card">
            <div class="hand-stat-big" style="color:${landColor(p3Lands)}">${p3Lands}%</div>
            <div class="hand-stat-desc">at least 3 lands</div>
          </div>
          ${p1Ramp !== null ? `<div class="hand-stat-card">
            <div class="hand-stat-big">${p1Ramp}%</div>
            <div class="hand-stat-desc">chance of ramp<br><span class="muted" style="font-size:9px">${K_ramp} sources</span></div>
          </div>` : ''}
          ${p1Draw !== null ? `<div class="hand-stat-card">
            <div class="hand-stat-big">${p1Draw}%</div>
            <div class="hand-stat-desc">chance of card draw<br><span class="muted" style="font-size:9px">${K_draw} sources</span></div>
          </div>` : ''}
          ${p1Inter !== null ? `<div class="hand-stat-card">
            <div class="hand-stat-big">${p1Inter}%</div>
            <div class="hand-stat-desc">chance of interaction<br><span class="muted" style="font-size:9px">${K_inter} sources</span></div>
          </div>` : ''}
        </div>
      </div>`;
  }

  // ── Commander Hero ───────────────────────────────────────────────────────
  let heroSection = '';
  if (commanderCards.length > 0) {
    const cmdCard = commanderCards[0];
    const imgHTML = cmdCard.imageUrl
      ? `<img src="${escapeHtml(cmdCard.imageUrl)}" class="commander-hero-image"
           alt="${escapeHtml(cmdCard.name)}" />`
      : '';

    heroSection = `
      <div class="commander-hero">
        <div class="commander-hero-left">
          ${imgHTML}
        </div>
        <div class="commander-hero-right">
          ${statChips}
          ${handMathHTML}
        </div>
      </div>`;
  } else {
    heroSection = `
      <div style="margin-bottom:16px">
        ${statChips}
      </div>
      ${handMathHTML ? `<div class="section">${handMathHTML}</div>` : ''}`;
  }

  // ── Category Breakdown ──────────────────────────────────────────────────
  const CALC_CATS = new Set(['Card Draw', 'Cascade', 'Mill', 'Discover']);

  // Split into regular + calculated, both alphabetical
  const regularCats = effectiveCats.filter(c => !CALC_CATS.has(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  const calcCats    = effectiveCats.filter(c => CALC_CATS.has(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  const orderedCats = [...regularCats, ...calcCats];

  const hasAnyCategories = deck.enriched && Object.values(catCounts).some(v => v > 0);
  const enrichmentNote = !deck.enriched
    ? `<p class="muted" style="font-size:12px;margin-bottom:12px">Import a deck to auto-classify card categories.</p>`
    : !hasAnyCategories
    ? `<p class="muted" style="font-size:12px;margin-bottom:12px">No categories detected — visit <strong>Card Tags</strong> to add them manually.</p>`
    : '';

  const maxCatCount = Math.max(1, ...Object.values(catCounts));
  const categoryBars = orderedCats.map((catDef, idx) => {
    const cat = catDef.name;
    const count = catCounts[cat] || 0;
    const color = catDef.color || '#6b7280';
    const isFirstCalc = CALC_CATS.has(cat) && !CALC_CATS.has(orderedCats[idx - 1]?.name ?? '');
    const separator = isFirstCalc ? `<div style="height:1px;background:var(--border);margin:6px 0"></div>` : '';
    return `${separator}
      <div class="cat-bar-row" style="cursor:pointer"
        onclick="window.__dash.showCategoryCards('${escapeHtml(cat)}')"
        title="View ${cat} cards">
        <div class="cat-bar-label">
          <span class="cat-bar-name" style="color:${color}">${cat}</span>
          <span class="cat-bar-count muted">${count}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${Math.min(100, (count / maxCatCount) * 100)}%;background:${color}"></div>
        </div>
      </div>`;
  }).join('');

  // ── Mana Curve ──────────────────────────────────────────────────────────
  const nonLandCards = allCards.filter(c => !c.types?.includes('Land') && !c.isCommander);
  const cmcBuckets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  for (const card of nonLandCards) {
    const cmc = card.cmc ?? 0;
    const key = cmc >= 7 ? '7+' : String(Math.floor(cmc));
    cmcBuckets[key] = (cmcBuckets[key] || 0) + card.quantity;
  }
  const maxBucketCount = Math.max(1, ...Object.values(cmcBuckets));
  const manaCurveRows = Object.entries(cmcBuckets).map(([key, count], i) => {
    const barPct = Math.round((count / maxBucketCount) * 100);
    const barColor = MANA_CURVE_COLORS[i % MANA_CURVE_COLORS.length];
    return `
      <div class="mc-col">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-count">${count}</div>
          <div class="mc-col-bar" style="height:${barPct}%;background:${barColor}"></div>
        </div>
        <div class="mc-col-label">${key}</div>
      </div>`;
  }).join('');

  const typePieSection = buildTypePieChart(allCards);
  const manaCurveSection = `
    <div class="section">
      <div class="section-label">Mana Curve</div>
      <div class="mc-col-chart mc-col-chart--compact">${manaCurveRows}</div>
    </div>`;

  return `
    ${heroSection}
    <div class="dashboard-two-col">
      ${manaCurveSection}
      ${typePieSection}
    </div>
    <div class="section">
      <div class="section-label">Category Breakdown</div>
      ${enrichmentNote}
      <div class="cat-bar-list">${categoryBars}</div>
    </div>`;
}

// ─── Type Breakdown Pie Chart ─────────────────────────────────────────────────

function buildTypePieChart(allCards) {
  const total = allCards.reduce((s, c) => s + c.quantity, 0);
  if (total === 0) return '';

  // Count each recognized type (first type wins per card)
  const typeCounts = {};
  for (const card of allCards) {
    const type = CARD_TYPES.find(t => card.types?.includes(t)) || 'Other';
    typeCounts[type] = (typeCounts[type] || 0) + card.quantity;
  }

  const entries = CARD_TYPES
    .filter(t => typeCounts[t] > 0)
    .map(t => ({ type: t, count: typeCounts[t], color: TYPE_COLORS[t] || TYPE_COLORS.Other }));

  // Build conic-gradient string
  let angle = 0;
  const slices = entries.map(({ count, color }) => {
    const deg = (count / total) * 360;
    const start = angle.toFixed(1);
    angle += deg;
    return `${color} ${start}deg ${angle.toFixed(1)}deg`;
  });
  const gradient = `conic-gradient(${slices.join(', ')})`;

  // Build legend
  const legendItems = entries.map(({ type, count, color }) => `
    <div class="pie-legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="pie-legend-label">${type}</span>
      <span class="pie-legend-count muted">${count}</span>
    </div>`).join('');

  return `
    <div class="section">
      <div class="section-label">Card Type Breakdown</div>
      <div class="pie-chart-wrap">
        <div class="pie-chart" style="background:${gradient}"></div>
        <div class="pie-legend">${legendItems}</div>
      </div>
    </div>`;
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
