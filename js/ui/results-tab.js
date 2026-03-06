import { getResultsForDeck } from '../storage.js';
import { TYPE_COLORS, escapeHtml, formatRelativeTime } from './shared.js';

export function buildResultsTab(deck, simGameCount = 1000, simMaxTurns = 10) {
  const allResults = getResultsForDeck(deck.id);
  const latest = allResults[allResults.length - 1] || null;

  const gameCountOptions = [100, 1000, 5000, 10000];
  const turnOptions = [...Array.from({length: 10}, (_, i) => i + 1), 15, 20];

  return `
    <div class="sim-controls section">
      <div class="section-label">Goldfishing</div>
      <div class="control-row">
        <label for="game-count">Games</label>
        <select id="game-count" class="select" onchange="window.__sim.setGameCount(this.value)">
          ${gameCountOptions.map(v =>
            `<option value="${v}" ${simGameCount === v ? 'selected' : ''}>${v.toLocaleString()}</option>`
          ).join('')}
        </select>
        <label for="max-turns">Turns</label>
        <select id="max-turns" class="select" onchange="window.__sim.setMaxTurns(this.value)">
          ${turnOptions.map(v =>
            `<option value="${v}" ${simMaxTurns === v ? 'selected' : ''}>${v}</option>`
          ).join('')}
        </select>
        <button id="run-sim-btn" class="btn-primary" data-deck-id="${deck.id}">
          ▶ Goldfish
        </button>
      </div>
    </div>
    ${latest ? buildResultsPanel(latest, deck) : ''}
  `;
}

function buildResultsPanel(results, deck) {
  if (!results) return '';
  const { summary, gamesSimulated, simulatedAt, enriched } = results;
  const cardImageMap = Object.fromEntries((deck?.cards ?? []).map(c => [c.name, c]));
  return `
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

      ${enriched ? buildTurnByTurnPanel(summary, cardImageMap) : ''}
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

function buildResultCard(label, value, sublabel, quality, extra = '') {
  const qualityClass = quality ? `result-card--${quality}` : '';
  return `
    <div class="result-card ${qualityClass}">
      <div class="result-value">${value}</div>
      <div class="result-label">${label}</div>
      <div class="result-sub muted">${sublabel}</div>
      ${extra}
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

/**
 * Build the turn-by-turn stats panel (only shown for enriched decks).
 * @param {Object} summary
 */
function buildTurnByTurnPanel(summary, cardImageMap = {}) {
  const { avgCardsDrawnByTurn, avgEffectDrawsPerGame, pctGamesWithDrawEffect, drawEffectSourceBreakdown, avgManaByTurn, avgManaFromRocksPerGame, avgMissedLandDrops, avgRocksPlayedPerGame } = summary;

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

  const CHART_COLORS = [
    '#4ade80', '#60a5fa', '#fbbf24', '#c084fc', '#fb923c', '#f87171',
    '#34d399', '#818cf8', '#f472b6', '#38bdf8', '#a3e635', '#fb7185',
    '#e879f9', '#facc15', '#4dd0e1', '#ff8a65',
  ];

  const sourceRows = sourceEntries.map(([name, avg], idx) => {
    const color   = CHART_COLORS[idx % CHART_COLORS.length];
    const imgUrl  = escapeHtml(cardImageMap[name]?.imageUrl     || '');
    const backUrl = escapeHtml(cardImageMap[name]?.backImageUrl || '');
    return `
      <div class="hand-chart-row">
        <div class="hand-chart-label" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;cursor:default"
          data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
          onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
          onmouseleave="window.__preview?.hide()">
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

    ${avgManaByTurn && Object.keys(avgManaByTurn).length > 0 ? buildManaChart(avgManaByTurn, avgManaFromRocksPerGame, avgRocksPlayedPerGame, avgMissedLandDrops) : ''}
  `;
}

function buildManaChart(avgManaByTurn, avgManaFromRocksPerGame, avgRocksPlayedPerGame, avgMissedLandDrops) {
  const turnEntries = Object.entries(avgManaByTurn).sort(([a], [b]) => Number(a) - Number(b));
  const maxMana = Math.max(...turnEntries.map(([, v]) => v), 1);
  const manaRows = turnEntries.map(([turn, avg]) => `
    <div class="hand-chart-row">
      <div class="hand-chart-label">Turn ${turn}</div>
      <div class="hand-chart-bar-track">
        <div class="hand-chart-bar" style="width:${Math.min((avg / maxMana) * 100, 100)}%;background:#f0b429"></div>
      </div>
      <div class="hand-chart-value">${avg.toFixed(1)}</div>
    </div>`).join('');

  return `
    <div class="results-grid" style="margin-top:20px">
      ${buildResultCard('Avg Rock Mana/Game', (avgManaFromRocksPerGame ?? 0).toFixed(1), 'Total mana from non-land sources over all turns', null)}
      ${buildResultCard('Avg Ramp Plays/Game', (avgRocksPlayedPerGame ?? 0).toFixed(1), 'Mana rocks & ramp creatures cast', null)}
      ${buildResultCard('Avg Missed Land Drops', (avgMissedLandDrops ?? 0).toFixed(1), 'Turns with no land played', null)}
    </div>
    <div class="section-label" style="margin-top:16px">Avg Mana Available by Turn</div>
    <div class="hand-chart">
      <div class="hand-chart-row hand-chart-header">
        <div class="hand-chart-label"></div>
        <div class="hand-chart-bar-track"></div>
        <div class="hand-chart-value muted" style="font-size:10px">Avg</div>
      </div>
      ${manaRows}
    </div>
  `;
}

/**
 * Render good hand def percentage bars inside the simulation results panel.
 */
function buildGoodHandDefResults(results) {
  const pcts = results?.summary?.goodHandDefPcts;

  // Retrieve def names from the stored results snapshot
  const defEntries = Object.entries(pcts || {});
  if (!defEntries.length) return '';

  // Distinct palette so each definition gets a unique bar color
  const DEF_PALETTE = [
    '#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#f87171',
    '#34d399', '#a78bfa', '#f472b6', '#38bdf8', '#a3e635', '#e879f9',
  ];

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
    <div class="section-label" style="margin-top:20px">Good Hand Definition Results</div>
    <div class="hand-chart">${rows}${totalRow}</div>`;
}
