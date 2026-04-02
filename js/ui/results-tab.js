import { CATEGORY_COLORS, TYPE_COLORS, tagColor, escapeHtml, formatRelativeTime } from './shared.js';
import { CANONICAL_CATEGORIES, CARD_TYPES } from '../types.js';
import { hypgeomAtLeast, drawsNeeded } from '../hypergeometric.js';

const DEF_PALETTE = [
  '#4ade80', '#60a5fa', '#fbbf24', '#fb923c', '#f87171',
  '#34d399', '#a78bfa', '#f472b6', '#38bdf8', '#a3e635', '#e879f9', '#94a3b8',
];

const DEPTH_LABELS = {
  0: 'Kept 7 (no mull)',
  1: 'Kept 7 (free mull)',
  2: 'Kept 6',
  3: 'Kept 5',
  4: 'Kept 4',
  5: 'Kept 3',
  6: 'Kept 2',
  7: 'Kept 1 (forced)',
};

const DEPTH_SHORT_LABELS = ['7', '7*', '6', '5', '4', '3', '2', '1'];

/**
 * Results header + summary chips section. Shown just below the simulate button.
 */
export function buildResultsTopSection(results) {
  const summary = results?.summary ?? null;
  const gamesSimulated = results?.gamesSimulated ?? null;
  const simulatedAt = results?.simulatedAt ?? null;

  const headerSuffix = gamesSimulated
    ? `<span class="muted" style="font-weight:400;margin-left:8px;font-size:11px">${gamesSimulated.toLocaleString()} simulations · ${formatRelativeTime(simulatedAt)}</span>`
    : `<span class="muted" style="font-weight:400;margin-left:8px;font-size:11px">No simulation run yet</span>`;

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Results${headerSuffix}</div>
      ${buildSummaryStats(summary)}
    </div>`;
}

/**
 * Mulligan depth chart + avg cards section in a two-column layout.
 */
export function buildResultsBottomSection(results, deck, resultView, resultSort = 'value') {
  const summary = results?.summary ?? null;
  return `
    <div class="section" style="margin-top:16px">
      <div class="results-two-col">
        <div>${buildMulliganDepthChart(summary)}</div>
        <div>${buildHandStatsSection(summary, deck, resultView, resultSort)}</div>
      </div>
      ${buildPerCardAnalysis(deck)}
    </div>`;
}

/**
 * Inline results section — legacy, kept for backward compatibility.
 * @param {SimulationResults|null} results
 * @param {DeckConfig} deck
 * @param {'tags'|'types'} resultView
 */
export function buildInlineResults(results, deck, resultView = 'tags', resultSort = 'value') {
  return buildResultsTopSection(results)
    + buildResultsBottomSection(results, deck, resultView, resultSort);
}

// ─── Summary Stat Chips ───────────────────────────────────────────────────────

function buildSummaryStats(summary) {
  const avgHand = summary?.avgHandSize?.toFixed(2) ?? '—';
  const greediness = summary?.greediness != null ? `${summary.greediness}%` : '—';

  let keepCard;
  const anyPct = summary?.goodHandAnyPct;
  if (anyPct !== null && anyPct !== undefined) {
    const quality = anyPct >= 60 ? 'good' : anyPct >= 40 ? 'warn' : 'bad';
    keepCard = buildResultCard('Kept Condition', `${anyPct}%`, 'Matched any keep def', quality);
  } else if (summary) {
    const landPct = summary.goodLandHandPct ?? 0;
    const quality = landPct >= 60 ? 'good' : landPct >= 40 ? 'warn' : 'bad';
    keepCard = buildResultCard('≥3 Lands', `${landPct}%`, 'Hands with 3+ lands', quality);
  } else {
    keepCard = buildResultCard('Keep Rate', '—', 'Matched any keep def', null);
  }

  return `
    <div class="results-grid">
      ${keepCard}
      ${buildResultCard('Avg Hand Size', avgHand, 'After mulligans', null)}
      ${buildResultCard('Greediness', greediness, '% games mulliganed', null)}
    </div>`;
}

// ─── Mulligan Depth Histogram ─────────────────────────────────────────────────

function buildMulliganDepthChart(summary) {
  const keepByDepth = summary?.keepRateByDepth ?? null;

  // Always render 8 columns (depths 0–7)
  const entries = Array.from({ length: 8 }, (_, d) => [d, keepByDepth?.[d] ?? 0]);
  const maxPct = Math.max(1, ...entries.map(([, v]) => v));

  const cols = entries.map(([depth, pct]) => {
    const label = DEPTH_LABELS[depth] ?? `Depth ${depth}`;
    const shortLabel = DEPTH_SHORT_LABELS[depth] ?? String(depth);
    const color = DEF_PALETTE[Number(depth)] ?? '#94a3b8';
    const barPct = Math.round((pct / maxPct) * 100);
    const countText = keepByDepth ? `${pct}%` : '—';
    return `
      <div class="mc-col" title="${label}: ${pct}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barPct}%;background:${color}">
            <span class="mc-col-count mc-col-count--above" style="color:${color}">${countText}</span>
          </div>
        </div>
        <div class="mc-col-label">${shortLabel}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Mulligan Depth</div>
    <div class="mc-col-chart mc-col-chart--mull">${cols}</div>`;
}

// ─── Avg Tags/Types Toggle ────────────────────────────────────────────────────

function buildHandStatsSection(summary, deck, resultView, resultSort = 'value') {
  const isTagsView = resultView !== 'types';
  const isByValue = resultSort !== 'alpha';

  const viewToggle = `
    <div class="view-toggle">
      <button class="view-toggle-btn ${isTagsView ? 'view-toggle-btn--active' : ''}"
        onclick="window.__res.setView('tags')">Tags</button>
      <button class="view-toggle-btn ${!isTagsView ? 'view-toggle-btn--active' : ''}"
        onclick="window.__res.setView('types')">Types</button>
    </div>`;

  const sortToggle = `
    <div class="view-toggle">
      <button class="view-toggle-btn ${isByValue ? 'view-toggle-btn--active' : ''}"
        onclick="window.__res.setSort('value')">Value</button>
      <button class="view-toggle-btn ${!isByValue ? 'view-toggle-btn--active' : ''}"
        onclick="window.__res.setSort('alpha')">Alpha</button>
    </div>`;

  const toggleRow = `<div class="hand-chart-toggles">${viewToggle}${sortToggle}</div>`;

  let rows;
  if (!summary) {
    rows = Array.from({ length: 4 }, () => `
      <div class="hand-chart-row">
        <div class="hand-chart-label"><span class="legend-dot" style="background:#374151"></span>—</div>
        <div class="hand-chart-bar-track"></div>
        <div class="hand-chart-value muted">—</div>
      </div>`).join('');
  } else if (isTagsView) {
    const moxTagCounts = summary.avgMoxTagCounts ?? {};
    let nonZero = Object.entries(moxTagCounts).filter(([, v]) => v > 0);
    nonZero = isByValue
      ? nonZero.sort(([, a], [, b]) => b - a)
      : nonZero.sort(([a], [b]) => a.localeCompare(b));
    if (!nonZero.length) {
      rows = `<p class="muted" style="font-size:11px">No tag data. Add Moxfield tags (e.g. #ramp) to your decklist.</p>`;
    } else {
      rows = nonZero.map(([tag, avg]) => {
        const label = tag.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const color = tagColor(tag);
        const barPct = Math.min(100, Math.round((avg / 3) * 100));
        return `
          <div class="hand-chart-row">
            <div class="hand-chart-label">
              <span class="legend-dot" style="background:${color}"></span>
              ${escapeHtml(label)}
            </div>
            <div class="hand-chart-bar-track">
              <div class="hand-chart-bar" style="width:${barPct}%;background:${color}"></div>
            </div>
            <div class="hand-chart-value">${avg.toFixed(2)}</div>
          </div>`;
      }).join('');
    }
  } else {
    const typeCounts = summary.avgTypeCountsInHand ?? {};
    let nonZero = CARD_TYPES.filter(t => (typeCounts[t] || 0) > 0)
      .map(t => [t, typeCounts[t]]);
    nonZero = isByValue
      ? nonZero.sort(([, a], [, b]) => b - a)
      : nonZero.sort(([a], [b]) => a.localeCompare(b));
    if (!nonZero.length) {
      rows = `<p class="muted" style="font-size:11px">No type data.</p>`;
    } else {
      rows = nonZero.map(([t, val]) => {
        const color = TYPE_COLORS[t] || '#6b7280';
        const barPct = Math.min(100, Math.round((val / 3) * 100));
        return `
          <div class="hand-chart-row">
            <div class="hand-chart-label">
              <span class="legend-dot" style="background:${color}"></span>
              ${escapeHtml(t)}
            </div>
            <div class="hand-chart-bar-track">
              <div class="hand-chart-bar" style="width:${barPct}%;background:${color}"></div>
            </div>
            <div class="hand-chart-value">${val.toFixed(2)}</div>
          </div>`;
      }).join('');
    }
  }

  return `
    <div class="section-label" style="margin-top:20px">Avg Cards in Kept Hand</div>
    ${toggleRow}
    <div class="hand-chart">${rows}</div>`;
}

