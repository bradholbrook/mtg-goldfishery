/**
 * MTG Goldfish Simulator - UI Renderer
 *
 * Pure functions that build/update DOM from app state.
 * No framework — direct DOM manipulation, clean and fast.
 */

import { CARD_TYPES } from './types.js';
import { getDecks, getResultsForDeck } from './storage.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from './criteria.js';
import { EFFECT_TYPES, EFFECT_TYPE_OPTIONS } from './effect-types.js';

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
  const TAB_LABELS = { overview: 'Overview', cards: 'Effects', config: 'Mulligans', results: 'Simulate' };

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
      ${['overview', 'cards', 'config', 'results'].map(t => `
        <button class="tab-btn ${activeTab === t ? 'tab-btn--active' : ''}"
          onclick="window.__tab('${t}')">
          ${TAB_LABELS[t]}
        </button>`).join('')}
    </div>
    <div class="tab-content">
      ${activeTab === 'overview' ? buildOverviewTab(deck, expandedTypeGroups)       : ''}
      ${activeTab === 'cards'    ? buildCardsTab(deck, expandedEffectCards)         : ''}
      ${activeTab === 'config'   ? buildConfigTab(deck, editingDef)                : ''}
      ${activeTab === 'results'  ? buildResultsTab(deck, simGameCount, simMaxTurns) : ''}
    </div>
  `;

  // Wire run-sim button (only present in results tab)
  document.getElementById('run-sim-btn')?.addEventListener('click', () => {
    onRunSimulation(deck.id);
  });
}

// ─── Tab Content Builders ─────────────────────────────────────────────────────

function buildOverviewTab(deck, expandedTypeGroups = new Set()) {
  const groups = {};
  const sorted = [...deck.cards].sort((a, b) => {
    const ai = CARD_TYPES.findIndex(t => a.types?.includes(t));
    const bi = CARD_TYPES.findIndex(t => b.types?.includes(t));
    const td = (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return td !== 0 ? td : a.name.localeCompare(b.name);
  });
  for (const card of sorted) {
    const g = CARD_TYPES.find(t => card.types?.includes(t)) || 'Other';
    (groups[g] ??= []).push(card);
  }

  const rows = [...CARD_TYPES, 'Other'].filter(t => groups[t]).map(type => {
    const cards = groups[type];
    const count = cards.reduce((s, c) => s + c.quantity, 0);
    const isExpanded = expandedTypeGroups.has(type);
    const color = TYPE_COLORS[type] || TYPE_COLORS.Other;
    const cardRows = isExpanded ? cards.map(card => `
      <div class="type-group-card-row">
        <span class="muted">${card.quantity}×</span>
        <span>${escapeHtml(card.name)}</span>
        ${card.cmc != null ? `<span class="type-group-card-cmc muted">${card.cmc}</span>` : ''}
      </div>`).join('') : '';
    return `
      <div class="type-group-item">
        <div class="type-group-header" onclick="window.__ovr.toggle('${type}')">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="type-group-name">${type}</span>
          <span class="type-group-count muted">${count}</span>
          <span class="type-group-chevron">${isExpanded ? '▼' : '▶'}</span>
        </div>
        ${isExpanded ? `<div class="type-group-cards">${cardRows}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-label">Deck Composition</div>
      <div class="type-group-list">${rows}</div>
    </div>`;
}

