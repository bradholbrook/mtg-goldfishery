import { CARD_TYPES } from '../types.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';
import { getResultsForDeck } from '../storage.js';
import { escapeHtml } from './shared.js';

export function buildConfigTab(deck, editingDef) {
  return buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id))
    + buildDiscardPrioritySection(deck);
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

// ─── Discard Priority Section ─────────────────────────────────────────────────

const MODIFIER_OPTIONS = [
  { value: 'highest_cmc', label: 'highest CMC' },
  { value: 'lowest_cmc',  label: 'lowest CMC' },
  { value: 'any',         label: 'any' },
];

const DISCARD_TYPE_OPTIONS = ['Any', ...CARD_TYPES];

function buildDiscardPrioritySection(deck) {
  const priorities = deck.discardPriorities || [];

  const rowsHTML = priorities.map((rule, idx) => {
    const modifierOpts = MODIFIER_OPTIONS.map(o =>
      `<option value="${o.value}" ${rule.modifier === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    const typeOpts = DISCARD_TYPE_OPTIONS.map(t =>
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

  const listHTML = priorities.length === 0
    ? `<p class="muted" style="font-size:12px;margin-bottom:8px">No rules — fallback: discard highest CMC card.</p>`
    : `<div id="disc-priority-list">${rowsHTML}</div>
       <p class="muted" style="font-size:11px;margin-top:6px">Fallback (if no rule matches): discard highest CMC card.</p>`;

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Discard Priorities</div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">When a card loots, the simulator discards the first card matching a rule below.</p>
      ${listHTML}
      <button class="btn-secondary btn-sm" style="margin-top:6px" onclick="window.__disc.add()">+ Add Priority</button>
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