// ─── Per-Card Draw Probability Analysis ──────────────────────────────────────

function getDrawCount(card) {
  const stored = card.categoryValues?.['Card Draw'];
  if (stored != null && stored > 0) return stored;
  const tag = card.effectTags?.find(t => t.subtype === 'draw_n' && t.value > 0);
  return tag?.value ?? null;
}

function getMillCount(card) {
  const stored = card.categoryValues?.['Mill'];
  if (stored != null && stored > 0) return stored;
  return null;
}

function buildDrawProbTable(drawN, deck) {
  const allCards = deck.cards;
  const deckTotal = allCards.reduce((s, c) => s + c.quantity, 0);
  const libSize = Math.max(1, deckTotal - 7);

  const catCounts = {};
  for (const cat of CANONICAL_CATEGORIES) {
    catCounts[cat] = allCards
      .filter(c => c.categories?.includes(cat))
      .reduce((s, c) => s + c.quantity, 0);
  }
  const landCount = allCards
    .filter(c => c.types?.includes('Land'))
    .reduce((s, c) => s + c.quantity, 0);

  const targets = [
    { label: 'Land', K: landCount, color: '#94a3b8' },
    ...CANONICAL_CATEGORIES
      .filter(cat => catCounts[cat] > 0)
      .map(cat => ({ label: cat, K: catCounts[cat], color: CATEGORY_COLORS[cat] || '#6b7280' })),
  ];

  const rows = targets.map(({ label, K, color }) => {
    const pPerUse = (hypgeomAtLeast(1, libSize, K, drawN) * 100).toFixed(1);
    const d80 = drawsNeeded(libSize, K, 0.80);
    const d95 = drawsNeeded(libSize, K, 0.95);
    const uses80 = d80 === Infinity ? '∞' : Math.ceil(d80 / drawN);
    const uses95 = d95 === Infinity ? '∞' : Math.ceil(d95 / drawN);
    const barPct = Math.min(100, Math.round(parseFloat(pPerUse)));

    return `
      <div class="draw-prob-row">
        <div class="draw-prob-label">
          <span class="legend-dot" style="background:${color}"></span>
          <span>${escapeHtml(label)}</span>
          <span class="muted" style="font-size:10px">(${K})</span>
        </div>
        <div class="draw-prob-bar-wrap">
          <div class="draw-prob-bar" style="width:${barPct}%;background:${color}"></div>
        </div>
        <div class="draw-prob-stat">${pPerUse}%</div>
        <div class="draw-prob-uses muted">${uses80}×<span style="font-size:9px"> 80%</span></div>
        <div class="draw-prob-uses muted">${uses95}×<span style="font-size:9px"> 95%</span></div>
      </div>`;
  }).join('');

  return `
    <div class="draw-prob-table">
      <div class="draw-prob-row draw-prob-header">
        <div class="draw-prob-label muted" style="font-size:10px">Category (K in deck)</div>
        <div class="draw-prob-bar-wrap"></div>
        <div class="draw-prob-stat muted" style="font-size:10px">P(≥1)/use</div>
        <div class="draw-prob-uses muted" style="font-size:10px">Uses@80%</div>
        <div class="draw-prob-uses muted" style="font-size:10px">Uses@95%</div>
      </div>
      ${rows}
    </div>
    <p class="muted" style="font-size:10px;margin-top:4px">
      Library: ${libSize} cards (deck − opening hand). P(≥1) = probability of hitting ≥1 of that category per use.
    </p>`;
}