function buildCardsTab(deck, expandedEffectCards = new Set()) {
  const groups = {};
  const sorted = [...deck.cards].sort((a, b) => {
    const ai = CARD_TYPES.findIndex(t => a.types?.includes(t));
    const bi = CARD_TYPES.findIndex(t => b.types?.includes(t));
    const td = (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return td !== 0 ? td : a.name.localeCompare(b.name);
  });
  for (const card of sorted) {
    const g = CARD_TYPES.find(t => card.types?.includes(t)) || 'Other';
    (groups[g] ??= []).push(card);
  }

  const rows = Object.entries(groups).map(([type, cards]) => `
    <div class="card-list-group-label">${type} (${cards.reduce((s, c) => s + c.quantity, 0)})</div>
    ${cards.map(card => buildCardRow(card, expandedEffectCards)).join('')}
  `).join('');

  return `<div class="card-list">${rows}</div>`;
}

function buildCardRow(card, expandedEffectCards = new Set()) {
  const isExpanded = expandedEffectCards.has(card.name);
  const allTags = card.effectTags || [];
  // When a user tag overrides an auto tag (same subtype+timing), show only the user tag.
  const userOverriddenKeys = new Set(
    allTags.filter(t => t.source === 'user').map(t => `${t.subtype}:${t.timing}`)
  );
  const chips = allTags
    .filter(t => t.tier !== 'skip')
    .filter(t => !(t.source === 'auto' && userOverriddenKeys.has(`${t.subtype}:${t.timing}`)))
    .map(t => {
      const typeInfo = EFFECT_TYPES[t.subtype];
      const label = typeInfo
        ? typeInfo.describe(t)
        : (t.value != null ? `${t.category}·${t.timing}·${t.value}` : `${t.category}·${t.timing}`);
      const sourceClass = t.source === 'user' ? ' effect-chip--user' : '';
      return `<span class="effect-chip effect-chip--${t.tier}${sourceClass}">${label}</span>`;
    }).join('');
  const cmc = card.cmc != null
    ? `<span class="card-row-cmc">${card.cmc}</span>`
    : `<span class="card-row-cmc muted">—</span>`;
  const chevron = `<span class="card-row-chevron">${isExpanded ? '▼' : '▶'}</span>`;
  const editor = isExpanded ? buildCardEffectEditor(card) : '';
  return `
    <div class="card-row-wrapper">
      <div class="card-row card-row--clickable" data-card-name="${escapeHtml(card.name)}"
           onclick="window.__eff.toggle(this.dataset.cardName)">
        <span class="card-row-qty muted">${card.quantity}×</span>
        <span class="card-row-name">${escapeHtml(card.name)}</span>
        <span class="card-row-tags">${chips}</span>
        ${cmc}
        ${chevron}
      </div>
      ${editor}
    </div>`;
}

// ─── Card Effect Editor ───────────────────────────────────────────────────────

/**
 * True if the card has at least one face that isn't an instant or sorcery.
 * Used to filter permanentOnly effect types (e.g. mana_rock).
 * @param {Card} card
 * @returns {boolean}
 */
function hasPermanentFace(card) {
  const nonPermanentTypes = ['Instant', 'Sorcery'];
  return (card.types ?? []).some(t => !nonPermanentTypes.includes(t));
}

/**
 * Render the inline effect editor for a card (shown when expanded).
 *
 * Auto-detected section: each auto tag shows as a chip with an "Override" button.
 * If a user override exists for that (subtype, timing), it replaces the chip with
 * an editable row (subtype/timing fixed, only values editable).
 *
 * Additions section: user tags that don't override any auto tag, with full
 * subtype+timing dropdowns. Auto-covered (subtype, timing) pairs are excluded
 * from the timing dropdown to prevent conflicts.
 *
 * @param {Card} card
 * @returns {string} HTML
 */
function buildCardEffectEditor(card) {
  const cardNameAttr = escapeHtml(card.name);
  const isPermanent = hasPermanentFace(card);
  const allTags = card.effectTags || [];

  const autoTags = allTags.filter(t => t.source === 'auto' && t.tier !== 'skip');
  const userTags = allTags.filter(t => t.source === 'user');

  // Keys already covered by auto detection: Set of "subtype:timing"
  const autoCoveredKeys = new Set(autoTags.map(t => `${t.subtype}:${t.timing}`));

  // Split user tags into overrides (same subtype:timing as an auto tag) vs. additions
  const userOverrideMap = new Map(); // "subtype:timing" → { tag, fullIdx }
  const userAdditions = [];          // { tag, fullIdx }
  for (const tag of userTags) {
    const key = `${tag.subtype}:${tag.timing}`;
    const fullIdx = allTags.indexOf(tag);
    if (autoCoveredKeys.has(key)) {
      userOverrideMap.set(key, { tag, fullIdx });
    } else {
      userAdditions.push({ tag, fullIdx });
    }
  }

  // ── Auto-detected section ──────────────────────────────────────────────────
  const autoSection = autoTags.length > 0
    ? autoTags.map(autoTag => {
        const key = `${autoTag.subtype}:${autoTag.timing}`;
        const overrideData = userOverrideMap.get(key);
        return overrideData
          ? buildOverrideRow(autoTag, overrideData.tag, overrideData.fullIdx, cardNameAttr)
          : buildAutoTagRow(autoTag, cardNameAttr);
      }).join('')
    : `<span class="muted" style="font-size:11px">None detected</span>`;

  // All subtypes already present on this card (auto + user) — used to hide
  // entire subtypes from the Add dropdown (one effect type per card).
  const coveredSubtypes = new Set(allTags.map(t => t.subtype));

  // ── Additions section ──────────────────────────────────────────────────────
  const additionRows = userAdditions.map(({ tag, fullIdx }) =>
    buildUserAdditionRow(tag, fullIdx, cardNameAttr, isPermanent, autoCoveredKeys, coveredSubtypes)
  ).join('');

  const addBtn = `
    <button class="btn-secondary btn-sm btn-add" data-card-name="${cardNameAttr}"
      onclick="window.__eff.add(this.dataset.cardName)">+ Add effect</button>`;

  return `
    <div class="card-effect-editor">
      <div class="card-effect-section">
        <div class="card-effect-section-label">Auto-detected</div>
        <div class="card-effect-auto-tags">${autoSection}</div>
      </div>
      <div class="card-effect-section">
        <div class="card-effect-section-label">Your additions</div>
        ${additionRows}
        ${addBtn}
      </div>
      <div class="card-effect-editor-footer">
        <button class="btn-primary btn-sm" data-card-name="${cardNameAttr}"
          onclick="window.__eff.toggle(this.dataset.cardName)">Done</button>
      </div>
    </div>`;
}

/**
 * Render an auto-detected tag as a chip + "Override" button.
 * Shown when no user override exists for this (subtype, timing).
 */
function buildAutoTagRow(autoTag, cardNameAttr) {
  const typeInfo = EFFECT_TYPES[autoTag.subtype];
  const label = typeInfo ? typeInfo.describe(autoTag) : `${autoTag.subtype}·${autoTag.timing}`;
  return `
    <div class="effect-auto-row">
      <span class="effect-chip effect-chip--${autoTag.tier}">${label}</span>
      <button class="btn-effect-override"
        data-card-name="${cardNameAttr}"
        data-subtype="${autoTag.subtype}"
        data-timing="${autoTag.timing}"
        onclick="window.__eff.override(this.dataset.cardName, this.dataset.subtype, this.dataset.timing)"
        title="Customize this effect's sim behaviour">Override</button>
    </div>`;
}

/**
 * Render an editable override row for an auto-detected tag.
 * Subtype and timing are fixed (shown as labels). Only value fields are editable.
 */
function buildOverrideRow(autoTag, userTag, fullIdx, cardNameAttr) {
  const typeInfo = EFFECT_TYPES[userTag.subtype];
  const fieldWidgets = (typeInfo?.fields ?? []).map(f =>
    buildEffectFieldWidget(f, userTag, fullIdx, cardNameAttr)
  ).join('');

  return `
    <div class="effect-tag-row effect-tag-row--override">
      <div class="effect-tag-row-fields">
        <span class="effect-override-label">${escapeHtml(userTag.subtype)} @ ${escapeHtml(userTag.timing)}</span>
        ${fieldWidgets}
        ${buildConditionalExtras(userTag, fullIdx, cardNameAttr)}
      </div>
      <button class="btn-icon btn-danger effect-tag-remove" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
        onclick="window.__eff.remove(this.dataset.cardName, Number(this.dataset.tagIdx))"
        title="Remove override — restores auto behaviour">✕</button>
    </div>`;
}

/**
 * Render an editable row for a user-added effect (not overriding any auto tag).
 * Timing dropdown excludes any (subtype, timing) pairs already covered by auto tags.
 */
function buildUserAdditionRow(tag, fullIdx, cardNameAttr, isPermanent, autoCoveredKeys, coveredSubtypes) {
  // Show only subtypes not already present on the card, plus the current one.
  const availableTypes = EFFECT_TYPE_OPTIONS.filter(et =>
    (!et.permanentOnly || isPermanent) &&
    (!coveredSubtypes.has(et.id) || et.id === tag.subtype)
  );
  const subtypeSelect = `
    <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
      onchange="window.__eff.setSubtype(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)">
      ${availableTypes.map(et =>
        `<option value="${et.id}" ${et.id === tag.subtype ? 'selected' : ''}>${et.label}</option>`
      ).join('')}
    </select>`;

  const typeInfo = EFFECT_TYPES[tag.subtype];
  // Exclude timings already covered by an auto tag for this subtype
  const validTimings = (typeInfo?.validTimings ?? ['etb', 'upkeep', 'cast', 'tap', 'death', 'passive'])
    .filter(tm => !autoCoveredKeys.has(`${tag.subtype}:${tm}`));
  const timingSelect = `
    <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
      onchange="window.__eff.setTiming(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)">
      ${validTimings.map(tm =>
        `<option value="${tm}" ${tm === tag.timing ? 'selected' : ''}>${tm}</option>`
      ).join('')}
    </select>`;

  const fieldWidgets = (typeInfo?.fields ?? []).map(f =>
    buildEffectFieldWidget(f, tag, fullIdx, cardNameAttr)
  ).join('');

  return `
    <div class="effect-tag-row">
      <div class="effect-tag-row-fields">
        ${subtypeSelect}
        ${timingSelect}
        ${fieldWidgets}
        ${buildConditionalExtras(tag, fullIdx, cardNameAttr)}
      </div>
      <button class="btn-icon btn-danger effect-tag-remove" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
        onclick="window.__eff.remove(this.dataset.cardName, Number(this.dataset.tagIdx))"
        title="Remove">✕</button>
    </div>`;
}

/**
 * Render tier-select + expected-value input for conditional user tags.
 * Returns empty string if tag.isConditional is false.
 */
function buildConditionalExtras(tag, fullIdx, cardNameAttr) {
  if (!tag.isConditional) return '';
  const tierSelect = `
    <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
      onchange="window.__eff.setTier(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)"
      title="Simulation mode">
      <option value="track_only"  ${tag.tier === 'track_only'  ? 'selected' : ''}>Track only</option>
      <option value="simulatable" ${tag.tier === 'simulatable' ? 'selected' : ''}>Simulate</option>
    </select>`;
  const evInput = tag.tier === 'simulatable'
    ? `<input type="number" class="input-number" style="width:64px"
        value="${tag.expectedValue ?? ''}" step="0.5" min="0" max="20"
        placeholder="EV"
        data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}" data-field-key="expectedValue"
        oninput="window.__eff.setField(this.dataset.cardName, Number(this.dataset.tagIdx), this.dataset.fieldKey, this.value === '' ? null : Number(this.value))"
        title="Expected draws per trigger in sim" />`
    : '';
  return tierSelect + evInput;
}

/**
 * Render a single field widget inside an effect tag editor row.
 */
function buildEffectFieldWidget(field, tag, tagIdx, cardNameAttr) {
  const val = tag[field.key];

  if (field.widget === 'number') {
    return `
      <label class="effect-field-label">${field.label}
        <input type="number" class="input-number"
          value="${val ?? field.default ?? 1}"
          min="${field.min ?? 1}" max="${field.max ?? 99}"
          data-card-name="${cardNameAttr}" data-tag-idx="${tagIdx}" data-field-key="${field.key}"
          oninput="window.__eff.setField(this.dataset.cardName, Number(this.dataset.tagIdx), this.dataset.fieldKey, Number(this.value))" />
      </label>`;
  }

  if (field.widget === 'text') {
    return `
      <label class="effect-field-label">${field.label}
        <input type="text" class="input-text" style="width:90px;padding:4px 7px;font-size:11px"
          value="${escapeHtml(val ?? field.default ?? '')}"
          data-card-name="${cardNameAttr}" data-tag-idx="${tagIdx}" data-field-key="${field.key}"
          oninput="window.__eff.setField(this.dataset.cardName, Number(this.dataset.tagIdx), this.dataset.fieldKey, this.value)" />
      </label>`;
  }

  if (field.widget === 'checkbox') {
    return `
      <label class="type-checkbox-label" style="gap:5px">
        <input type="checkbox" ${val ? 'checked' : ''}
          data-card-name="${cardNameAttr}" data-tag-idx="${tagIdx}" data-field-key="${field.key}"
          onchange="window.__eff.setField(this.dataset.cardName, Number(this.dataset.tagIdx), this.dataset.fieldKey, this.checked)" />
        ${escapeHtml(field.label)}
      </label>`;
  }

  return '';
}

function buildConfigTab(deck, editingDef) {
  return buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id));
}

function buildResultsTab(deck, simGameCount = 1000, simMaxTurns = 10) {
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
    ${latest ? buildResultsPanel(latest) : ''}
  `;
}

function buildResultsPanel(results) {
  if (!results) return '';
  const { summary, gamesSimulated, simulatedAt, enriched } = results;
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

  // Def names are stored in results.goodHandDefNames at sim time.
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
