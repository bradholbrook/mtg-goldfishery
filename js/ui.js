/**
 * mullstat - UI Entry Point
 *
 * Thin shell: imports from js/ui/* modules, exposes the public API used by app.js.
 */

export { TYPE_COLORS } from './ui/shared.js';
export { renderDeckList } from './ui/deck-list.js';

import { escapeHtml, TYPE_COLORS } from './ui/shared.js';
import { CARD_TYPES } from './types.js';
import { hypgeomAtLeast, expectedValue } from './hypergeometric.js';
import { buildCardBrowser } from './ui/cards-tab.js';
import { buildMulliganTab } from './ui/config-tab.js';
import { buildCalculateTab, extractDeckProfile, buildCastabilitySection } from './ui/calculate-tab.js';

// ─── Active Deck Panel ────────────────────────────────────────────────────────

export function renderActiveDeck(deck, onRunSimulation, editingDef = null, activeTab = 'dashboard', expandedTypeGroups = new Set(), cardBrowserView = 'types', cardBrowserSort = 'alpha', latestResults = null, resultView = 'tags', resultSort = 'value') {
  const container = document.getElementById('active-deck');
  if (!container) return;

  if (!deck) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="muted">Select a deck to analyze.</p>
      </div>`;
    return;
  }

  const TAB_LABELS = { dashboard: 'Dashboard', mulligan: 'Mulligan', calculate: 'Calculate' };
  const resolvedTab = ['dashboard', 'mulligan', 'calculate'].includes(activeTab) ? activeTab : 'dashboard';

  container.innerHTML = `
    <div class="panel-header">
      <h2 class="deck-title">
        ${escapeHtml(deck.name)}
        <button class="btn-icon btn-rename" onclick="window.__deck.rename()" title="Rename deck">✏</button>
      </h2>
    </div>
    <div class="tab-bar">
      ${['dashboard', 'mulligan', 'calculate'].map(t => `
        <button class="tab-btn ${resolvedTab === t ? 'tab-btn--active' : ''}"
          onclick="window.__tab('${t}')">
          ${TAB_LABELS[t]}
        </button>`).join('')}
    </div>
    <div class="tab-content">
      ${resolvedTab === 'dashboard'  ? buildDashboardPlaceholder(deck, expandedTypeGroups, cardBrowserView, cardBrowserSort) : ''}
      ${resolvedTab === 'mulligan'   ? buildMulliganTab(deck, editingDef, latestResults, resultView, resultSort) : ''}
      ${resolvedTab === 'calculate'  ? buildCalculateTab(deck)                                              : ''}
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

/** Dashboard tab — commander hero, mana curve, type breakdown, card browser. */
function buildDashboardPlaceholder(deck, expandedTypeGroups, cardBrowserView, cardBrowserSort) {
  const allCards = deck.cards;
  const commanderCards = allCards.filter(c => c.isCommander);
  const nonCommanderCards = allCards.filter(c => !c.isCommander);
  const totalAll = allCards.reduce((s, c) => s + c.quantity, 0);
  const basicLands = allCards.filter(c => c.types?.includes('Land') && c.supertypes?.includes('Basic'));
  const nonBasicUnique = allCards.filter(c => !(c.types?.includes('Land') && c.supertypes?.includes('Basic')));
  const totalNonBasicUnique = nonBasicUnique.length;
  const allNonBasicsSingleton = nonBasicUnique.every(c => c.quantity === 1);
  const uniqueIsValid = totalAll === 100 && allNonBasicsSingleton;
  const nonCmdrTotal = nonCommanderCards.reduce((s, c) => s + c.quantity, 0);
  const lands = nonCommanderCards.filter(c => c.types?.includes('Land')).reduce((s, c) => s + c.quantity, 0);
  const N = nonCmdrTotal;
  const n = 7;

  // ── Opening Hand Probabilities ────────────────────────────────────────────
  // Use effectTags for ramp/draw analysis (no longer relying on category config)
  let handMathHTML = '';
  if (N >= 7) {
    const K_lands = lands;
    const eLands  = expectedValue(N, K_lands, n).toFixed(2);
    const p2Lands = (hypgeomAtLeast(2, N, K_lands, n) * 100).toFixed(1);
    const p3Lands = (hypgeomAtLeast(3, N, K_lands, n) * 100).toFixed(1);

    const landColor = v => parseFloat(v) >= 70 ? 'var(--green)' : parseFloat(v) >= 45 ? 'var(--yellow)' : 'var(--red)';

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
        </div>
      </div>`;
  }

  // ── Overview stat chips ───────────────────────────────────────────────────
  const totalColor = totalAll !== 100 ? 'var(--red)' : 'var(--green)';
  const uniqueColor = uniqueIsValid ? 'var(--green)' : 'var(--text-secondary)';

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

  // ── Commander Hero ────────────────────────────────────────────────────────
  let heroSection = '';
  if (commanderCards.length > 0) {
    const cmdCard = commanderCards[0];
    const imgHTML = cmdCard.imageUrl
      ? `<img src="${escapeHtml(cmdCard.imageUrl)}" class="commander-hero-image" alt="${escapeHtml(cmdCard.name)}" />`
      : '';

    const cmdTagsHTML = cmdCard.moxTags?.length
      ? `<div class="commander-mox-tags">${cmdCard.moxTags.map(t => `<span class="mox-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const castabilitySection = buildCastabilitySection(extractDeckProfile(deck));
    heroSection = `
      <div class="commander-hero">
        <div class="commander-hero-left">${imgHTML}${cmdTagsHTML}</div>
        <div class="commander-hero-right">
          ${statChips}
          ${handMathHTML}
          ${castabilitySection}
        </div>
      </div>`;
  } else {
    heroSection = `
      <div style="margin-bottom:16px">${statChips}</div>
      ${handMathHTML ? `<div class="section">${handMathHTML}</div>` : ''}`;
  }

  // ── Mana Curve ────────────────────────────────────────────────────────────
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

  const cardBrowser = buildCardBrowser(deck, expandedTypeGroups, cardBrowserView, cardBrowserSort);

  return `
    ${heroSection}
    <div class="dashboard-two-col">
      ${manaCurveSection}
      ${typePieSection}
    </div>
    ${cardBrowser}`;
}

// ─── Type Breakdown Pie Chart ─────────────────────────────────────────────────

function buildTypePieChart(allCards) {
  const total = allCards.reduce((s, c) => s + c.quantity, 0);
  if (total === 0) return '';

  const typeCounts = {};
  for (const card of allCards) {
    const type = CARD_TYPES.find(t => card.types?.includes(t)) || 'Other';
    typeCounts[type] = (typeCounts[type] || 0) + card.quantity;
  }

  const entries = CARD_TYPES
    .filter(t => typeCounts[t] > 0)
    .map(t => ({ type: t, count: typeCounts[t], color: TYPE_COLORS[t] || TYPE_COLORS.Other }));

  let angle = 0;
  const slices = entries.map(({ count, color }) => {
    const deg = (count / total) * 360;
    const start = angle.toFixed(1);
    angle += deg;
    return `${color} ${start}deg ${angle.toFixed(1)}deg`;
  });
  const gradient = `conic-gradient(${slices.join(', ')})`;

  const legendItems = entries.map(({ type, count, color }) => `
    <div class="pie-legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="pie-legend-label">${type}</span>
      <span class="pie-legend-count">${count}</span>
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

export function setImportLoading(loading, message = 'Loading…') {
  const deckList = document.getElementById('deck-list');
  if (!deckList) return;

  if (loading) {
    deckList.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-msg muted">${escapeHtml(message)}</div>
      </div>`;
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

  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
}