function buildPerCardAnalysis(deck) {
  const allCards = deck.cards;

  const drawCards = allCards.filter(c => {
    if (!c.categories?.includes('Card Draw')) return false;
    return getDrawCount(c) != null;
  });

  const millCards = allCards.filter(c => {
    if (!c.categories?.includes('Mill')) return false;
    return getMillCount(c) != null;
  });

  const cascadeCards = allCards.filter(c =>
    c.categories?.includes('Cascade') || c.categories?.includes('Discover')
  );

  if (drawCards.length === 0 && millCards.length === 0 && cascadeCards.length === 0) {
    return '';
  }

  const buildCardSection = (cards, getCount, label) => cards.map(card => {
    const n = getCount(card);
    const tableHTML = buildDrawProbTable(n, deck);
    const qty = card.quantity > 1 ? `<span class="muted">${card.quantity}×</span> ` : '';
    return `
      <details class="card-analysis-item">
        <summary class="card-analysis-summary">
          ${qty}<span class="card-analysis-name">${escapeHtml(card.name)}</span>
          <span class="card-analysis-badge">${label} ${n}</span>
        </summary>
        <div class="card-analysis-body">
          ${tableHTML}
        </div>
      </details>`;
  }).join('');

  const cascadeRows = cascadeCards.map(card => {
    const cmc = card.cmc ?? '?';
    const qty = card.quantity > 1 ? `<span class="muted">${card.quantity}×</span> ` : '';
    const cat = card.categories?.includes('Cascade') ? 'Cascade' : 'Discover';
    return `
      <details class="card-analysis-item">
        <summary class="card-analysis-summary">
          ${qty}<span class="card-analysis-name">${escapeHtml(card.name)}</span>
          <span class="card-analysis-badge">${cat} · CMC ${cmc}</span>
        </summary>
        <div class="card-analysis-body">
          <p class="muted" style="font-size:11px">
            ${cat} hits any non-land card with CMC &lt; ${cmc}. Negative hypergeometric analysis coming in a future update.
          </p>
        </div>
      </details>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Per-Card Analysis</div>
    <p class="muted" style="font-size:11px;margin-bottom:8px">
      Probability of hitting each deck category when you use a draw/mill effect. Expand a card to see curves.
    </p>
    ${buildCardSection(drawCards, getDrawCount, 'draws')}
    ${buildCardSection(millCards, getMillCount, 'mills')}
    ${cascadeRows}`;
}

// ─── Shared Components ────────────────────────────────────────────────────────

function buildResultCard(label, value, sublabel, quality) {
  const qualityClass = quality ? `result-card--${quality}` : '';
  return `
    <div class="result-card ${qualityClass}">
      <div class="result-value">${value}</div>
      <div class="result-label">${label}</div>
      <div class="result-sub muted">${sublabel}</div>
    </div>`;
}
