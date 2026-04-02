import { CARD_TYPES } from '../types.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';
import { getResultsForDeck } from '../storage.js';
import { escapeHtml } from './shared.js';
import { buildResultsTopSection, buildResultsBottomSection } from './results-tab.js';

let _bottomOpen = false;
export function setBottomOpen(v) { _bottomOpen = v; }

// ─── Mull Applicability ───────────────────────────────────────────────────────

function minCardsRequired(def) {
  return (def.criteria || []).reduce((sum, c) => sum + (Number(c.count) || 1), 0);
}

function mullApplicabilityNote(def) {
  const min = minCardsRequired(def);
  if (min > 7) {
    return `<span class="mull-note mull-note--warn">⚠ needs ${min} cards — can never be satisfied</span>`;
  }
  if (min === 0) return '';
  const noteClass = min <= 4 ? 'mull-note--ok' : min <= 6 ? 'mull-note--mid' : 'mull-note--tight';
  return `<span class="mull-note ${noteClass}">requires ≥${min} cards</span>`;
}

export function buildMulliganTab(deck, editingDef, results, resultView, resultSort = 'value') {
  const bottomPriorityCollapsible = `
    <details class="category-config-editor" style="margin-top:16px" ${_bottomOpen ? 'open' : ''}
      ontoggle="window.__disc.toggleBottom(this.open)">
      <summary class="category-config-summary">Bottom Selection Priority</summary>
      <div class="category-config-body">
        ${buildBottomSelectionSection(deck)}
      </div>
    </details>`;

  return buildRunSection(deck)
    + buildResultsTopSection(results)
    + buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id))
    + bottomPriorityCollapsible
    + buildResultsBottomSection(results, deck, resultView, resultSort);
}

// ─── Good Hand Section ────────────────────────────────────────────────────────

