import { getResultsForDeck } from '../storage.js';
import { CATEGORY_COLORS, escapeHtml, formatRelativeTime } from './shared.js';
import { CANONICAL_CATEGORIES } from '../types.js';
import { hypgeomAtLeast, drawsNeeded } from '../hypergeometric.js';

const DEF_PALETTE = [
  '#4ade80', '#60a5fa', '#fbbf24', '#fb923c', '#f87171',
  '#34d399', '#a78bfa', '#f472b6', '#38bdf8', '#a3e635', '#e879f9', '#94a3b8',
];

export function buildResultsTab(deck) {
  const allResults = getResultsForDeck(deck.id);
  const latest = allResults[allResults.length - 1] || null;

  if (!latest) {
    return `
      <div class="section">
        <div class="section-label">Results</div>
        <p class="muted" style="font-size:12px">
          No simulation run yet. Go to the Mulligan tab and click Run Simulation.
        </p>
      </div>`;
  }

  return buildResultsPanel(latest, deck);
}

function buildResultsPanel(results, deck) {
  if (!results) return '';
  const { summary, gamesSimulated, simulatedAt } = results;

  return `
    <div class="results-panel section">
      <div class="section-label">
        Results — ${gamesSimulated.toLocaleString()} simulations
        <span class="muted" style="font-weight:400;margin-left:8px">${formatRelativeTime(simulatedAt)}</span>
      </div>

      ${buildSummaryStats(summary)}
      ${buildMulliganDepthChart(summary)}
      ${buildGoodHandDefResults(results)}
      ${buildCastabilitySection(summary)}
      ${buildCategoryHandStats(summary)}
      ${buildPerCardAnalysis(deck)}
    </div>
  `;
}

// ─── Summary Stat Cards ───────────────────────────────────────────────────────

function buildSummaryStats(summary) {
  const avgHand = summary.avgHandSize?.toFixed(2) ?? '7.00';
  const greediness = summary.greediness != null ? `${summary.greediness}%` : '—';

  const anyPct = summary.goodHandAnyPct;
  let keepCard;
  if (anyPct !== null && anyPct !== undefined) {
    const quality = anyPct >= 60 ? 'good' : anyPct >= 40 ? 'warn' : 'bad';
    keepCard = buildResultCard('Kept Condition', `${anyPct}%`, 'Matched any keep def', quality);
  } else {
    const landPct = summary.goodLandHandPct;
    const quality = landPct >= 60 ? 'good' : landPct >= 40 ? 'warn' : 'bad';
    keepCard = buildResultCard('≥3 Lands', `${landPct}%`, 'Hands with 3+ lands', quality);
  }

  const avgCastTurn = summary.avgCastableTurn;
  const castCard = avgCastTurn !== null && avgCastTurn !== undefined
    ? buildResultCard('Avg Cast Turn', `T${avgCastTurn}`, 'Commander castable', null)
    : '';

  return `
    <div class="results-grid">
      ${keepCard}
      ${buildResultCard('Avg Hand Size', avgHand, 'After mulligans', null)}
      ${buildResultCard('Greediness', greediness, '% games mulliganed', null)}
      ${castCard}
    </div>`;
}

// ─── Mulligan Depth Histogram ─────────────────────────────────────────────────

