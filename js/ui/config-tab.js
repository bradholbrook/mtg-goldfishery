import { CARD_TYPES } from '../types.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';
import { getResultsForDeck } from '../storage.js';
import { escapeHtml } from './shared.js';
import { getEffectiveCategoryNames } from '../category-config.js';

// ─── Mull Applicability ───────────────────────────────────────────────────────

/**
 * Compute the minimum number of distinct card slots required to satisfy a def.
 * Conservative: sums all count values (doesn't account for overlap).
 */
function minCardsRequired(def) {
  return (def.criteria || []).reduce((sum, c) => sum + (Number(c.count) || 1), 0);
}

/**
 * Build a compact note showing which hand sizes this def can apply to.
 * Hand sizes in London Mulligan: 7 (×2), 6, 5, 4, 3, 2, 1.
 */
function mullApplicabilityNote(def) {
  const min = minCardsRequired(def);
  if (min > 7) {
    return `<span class="mull-note mull-note--warn">⚠ needs ${min} cards — can never be satisfied</span>`;
  }
  if (min === 0) return '';
  const noteClass = min <= 4 ? 'mull-note--ok' : min <= 6 ? 'mull-note--mid' : 'mull-note--tight';
  return `<span class="mull-note ${noteClass}">requires ≥${min} cards</span>`;
}

export function buildMulliganTab(deck, editingDef) {
  return buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id))
    + buildBottomSelectionSection(deck)
    + buildRunSection(deck);
}

// ─── Good Hand Section ────────────────────────────────────────────────────────