function buildGoodHandSection(deck, editingDef, allResults) {
  const defs = deck.goodHandDefs || [];
  const latestResult = allResults[allResults.length - 1] || null;

  const defListHTML = defs.map((def, defIdx) => {
    const isExpanded = editingDef?.defId === def.id;
    const pct = latestResult?.summary?.goodHandDefPcts?.[def.id];
    const pctBadge = pct !== undefined
      ? `<span class="def-pct ${pct >= 60 ? 'def-pct--good' : pct >= 40 ? 'def-pct--warn' : 'def-pct--bad'}">${pct}%</span>`
      : `<span class="def-pct def-pct--none">—</span>`;
    const criteriaDesc = def.criteria.map(c => {
      const t = CRITERION_TYPES[c.type];
      return escapeHtml(t ? t.describe(c) : c.type);
    }).join('<br>');
    const applicabilityNote = mullApplicabilityNote(def);

    const sampleBtn = `<button class="btn-secondary btn-sm def-sample-btn" onclick="event.stopPropagation();window.__ghh.sampleDef('${def.id}')" title="Show 3 sample hands">Sample</button>`;

    const dragAttrs = `
      draggable="true"
      ondragstart="window.__ghh.dragStart(${defIdx})"
      ondragover="event.preventDefault()"
      ondrop="window.__ghh.drop(${defIdx})"
      ondragenter="this.classList.add('drop-target-before')"
      ondragleave="if(!this.contains(event.relatedTarget))this.classList.remove('drop-target-before')"
      ondragend="document.querySelectorAll('.drop-target-before').forEach(el=>el.classList.remove('drop-target-before'))"`;

    if (isExpanded) {
      return `
        <div class="def-item def-item--expanded" ${dragAttrs}>
          <div class="def-item-header" onclick="window.__ghh.editDef('${def.id}')">
            <span class="drag-handle" title="Drag to reorder priority">⠿</span>
            <span class="def-item-chevron">▼</span>
            <div class="def-item-info">
              <span class="def-item-name">${escapeHtml(def.name)}</span>
              <span class="def-item-desc muted">${criteriaDesc}</span>
            </div>
            <div class="def-item-right">
              <div class="def-item-actions">
                ${pctBadge}
                ${sampleBtn}
              </div>
              ${applicabilityNote}
            </div>
            <div class="def-item-remove-col">
              <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
            </div>
          </div>
          ${buildGoodHandEditor(editingDef, deck)}
        </div>`;
    }

    return `
      <div class="def-item def-item--clickable" ${dragAttrs}
        onclick="window.__ghh.editDef('${def.id}')">
        <span class="drag-handle" title="Drag to reorder priority">⠿</span>
        <span class="def-item-chevron">▶</span>
        <div class="def-item-info">
          <span class="def-item-name">${escapeHtml(def.name)}</span>
          <span class="def-item-desc muted">${criteriaDesc}</span>
        </div>
        <div class="def-item-right">
          <div class="def-item-actions">
            ${pctBadge}
            ${sampleBtn}
          </div>
          ${applicabilityNote}
        </div>
        <div class="def-item-remove-col">
          <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');

  const newDefEditor = editingDef?.defId === null
    ? `<div class="def-item def-item--expanded" style="margin-bottom:6px">${buildGoodHandEditor(editingDef, deck)}</div>`
    : '';
  const addBtn = editingDef?.defId === null
    ? ''
    : `<button class="btn-secondary btn-sm" onclick="window.__ghh.addDef()">+ Add Definition</button>`;

  const priorityHint = defs.length > 1
    ? `<p class="muted" style="font-size:11px;margin-bottom:8px">Definitions are checked in order (top = highest priority). Drag to reorder.</p>`
    : '';

  return `
    <div class="section">
      <div class="section-label">Keep Conditions</div>
      <p class="muted" style="font-size:12px;margin-bottom:6px">
        Define what makes a hand worth keeping. The simulator checks each definition in order and keeps
        the first match. If a definition's criteria can be satisfied by fewer cards than the hand size,
        it auto-applies at that mull depth.
      </p>
      ${priorityHint}
      ${defs.length === 0 && !editingDef
        ? `<p class="muted" style="font-size:12px;margin-bottom:10px">No definitions yet. Define what a keepable hand looks like.</p>`
        : defListHTML}
      ${newDefEditor}
      ${addBtn}
    </div>`;
}

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
        <button class="btn-secondary btn-sm" style="margin-top:6px;align-self:flex-start"
          onclick="window.__ghh.addCrit()">+ Add Criterion</button>
      </div>
      <div class="def-editor-applicability">
        ${mullApplicabilityNote(editingDef)}
      </div>
      <div class="def-editor-actions">
        <button class="btn-primary" onclick="window.__ghh.saveDef()">Save Definition</button>
        <button class="btn-secondary" onclick="window.__ghh.cancelEdit()">Cancel</button>
      </div>
    </div>`;
}

/**
 * Render a single criterion row in sentence style:
 * "Has at least [N] of [type dropdown] [value multiselect(s)] [✕]"
 */
function buildCriterionRow(crit, idx, deck) {
  const typeInfo = CRITERION_TYPES[crit.type];
  const fields   = typeInfo?.fields || [];

  // Count field (always first)
  const countField = fields.find(f => f.key === 'count');
  const countWidget = countField
    ? `<input type="number" class="input-number crit-count"
        value="${crit.count ?? countField.min ?? 1}"
        min="${countField.min || 1}" max="${countField.max || 7}"
        oninput="window.__ghh.setVal(${idx},'count',Number(this.value))" />`
    : '';

  // Criterion type selector (custom single-select dropdown)
  const typeDropdown = buildCritTypeDropdown(crit, idx);

  // Value fields (everything except count)
  const valueFields = fields.filter(f => f.key !== 'count');
  const valueWidgetsHTML = valueFields.map(f => {
    const prefix = f.prefix
      ? `<span class="crit-label">${escapeHtml(f.prefix)}</span>`
      : '';
    return prefix + buildFieldWidget(f, crit, idx, deck);
  }).join('');

  return `
    <div class="criterion-row" data-crit-idx="${idx}">
      <span class="crit-label">Has at least</span>
      ${countWidget}
      <span class="crit-label">of</span>
      ${typeDropdown}
      ${valueWidgetsHTML}
      <div class="crit-remove-col">
        <button class="btn-icon btn-danger" onclick="window.__ghh.removeCrit(${idx})" title="Remove">✕</button>
      </div>
    </div>`;
}

/** Custom single-select dropdown for criterion type selection */
function buildCritTypeDropdown(crit, idx) {
  const typeInfo = CRITERION_TYPES[crit.type];
  const label = typeInfo?.label ?? crit.type;

  return `
    <details class="crit-type-dropdown">
      <summary class="crit-type-toggle">${escapeHtml(label)}</summary>
      <div class="crit-type-list">
        ${CRITERION_TYPE_OPTIONS.map(ct => `
          <div class="crit-type-option ${ct.id === crit.type ? 'crit-type-option--active' : ''}"
            onclick="window.__ghh.changeType(${idx},'${ct.id}');this.closest('details').removeAttribute('open')">
            ${escapeHtml(ct.label)}
          </div>`
        ).join('')}
      </div>
    </details>`;
}

// ─── Bottom Selection Section ─────────────────────────────────────────────────

const MODIFIER_OPTIONS = [
  { value: 'highest_cmc', label: 'Highest CMC' },
  { value: 'lowest_cmc',  label: 'Lowest CMC' },
  { value: 'any',         label: 'Any' },
];

const BOTTOM_CARD_TYPES = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown');

function buildBottomSelectionSection(deck) {
  const priorities = deck.discardPriorities || [];

  const rowsHTML = priorities.map((rule, idx) => {
    const currentModifier = MODIFIER_OPTIONS.find(o => o.value === rule.modifier) ?? MODIFIER_OPTIONS[0];
    const modifierDropdown = `
      <details class="crit-type-dropdown">
        <summary class="crit-type-toggle">${escapeHtml(currentModifier.label)}</summary>
        <div class="crit-type-list">
          ${MODIFIER_OPTIONS.map(o => `
            <div class="crit-type-option ${o.value === rule.modifier ? 'crit-type-option--active' : ''}"
              onclick="window.__disc.setModifier(${idx},'${o.value}');this.closest('details').removeAttribute('open')">
              ${escapeHtml(o.label)}
            </div>`).join('')}
        </div>
      </details>`;

    // Normalize cardTypes: handle legacy cardType string; show in BOTTOM_CARD_TYPES order
    const rawTypes = Array.isArray(rule.cardTypes)
      ? rule.cardTypes
      : (rule.cardType && rule.cardType !== 'Any' ? [rule.cardType] : []);
    const selectedTypes = BOTTOM_CARD_TYPES.filter(t => rawTypes.includes(t));
    const typeSummary = selectedTypes.length > 0 ? selectedTypes.join('/') : '(any type)';

    const typeItems = BOTTOM_CARD_TYPES.map(t => {
      const checked = selectedTypes.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__disc.toggleType(${idx},'${t}')">
        <span>${t}</span>
      </label>`;
    }).join('');

    return `
      <div class="disc-priority-row" data-disc-idx="${idx}"
        draggable="true"
        ondragstart="window.__disc.dragStart(${idx})"
        ondragover="event.preventDefault()"
        ondrop="window.__disc.drop(${idx})"
        ondragenter="this.classList.add('drop-target-before')"
        ondragleave="if(!this.contains(event.relatedTarget))this.classList.remove('drop-target-before')"
        ondragend="document.querySelectorAll('.drop-target-before').forEach(el=>el.classList.remove('drop-target-before'))">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        ${modifierDropdown}
        <span class="crit-label">of</span>
        <details class="crit-ms-dropdown">
          <summary class="crit-ms-toggle disc-ms-toggle">${escapeHtml(typeSummary)}</summary>
          <div class="crit-ms-list">${typeItems}</div>
        </details>
        <div class="crit-remove-col">
          <button class="btn-icon btn-danger" onclick="window.__disc.remove(${idx})" title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');

  const defaultRuleHTML = `
    <div class="disc-priority-row disc-priority-row--default">
      <span class="drag-handle muted" style="opacity:0.3">⠿</span>
      <span class="muted" style="font-size:11px">Highest CMC</span>
      <span class="crit-label">of</span>
      <span class="muted" style="font-size:11px">(any type)</span>
      <span class="muted" style="font-size:10px;margin-left:auto">(default fallback)</span>
    </div>`;

  const listHTML = `<div id="disc-priority-list">${rowsHTML}${defaultRuleHTML}</div>
    ${priorities.length > 0 ? `<p class="muted" style="font-size:11px;margin-top:6px">Rules evaluated top-to-bottom; default applies if no rule matches.</p>` : ''}`;

  return `
    <div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">
        When mulliganing to 6/5/4, cards are put back according to these rules (top-to-bottom, first match wins).
      </p>
      ${listHTML}
      <button class="btn-secondary btn-sm" style="margin-top:6px" onclick="window.__disc.add()">+ Add Rule</button>
    </div>`;
}

// ─── Run Section ─────────────────────────────────────────────────────────────

function buildRunSection(deck) {
  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Simulation</div>
      <p class="muted" style="font-size:12px;margin-bottom:10px">
        Runs 100,000 London Mulligan simulations and evaluates your keep conditions.
      </p>
      <button id="run-sim-btn" class="btn-primary" data-deck-id="${deck.id}">
        ▶ Run Simulation
      </button>
    </div>`;
}

// ─── Field Widgets ────────────────────────────────────────────────────────────

const MV_VALUES = ['0', '1', '2', '3', '4', '5', '6+'];

function buildFieldWidget(field, crit, idx, deck) {
  const val = crit[field.key];

  // ── Legacy widgets (kept for backward compat) ──────────────────────────────

  if (field.widget === 'type_select') {
    const opts = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown').map(t =>
      `<option value="${t}" ${t === val ? 'selected' : ''}>${t}</option>`
    ).join('');
    return `<select class="select select-sm"
      onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">${opts}</select>`;
  }

  if (field.widget === 'number') {
    return `<input type="number" class="input-number"
      value="${val ?? (field.min || 1)}"
      min="${field.min || 1}" max="${field.max || 7}"
      oninput="window.__ghh.setVal(${idx}, '${field.key}', Number(this.value))" />`;
  }

  if (field.widget === 'mv_select') {
    const mvOptions = ['any', '1', '2', '3', '4', '5', '6'];
    const opts = mvOptions.map(v =>
      `<option value="${v}" ${(val ?? 'any') == v ? 'selected' : ''}>${v === 'any' ? 'Any MV' : 'MV ≤ ' + v}</option>`
    ).join('');
    return `<select class="select select-sm"
      onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">${opts}</select>`;
  }

  if (field.widget === 'category_select') {
    const tags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    if (!tags.length) return `<span class="muted" style="font-size:11px">No tags in deck</span>`;
    const opts = tags.map(t =>
      `<option value="${t}" ${t === val ? 'selected' : ''}>${escapeHtml(t)}</option>`
    ).join('');
    return `<select class="select select-sm"
      onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">${opts}</select>`;
  }

  // ── Popup multiselect widgets ──────────────────────────────────────────────

  if (field.widget === 'types_and_tags_multiselect') {
    const rawTypes = Array.isArray(crit.cardTypes) ? crit.cardTypes : [];
    const rawTags  = Array.isArray(crit.tagNames)  ? crit.tagNames  : [];
    const types    = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown' && t !== 'MDFC');
    const deckTags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    const selTypes = types.filter(t => rawTypes.includes(t));
    const selTags  = deckTags.filter(t => rawTags.includes(t));
    const summaryParts = [];
    if (selTypes.length) summaryParts.push(selTypes.join('/'));
    if (selTags.length)  summaryParts.push(selTags.join('/'));
    const summaryText = summaryParts.length > 0 ? summaryParts.join(' & ') : '(Any Card)';
    const typeItems = types.map(t => {
      const checked = selTypes.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="type">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleType(${idx},'${t}','cardTypes')">
        <span>${t}</span>
      </label>`;
    }).join('');
    const tagItems = deckTags.map(t => {
      const checked = selTags.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="tag">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleTag(${idx},${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(t)}</span>
      </label>`;
    }).join('');
    const tagsSection = deckTags.length > 0
      ? `<div class="ms-separator">&amp; Tags (any)</div>${tagItems}`
      : `<div class="ms-separator">&amp; Tags (any)</div><div class="ms-empty">No tags in deck</div>`;
    return `
      <details class="crit-ms-dropdown" data-ms-type="combined">
        <summary class="crit-ms-toggle">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">
          <div class="ms-separator ms-separator--first">Types (any)</div>
          ${typeItems}
          ${tagsSection}
        </div>
      </details>`;
  }

  if (field.widget === 'subtypes_multiselect') {
    const rawSubtypes = Array.isArray(val) ? val : [];
    const rawTypes    = Array.isArray(crit.cardTypes) ? crit.cardTypes : [];

    // Build type→subtypes map for dynamic updates when types change
    const typeSubtypeMap = {};
    for (const card of deck.cards) {
      for (const t of (card.types || [])) {
        if (!typeSubtypeMap[t]) typeSubtypeMap[t] = new Set();
        for (const s of (card.subtypes || [])) typeSubtypeMap[t].add(s);
      }
    }
    const typeSubtypeMapObj = {};
    for (const [t, subs] of Object.entries(typeSubtypeMap)) {
      typeSubtypeMapObj[t] = [...subs].sort();
    }
    const subtypeMapAttr = JSON.stringify(typeSubtypeMapObj).replace(/"/g, '&quot;');

    const deckSubtypes = rawTypes.length
      ? [...new Set(rawTypes.flatMap(t => typeSubtypeMapObj[t] || []))].sort()
      : [...new Set(Object.values(typeSubtypeMapObj).flat())].sort();
    const selected = deckSubtypes.filter(s => rawSubtypes.includes(s));
    const summaryText = selected.length > 0 ? selected.join('/') : '(Any Subtype)';
    const items = deckSubtypes.map(s => {
      const checked = selected.includes(s);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="subtype">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleSubtype(${idx},${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(s)}</span>
      </label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown" data-ms-key="${field.key}" data-subtype-map="${subtypeMapAttr}">
        <summary class="crit-ms-toggle">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">
          ${items || '<div class="ms-empty">No subtypes in deck</div>'}
        </div>
      </details>`;
  }

  if (field.widget === 'types_tags_mv_multiselect') {
    const rawTypes = Array.isArray(crit.cardTypes) ? crit.cardTypes : [];
    const rawTags  = Array.isArray(crit.tagNames)  ? crit.tagNames  : [];
    const rawMvs   = Array.isArray(crit.mvValues)  ? crit.mvValues  : [];
    const types    = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown' && t !== 'MDFC');
    const deckTags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    const selTypes = types.filter(t => rawTypes.includes(t));
    const selTags  = deckTags.filter(t => rawTags.includes(t));
    const selMvs   = MV_VALUES.filter(v => rawMvs.includes(v));
    const summaryParts = [];
    if (selTypes.length) summaryParts.push(selTypes.join('/'));
    if (selTags.length)  summaryParts.push(selTags.join('/'));
    const summaryText = summaryParts.length > 0
      ? summaryParts.join(' & ') + (selMvs.length ? ' @ MV ' + selMvs.join('/') : '')
      : '(Any Card)';
    const typeItems = types.map(t => {
      const checked = selTypes.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="type">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleType(${idx},'${t}','cardTypes')">
        <span>${t}</span>
      </label>`;
    }).join('');
    const tagItems = deckTags.map(t => {
      const checked = selTags.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="tag">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleTag(${idx},${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(t)}</span>
      </label>`;
    }).join('');
    const mvItems = MV_VALUES.map(mv => {
      const checked = selMvs.includes(mv);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}" data-group="mv">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleMv(${idx},'${mv}')">
        <span>${mv}</span>
      </label>`;
    }).join('');
    const tagsSection = deckTags.length > 0
      ? `<div class="ms-separator">&amp; Tags (any)</div>${tagItems}`
      : `<div class="ms-separator">&amp; Tags (any)</div><div class="ms-empty">No tags in deck</div>`;
    return `
      <details class="crit-ms-dropdown" data-ms-type="combined">
        <summary class="crit-ms-toggle">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">
          <div class="ms-separator ms-separator--first">Types (any)</div>
          ${typeItems}
          ${tagsSection}
          <div class="ms-separator">at MV &amp;</div>
          ${mvItems}
        </div>
      </details>`;
  }

  if (field.widget === 'types_multiselect') {
    const raw      = Array.isArray(val) ? val : [];
    const types    = CARD_TYPES.filter(t => t !== 'Other' && t !== 'Unknown' && t !== 'MDFC');
    const selected = types.filter(t => raw.includes(t)); // canonical order
    const summaryText = selected.length > 0 ? selected.join('/') : '(select type…)';
    const items = types.map(t => {
      const checked = selected.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleType(${idx},'${t}','${field.key}')">
        <span>${t}</span>
      </label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  if (field.widget === 'mv_multiselect') {
    const raw      = Array.isArray(val) ? val : [];
    const selected = MV_VALUES.filter(v => raw.includes(v)); // canonical order
    const summaryText = selected.length > 0 ? selected.join('/') : '(Any MV)';
    const items = MV_VALUES.map(mv => {
      const checked = selected.includes(mv);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleMv(${idx},'${mv}')">
        <span>${mv}</span>
      </label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  if (field.widget === 'tags_multiselect') {
    const raw  = Array.isArray(val) ? val : [];
    const tags = [...new Set(deck.cards.flatMap(c => c.moxTags || []))].sort();
    if (!tags.length) return `<span class="muted" style="font-size:11px">No tags in deck</span>`;
    const selected = tags.filter(t => raw.includes(t)); // canonical (alpha) order
    const summaryText = selected.length > 0 ? selected.join('/') : '(select tag…)';
    const items = tags.map(t => {
      const checked = selected.includes(t);
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleTag(${idx},${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(t)}</span>
      </label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  if (field.widget === 'cards_multiselect') {
    const raw      = Array.isArray(val) ? val : [];
    const cardMap  = Object.fromEntries(deck.cards.map(c => [c.name, c]));
    const names    = [...new Set(deck.cards.map(c => c.name))].sort();
    const selected = names.filter(n => raw.includes(n)); // canonical (alpha) order
    const summaryText = selected.length === 0
      ? '(select card…)'
      : selected.length <= 2
        ? selected.join('/')
        : `${selected.length} cards`;
    const items = names.map(n => {
      const checked  = selected.includes(n);
      const imgUrl   = escapeHtml(cardMap[n]?.imageUrl     || '');
      const backUrl  = escapeHtml(cardMap[n]?.backImageUrl || '');
      return `<label class="ms-item ${checked ? 'ms-item--checked' : ''}"
        data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
        onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
        onmouseleave="window.__preview?.hide()">
        <input type="checkbox" class="ms-checkbox" ${checked ? 'checked' : ''}
          onchange="window.__ghh.toggleCard(${idx},${JSON.stringify(n).replace(/"/g, '&quot;')})">
        <span>${escapeHtml(n)}</span>
      </label>`;
    }).join('');
    return `
      <details class="crit-ms-dropdown">
        <summary class="crit-ms-toggle" data-ms-key="${field.key}">${escapeHtml(summaryText)}</summary>
        <div class="crit-ms-list">${items}</div>
      </details>`;
  }

  return '';
}