function buildMulliganDepthChart(summary) {
  const keepByDepth = summary.keepRateByDepth;
  if (!keepByDepth) return '';

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

  const entries = Object.entries(keepByDepth);
  const maxPct = Math.max(1, ...entries.map(([, v]) => v));

  const cols = entries.map(([depth, pct]) => {
    const label = DEPTH_LABELS[depth] ?? `Depth ${depth}`;
    const color = DEF_PALETTE[Number(depth)] ?? '#94a3b8';
    const barPct = Math.round((pct / maxPct) * 100);
    return `
      <div class="mc-col" title="${label}: ${pct}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barPct}%;background:${color}"></div>
        </div>
        <div class="mc-col-count" style="color:${color}">${pct}%</div>
        <div class="mc-col-label">${Number(depth) <= 1 ? (depth === '0' ? 'K7' : 'K7f') : `K${7 - (Number(depth) - 1)}`}</div>
      </div>`;
  }).join('');

  // Legend
  const legend = entries.map(([depth, pct]) => {
    const label = DEPTH_LABELS[depth] ?? `Depth ${depth}`;
    const color = DEF_PALETTE[Number(depth)] ?? '#94a3b8';
    return `<span class="mull-legend-item"><span class="legend-dot" style="background:${color}"></span>${label} <strong>${pct}%</strong></span>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Mulligan Depth</div>
    <div class="mc-col-chart mc-col-chart--mull">${cols}</div>
    <div class="mull-legend">${legend}</div>`;
}

// ─── Keep Condition Results ───────────────────────────────────────────────────

function buildGoodHandDefResults(results) {
  const pcts = results?.summary?.goodHandDefPcts;
  const defEntries = Object.entries(pcts || {});
  if (!defEntries.length) return '';

  const rows = defEntries.map(([defId, pct], idx) => {
    const name = results.goodHandDefNames?.[defId] || defId;
    const color = DEF_PALETTE[idx % DEF_PALETTE.length];
    return `
      <div class="hand-chart-row hand-chart-row--with-btn">
        <div class="hand-chart-label" style="overflow:hidden;text-overflow:ellipsis">
          <span class="legend-dot" style="background:${color}"></span>
          ${escapeHtml(name)}
        </div>
        <button class="btn-secondary btn-sm" onclick="window.__ghh.sampleDef('${defId}')">Sample</button>
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
    <div class="section-label" style="margin-top:20px">Keep Condition Results</div>
    <div class="hand-chart">${rows}${totalRow}</div>`;
}

// ─── Commander Castability Curve ──────────────────────────────────────────────

function buildCastabilitySection(summary) {
  const castByTurn = summary.castabilityByTurn;
  if (!castByTurn || Object.keys(castByTurn).length === 0) return '';

  const castEntries = Object.entries(castByTurn);
  const maxCastPct = Math.max(1, ...castEntries.map(([, v]) => v));

  const cols = castEntries.map(([turn, pct]) => {
    const color = DEF_PALETTE[(Number(turn) - 1) % DEF_PALETTE.length];
    const barPct = Math.round((pct / maxCastPct) * 100);
    return `
      <div class="mc-col" title="Turn ${turn}: ${pct}%">
        <div class="mc-col-bar-wrap">
          <div class="mc-col-bar" style="height:${barPct}%;background:${color}"></div>
        </div>
        <div class="mc-col-count" style="color:${color}">${pct}%</div>
        <div class="mc-col-label">T${turn}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Commander Castability by Turn</div>
    <p class="muted" style="font-size:11px;margin-bottom:8px">Cumulative probability of having enough mana to cast your commander by turn N.</p>
    <div class="mc-col-chart mc-col-chart--cast">${cols}</div>`;
}

// ─── Category Coverage in Kept Hands ─────────────────────────────────────────

function buildCategoryHandStats(summary) {
  const cats = summary.avgCategoryCounts;
  if (!cats) return '';

  const nonZero = CANONICAL_CATEGORIES.filter(cat => (cats[cat] || 0) > 0);
  if (!nonZero.length) return '';

  const rows = nonZero.map(cat => {
    const avg = cats[cat].toFixed(2);
    const color = CATEGORY_COLORS[cat] || '#6b7280';
    const barPct = Math.min(100, Math.round((cats[cat] / 3) * 100));
    return `
      <div class="hand-chart-row">
        <div class="hand-chart-label">
          <span class="legend-dot" style="background:${color}"></span>
          ${cat}
        </div>
        <div class="hand-chart-bar-track">
          <div class="hand-chart-bar" style="width:${barPct}%;background:${color}"></div>
        </div>
        <div class="hand-chart-value">${avg}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label" style="margin-top:20px">Avg Category Cards in Kept Hand</div>
    <div class="hand-chart">${rows}</div>`;
}

// ─── Per-Card Draw Probability Analysis ──────────────────────────────────────

/**
 * Get a card's effective draw count: categoryValues first, then effectTags fallback.
 */
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

/**
 * Build the shared probability table for a given draw/mill count N.
 * Library: deckTotal - 7 cards after opening hand.
 * Shows P(≥1) per use and uses needed to reach 80%/95% for each category.
 */
function buildDrawProbTable(drawN, deck) {
  const allCards = deck.cards;
  const deckTotal = allCards.reduce((s, c) => s + c.quantity, 0);
  const libSize = Math.max(1, deckTotal - 7);

  // Count each category in the full deck (proxy for library after avg hand)
  const catCounts = {};
  for (const cat of CANONICAL_CATEGORIES) {
    catCounts[cat] = allCards
      .filter(c => c.categories?.includes(cat))
      .reduce((s, c) => s + c.quantity, 0);
  }
  // Also include Land as a target
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

/**
 * Per-card analysis section: expandable rows for draw/mill cards.
 * Uses <details>/<summary> for zero-JS accordion.
 */
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