/**
 * Render the full "Good Hand Definitions" config section.
 * Definitions are shown in priority order (top = highest priority).
 * Drag-to-reorder sets the evaluation order for the mulligan simulator.
 */
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
      return t ? t.describe(c) : c.type;
    }).join(' + ');
    const applicabilityNote = mullApplicabilityNote(def);

    const sampleBtn = `<button class="btn-secondary btn-sm" style="white-space:nowrap" onclick="event.stopPropagation();window.__ghh.sampleDef('${def.id}')" title="Show 3 sample hands">Sample</button>`;

    if (isExpanded) {
      return `
        <div class="def-item def-item--expanded"
          draggable="true"
          ondragstart="window.__ghh.dragStart(${defIdx})"
          ondragover="event.preventDefault()"
          ondrop="window.__ghh.drop(${defIdx})"
          ondragenter="this.classList.add('disc-drag-over')"
          ondragleave="this.classList.remove('disc-drag-over')"
          ondragend="document.querySelectorAll('.disc-drag-over').forEach(el=>el.classList.remove('disc-drag-over'))">
          <div class="def-item-header" onclick="window.__ghh.editDef('${def.id}')">
            <span class="drag-handle" title="Drag to reorder priority">⠿</span>
            <span class="def-item-chevron">▼</span>
            <div class="def-item-info">
              <span class="def-item-name">${escapeHtml(def.name)}</span>
              <span class="def-item-desc muted">${escapeHtml(criteriaDesc)}</span>
            </div>
            <div class="def-item-right">
              <div class="def-item-actions">
                ${pctBadge}
                ${sampleBtn}
                <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
              </div>
              ${applicabilityNote}
            </div>
          </div>
          ${buildGoodHandEditor(editingDef, deck)}
        </div>`;
    }

    return `
      <div class="def-item def-item--clickable"
        draggable="true"
        ondragstart="window.__ghh.dragStart(${defIdx})"
        ondragover="event.preventDefault()"
        ondrop="window.__ghh.drop(${defIdx})"
        ondragenter="this.classList.add('disc-drag-over')"
        ondragleave="this.classList.remove('disc-drag-over')"
        ondragend="document.querySelectorAll('.disc-drag-over').forEach(el=>el.classList.remove('disc-drag-over'))"
        onclick="window.__ghh.editDef('${def.id}')">
        <span class="drag-handle" title="Drag to reorder priority">⠿</span>
        <span class="def-item-chevron">▶</span>
        <div class="def-item-info">
          <span class="def-item-name">${escapeHtml(def.name)}</span>
          <span class="def-item-desc muted">${escapeHtml(criteriaDesc)}</span>
        </div>
        <div class="def-item-right">
          <div class="def-item-actions">
            ${pctBadge}
            ${sampleBtn}
            <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
          </div>
          ${applicabilityNote}
        </div>
      </div>`;
  }).join('');

  // New-def editor appears at bottom when editingDef.defId === null
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
    <div class="criterion-row" data-crit-idx="${idx}">
      ${typeSelect}
      ${fieldWidgets}
      <button class="btn-icon btn-danger" onclick="window.__ghh.removeCrit(${idx})" title="Remove">✕</button>
    </div>`;
}

// ─── Bottom Selection Section ─────────────────────────────────────────────────

const MODIFIER_OPTIONS = [
  { value: 'highest_cmc', label: 'highest CMC' },
  { value: 'lowest_cmc',  label: 'lowest CMC' },
  { value: 'any',         label: 'any' },
];

const BOTTOM_TYPE_OPTIONS = ['Any', ...CARD_TYPES];

function buildBottomSelectionSection(deck) {
  // Repurposed: discardPriorities now serve as bottom-selection priority
  // (what to put back when mulliganing to 6/5/4)
  const priorities = deck.discardPriorities || [];

  const rowsHTML = priorities.map((rule, idx) => {
    const modifierOpts = MODIFIER_OPTIONS.map(o =>
      `<option value="${o.value}" ${rule.modifier === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    const typeOpts = BOTTOM_TYPE_OPTIONS.map(t =>
      `<option value="${t}" ${rule.cardType === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    return `
      <div class="disc-priority-row"
        draggable="true"
        ondragstart="window.__disc.dragStart(${idx})"
        ondragover="event.preventDefault()"
        ondrop="window.__disc.drop(${idx})"
        ondragenter="this.classList.add('disc-drag-over')"
        ondragleave="this.classList.remove('disc-drag-over')"
        ondragend="document.querySelectorAll('.disc-drag-over').forEach(el=>el.classList.remove('disc-drag-over'))">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <select class="select select-sm" onchange="window.__disc.set(${idx},'modifier',this.value)">
          ${modifierOpts}
        </select>
        <span class="muted" style="font-size:11px">of</span>
        <select class="select select-sm" onchange="window.__disc.set(${idx},'cardType',this.value)">
          ${typeOpts}
        </select>
        <button class="btn-icon btn-danger" onclick="window.__disc.remove(${idx})" title="Remove">✕</button>
      </div>`;
  }).join('');

  const defaultRuleHTML = `
    <div class="disc-priority-row disc-priority-row--default">
      <span class="drag-handle muted" style="opacity:0.3">⠿</span>
      <span class="muted" style="font-size:11px">highest CMC</span>
      <span class="muted" style="font-size:11px">of</span>
      <span class="muted" style="font-size:11px">Any</span>
      <span class="muted" style="font-size:10px;margin-left:auto">(default fallback)</span>
    </div>`;

  const listHTML = `<div id="disc-priority-list">${rowsHTML}${defaultRuleHTML}</div>
    ${priorities.length > 0 ? `<p class="muted" style="font-size:11px;margin-top:6px">Rules evaluated top-to-bottom; default applies if no rule matches.</p>` : ''}`;

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Bottom Selection Priority</div>
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

/**
 * Render a single field widget inside a criterion row.
 */
function buildFieldWidget(field, crit, idx, deck) {
  const val = crit[field.key];

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

  if (field.widget === 'mv_select') {
    const mvOptions = ['any', '1', '2', '3', '4', '5', '6'];
    const opts = mvOptions.map(v =>
      `<option value="${v}" ${(val ?? 'any') == v ? 'selected' : ''}>${v === 'any' ? 'Any MV' : 'MV ≤ ' + v}</option>`
    ).join('');
    return `<select class="select select-sm"
      onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">${opts}</select>`;
  }

  if (field.widget === 'cards_multiselect') {
    const selected = Array.isArray(val) ? val : [];
    const cardMap = Object.fromEntries(deck.cards.map(c => [c.name, c]));
    const names = [...new Set(deck.cards.map(c => c.name))].sort();
    const checkboxes = names.map(n => {
      const checked  = selected.includes(n) ? 'checked' : '';
      const imgUrl   = escapeHtml(cardMap[n]?.imageUrl     || '');
      const backUrl  = escapeHtml(cardMap[n]?.backImageUrl || '');
      return `<label class="type-checkbox-label"
        data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
        onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
        onmouseleave="window.__preview?.hide()">
        <input type="checkbox" ${checked} onchange="window.__ghh.toggleCard(${idx}, ${JSON.stringify(n).replace(/"/g, '&quot;')})">
        ${escapeHtml(n)}
      </label>`;
    }).join('');
    const summaryText = selected.length > 0
      ? `${selected.length} card${selected.length !== 1 ? 's' : ''} selected`
      : 'Select cards…';
    return `
      <details class="card-multiselect-dropdown">
        <summary class="card-multiselect-toggle">${summaryText}</summary>
        <div class="card-multiselect-list">${checkboxes}</div>
      </details>`;
  }

  if (field.widget === 'category_select') {
    const cats = getEffectiveCategoryNames();
    const opts = cats.map(c =>
      `<option value="${c}" ${c === val ? 'selected' : ''}>${c}</option>`
    ).join('');
    return `<select class="select select-sm"
      onchange="window.__ghh.setVal(${idx}, '${field.key}', this.value)">${opts}</select>`;
  }

  return '';
}
