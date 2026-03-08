import { CARD_TYPES } from '../types.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS } from '../criteria.js';
import { getResultsForDeck } from '../storage.js';
import { escapeHtml } from './shared.js';

export function buildConfigTab(deck, editingDef) {
  return buildGoodHandSection(deck, editingDef, getResultsForDeck(deck.id))
    + buildCastPrioritySection(deck)
    + buildTutorPrioritySection(deck)
    + buildDiscardPrioritySection(deck)
    + buildXCostSection(deck)
    + buildOpponentProfileSection(deck);
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
    const isExpanded = editingDef?.defId === def.id;
    const pct = latestResult?.summary?.goodHandDefPcts?.[def.id];
    const pctBadge = pct !== undefined
      ? `<span class="def-pct ${pct >= 60 ? 'def-pct--good' : pct >= 40 ? 'def-pct--warn' : 'def-pct--bad'}">${pct}%</span>`
      : `<span class="def-pct def-pct--none">—</span>`;
    const criteriaDesc = def.criteria.map(c => {
      const t = CRITERION_TYPES[c.type];
      return t ? t.describe(c) : c.type;
    }).join(' + ');

    const sampleBtn = `<button class="btn-secondary btn-sm" style="white-space:nowrap" onclick="event.stopPropagation();window.__ghh.sampleDef('${def.id}')" title="Show 3 sample hands">Sample</button>`;

    if (isExpanded) {
      return `
        <div class="def-item def-item--expanded">
          <div class="def-item-header" onclick="window.__ghh.editDef('${def.id}')">
            <span class="def-item-chevron">▼</span>
            <div class="def-item-info">
              <span class="def-item-name">${escapeHtml(def.name)}</span>
              <span class="def-item-desc muted">${escapeHtml(criteriaDesc)}</span>
            </div>
            <div class="def-item-actions">
              ${pctBadge}
              ${sampleBtn}
              <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
            </div>
          </div>
          ${buildGoodHandEditor(editingDef, deck)}
        </div>`;
    }

    return `
      <div class="def-item def-item--clickable" onclick="window.__ghh.editDef('${def.id}')">
        <span class="def-item-chevron">▶</span>
        <div class="def-item-info">
          <span class="def-item-name">${escapeHtml(def.name)}</span>
          <span class="def-item-desc muted">${escapeHtml(criteriaDesc)}</span>
        </div>
        <div class="def-item-actions">
          ${pctBadge}
          ${sampleBtn}
          <button class="btn-icon btn-danger" onclick="event.stopPropagation();window.__ghh.removeDef('${def.id}')" title="Remove">✕</button>
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

  return `
    <div class="section">
      <div class="section-label">Good Hand Definitions</div>
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
    <div class="criterion-row" data-crit-idx="${idx}">
      ${typeSelect}
      ${fieldWidgets}
      <button class="btn-icon btn-danger" onclick="window.__ghh.removeCrit(${idx})" title="Remove">✕</button>
    </div>`;
}

// ─── Cast Priority Rules Section ──────────────────────────────────────────────

const CAST_RULE_MATCH_OPTIONS = [
  { value: 'named',           label: 'Named Card' },
  { value: 'type',            label: 'Card Type' },
  { value: 'subtype',         label: 'Card Subtype' },
  { value: 'effect_category', label: 'Effect Category' },
];

const EFFECT_CATEGORY_OPTIONS = ['draw', 'ramp', 'tutor', 'removal', 'token', 'other'];

/**
 * A single-select card picker styled like the cards_multiselect dropdown.
 * Selecting a card calls window.__cpr.pickCard() which refreshes and closes the panel.
 */
function buildNamedCardWidget(ruleIdx, selectedName, deck) {
  const cardMap = Object.fromEntries(deck.cards.map(c => [c.name, c]));
  const names = [...new Set(deck.cards.map(c => c.name))].sort();
  const summaryText = selectedName || 'Select card…';

  const items = names.map(n => {
    const isSelected = n === selectedName;
    const imgUrl  = escapeHtml(cardMap[n]?.imageUrl     || '');
    const backUrl = escapeHtml(cardMap[n]?.backImageUrl || '');
    const nameArg = JSON.stringify(n).replace(/"/g, '&quot;');
    return `<label class="type-checkbox-label ${isSelected ? 'card-option--selected' : ''}"
      data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
      onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
      onmouseleave="window.__preview?.hide()">
      <span class="card-option-check">${isSelected ? '✓' : ''}</span>
      <span onclick="window.__cpr.pickCard(${ruleIdx}, ${nameArg})">${escapeHtml(n)}</span>
    </label>`;
  }).join('');

  return `
    <details class="card-multiselect-dropdown">
      <summary class="card-multiselect-toggle">${escapeHtml(summaryText)}</summary>
      <div class="card-multiselect-list">${items}</div>
    </details>`;
}

function buildCastPrioritySection(deck) {
  const rules = deck.castPriorityRules || [];

  const rowsHTML = rules.map((rule, idx) => {
    const matchOpts = CAST_RULE_MATCH_OPTIONS.map(o =>
      `<option value="${o.value}" ${rule.match === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    let targetWidget = '';
    if (rule.match === 'type') {
      const typeOpts = CARD_TYPES.filter(t => t !== 'MDFC' && t !== 'Other').map(t =>
        `<option value="${t}" ${rule.cardType === t ? 'selected' : ''}>${t}</option>`
      ).join('');
      targetWidget = `<select class="select select-sm" onchange="window.__cpr.setField(${idx},'cardType',this.value)">${typeOpts}</select>`;
    } else if (rule.match === 'effect_category') {
      const catOpts = EFFECT_CATEGORY_OPTIONS.map(c =>
        `<option value="${c}" ${rule.effectCategory === c ? 'selected' : ''}>${c}</option>`
      ).join('');
      targetWidget = `<select class="select select-sm" onchange="window.__cpr.setField(${idx},'effectCategory',this.value)">${catOpts}</select>`;
    } else if (rule.match === 'subtype') {
      targetWidget = `<input type="text" class="input-text" style="flex:1;min-width:0"
        placeholder="Subtype (e.g. Elf, Equipment)"
        value="${escapeHtml(rule.cardSubtype || '')}"
        oninput="window.__cpr.setField(${idx},'cardSubtype',this.value)" />`;
    } else {
      targetWidget = buildNamedCardWidget(idx, rule.cardName || '', deck);
    }

    return `
      <div class="cast-rule-row"
        draggable="true"
        ondragstart="window.__cpr.dragStart(${idx})"
        ondragover="event.preventDefault()"
        ondrop="window.__cpr.drop(${idx})"
        ondragenter="this.classList.add('cast-drag-over')"
        ondragleave="this.classList.remove('cast-drag-over')"
        ondragend="document.querySelectorAll('.cast-drag-over').forEach(el=>el.classList.remove('cast-drag-over'))">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <select class="select select-sm" onchange="window.__cpr.setMatch(${idx},this.value)">
          ${matchOpts}
        </select>
        ${targetWidget}
        <button class="btn-icon btn-danger" onclick="window.__cpr.remove(${idx})" title="Remove">✕</button>
      </div>`;
  }).join('');

  const listHTML = rules.length === 0
    ? `<p class="muted" style="font-size:12px;margin-bottom:8px">No rules — cards are cast by effect category order.</p>`
    : `<div id="cast-rule-list">${rowsHTML}</div>`;

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Cast Priority Rules</div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">
        Override casting order. Rules are checked top-to-bottom; first match wins. Unmatched cards fall through to category ordering.
      </p>
      ${listHTML}
      <button class="btn-secondary btn-sm" style="margin-top:6px" onclick="window.__cpr.add()">+ Add Rule</button>
    </div>`;
}

// ─── Tutor Priority Rules Section ─────────────────────────────────────────────

const TUTOR_TARGET_OPTIONS = [
  { value: 'named',           label: 'Named Card' },
  { value: 'type',            label: 'Card Type' },
  { value: 'subtype',         label: 'Card Subtype' },
  { value: 'effect_category', label: 'Effect Category' },
];

/**
 * Single-select card picker for tutor priority rules.
 * Selecting a card calls window.__tpr.pickCard().
 */
function buildTutorCardWidget(ruleIdx, selectedName, deck) {
  const cardMap = Object.fromEntries(deck.cards.map(c => [c.name, c]));
  const names = [...new Set(deck.cards.map(c => c.name))].sort();
  const summaryText = selectedName || 'Select card…';

  const items = names.map(n => {
    const isSelected = n === selectedName;
    const imgUrl  = escapeHtml(cardMap[n]?.imageUrl     || '');
    const backUrl = escapeHtml(cardMap[n]?.backImageUrl || '');
    const nameArg = JSON.stringify(n).replace(/"/g, '&quot;');
    return `<label class="type-checkbox-label ${isSelected ? 'card-option--selected' : ''}"
      data-image-url="${imgUrl}" data-back-image-url="${backUrl}"
      onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
      onmouseleave="window.__preview?.hide()">
      <span class="card-option-check">${isSelected ? '✓' : ''}</span>
      <span onclick="window.__tpr.pickCard(${ruleIdx}, ${nameArg})">${escapeHtml(n)}</span>
    </label>`;
  }).join('');

  return `
    <details class="card-multiselect-dropdown">
      <summary class="card-multiselect-toggle">${escapeHtml(summaryText)}</summary>
      <div class="card-multiselect-list">${items}</div>
    </details>`;
}

function buildTutorPrioritySection(deck) {
  const rules = deck.tutorPriorityRules || [];

  // Find cards in this deck that have a simulatable tutor effect
  const tutorCards = (deck.cards || []).filter(c =>
    c.effectTags?.some(t => t.category === 'tutor' && t.tier === 'simulatable')
  );

  if (tutorCards.length === 0) return '';

  // Check if any tutor card has no matching rule (warn user)
  const hasUnconfigured = tutorCards.length > 0 && rules.length === 0;

  const tutorChips = tutorCards.map(c => {
    const tag = c.effectTags.find(t => t.category === 'tutor' && t.tier === 'simulatable');
    const fc = tag?.fetchType;
    let what = 'any';
    if (fc && !fc.any) {
      const parts = [];
      if (fc.supertype) parts.push(fc.supertype.toLowerCase());
      if (fc.nonland)   parts.push('nonland');
      if (fc.subtype)   parts.push(fc.subtype.toLowerCase());
      else if (fc.type) parts.push(fc.type === 'InstantOrSorcery' ? 'instant/sorc' : fc.type.toLowerCase());
      if (parts.length) what = parts.join(' ');
    }
    const where = tag?.putWhere === 'battlefield' ? '→BF'
      : tag?.putWhere === 'top_of_library' ? '→top'
      : '→hand';
    return `<span class="effect-chip effect-chip--simulatable"
      data-image-url="${escapeHtml(c.imageUrl || '')}"
      data-back-image-url="${escapeHtml(c.backImageUrl || '')}"
      onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
      onmouseleave="window.__preview?.hide()">${escapeHtml(c.name)} <span class="muted">${what} ${where}</span></span>`;
  }).join(' ');

  const rowsHTML = rules.map((rule, idx) => {
    const targetOpts = TUTOR_TARGET_OPTIONS.map(o =>
      `<option value="${o.value}" ${rule.target === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    let targetWidget = '';
    if (rule.target === 'type') {
      const typeOpts = CARD_TYPES.filter(t => t !== 'MDFC' && t !== 'Other').map(t =>
        `<option value="${t}" ${rule.cardType === t ? 'selected' : ''}>${t}</option>`
      ).join('');
      targetWidget = `<select class="select select-sm" onchange="window.__tpr.setField(${idx},'cardType',this.value)">${typeOpts}</select>`;
    } else if (rule.target === 'effect_category') {
      const catOpts = EFFECT_CATEGORY_OPTIONS.map(c =>
        `<option value="${c}" ${rule.effectCategory === c ? 'selected' : ''}>${c}</option>`
      ).join('');
      targetWidget = `<select class="select select-sm" onchange="window.__tpr.setField(${idx},'effectCategory',this.value)">${catOpts}</select>`;
    } else if (rule.target === 'subtype') {
      targetWidget = `<input type="text" class="input-text" style="flex:1;min-width:0"
        placeholder="Subtype (e.g. Forest, Wizard)"
        value="${escapeHtml(rule.cardSubtype || '')}"
        oninput="window.__tpr.setField(${idx},'cardSubtype',this.value)" />`;
    } else {
      targetWidget = buildTutorCardWidget(idx, rule.cardName || '', deck);
    }

    // Named card rules always skip-if-in-hand (enforced in simulator), no checkbox needed.
    // Other rule types show an optional checkbox.
    const notInHandCheckbox = rule.target !== 'named'
      ? `<label class="effect-field-label" style="margin:0;white-space:nowrap;font-size:11px"
          title="Skip this rule if a matching card is already in hand">
          <input type="checkbox" ${rule.requireNotInHand ? 'checked' : ''}
            onchange="window.__tpr.setField(${idx},'requireNotInHand',this.checked)" />
          skip if in hand
        </label>`
      : '';

    return `
      <div class="cast-rule-row"
        draggable="true"
        ondragstart="window.__tpr.dragStart(${idx})"
        ondragover="event.preventDefault()"
        ondrop="window.__tpr.drop(${idx})"
        ondragenter="this.classList.add('cast-drag-over')"
        ondragleave="this.classList.remove('cast-drag-over')"
        ondragend="document.querySelectorAll('.cast-drag-over').forEach(el=>el.classList.remove('cast-drag-over'))">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <select class="select select-sm" onchange="window.__tpr.setTarget(${idx},this.value)">
          ${targetOpts}
        </select>
        ${targetWidget}
        ${notInHandCheckbox}
        <button class="btn-icon btn-danger" onclick="window.__tpr.remove(${idx})" title="Remove">✕</button>
      </div>`;
  }).join('');

  const listHTML = rules.length === 0
    ? `<p class="muted" style="font-size:12px;margin-bottom:8px">No rules — tutor cards won't be cast during simulation.</p>`
    : `<div id="tutor-rule-list">${rowsHTML}</div>`;

  const warnHTML = hasUnconfigured
    ? `<p class="muted" style="font-size:12px;margin-bottom:8px;color:var(--warning)">⚠ Add at least one rule so tutors are castable in simulation.</p>`
    : '';

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Tutor Priority Rules</div>
      <div style="margin-bottom:8px">${tutorChips}</div>
      <p class="muted" style="font-size:12px;margin-bottom:6px">
        Rules tell the simulator what to search for when a tutor resolves. Evaluated top-to-bottom; first rule with a valid library target wins.
      </p>
      ${warnHTML}
      ${listHTML}
      <button class="btn-secondary btn-sm" style="margin-top:6px" onclick="window.__tpr.add()">+ Add Rule</button>
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

// ─── X Spell Values Section ───────────────────────────────────────────────────

/**
 * Return true if the card has {X} in its effective mana cost.
 */
function hasXCost(card) {
  const mc = card.manaCost ?? card.faces?.[0]?.manaCost ?? '';
  return mc.includes('{X}');
}

function buildXCostSection(deck) {
  const xCards = (deck.cards || []).filter(hasXCost);
  if (xCards.length === 0) return '';

  const xCosts = deck.xCosts || {};
  const rows = xCards.map(card => {
    const val = xCosts[card.name] ?? 0;
    return `
      <div class="criterion-row" style="align-items:center">
        <span style="flex:1;font-size:12px"
              data-image-url="${escapeHtml(card.imageUrl || '')}"
              data-back-image-url="${escapeHtml(card.backImageUrl || '')}"
              onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
              onmouseleave="window.__preview?.hide()">${escapeHtml(card.name)}</span>
        <label class="effect-field-label" style="margin:0">X =
          <input type="number" class="input-number" style="width:52px"
            value="${val}" min="0" max="20"
            oninput="window.__xcosts.set(${JSON.stringify(card.name)}, Number(this.value))" />
        </label>
      </div>`;
  }).join('');

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">X Spell Values</div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">
        Set the expected X value when casting these spells. Used for mana cost and draw count in simulation.
      </p>
      ${rows}
    </div>`;
}

// ─── Opponent Profile Section ─────────────────────────────────────────────────

function buildOpponentProfileSection(deck) {
  const cfg         = { ...deck.strategyConfig };
  const numOpponents = cfg.numOpponents                  ?? 3;
  const extraDraws   = cfg.opponentExtraDrawsPerRound    ?? 0;
  const creatures    = cfg.opponentCreatureSpellsPerRound    ?? 0;
  const noncreat     = cfg.opponentNoncreatureSpellsPerRound ?? 0;

  function numInput(field, value, label, hint, unit = '/round', min = 0) {
    return `
      <div class="criterion-row" style="align-items:center">
        <span style="flex:1;font-size:12px">${label}</span>
        <label class="effect-field-label" style="margin:0">${unit}
          <input type="number" class="input-number" style="width:52px"
            value="${value}" min="${min}" max="99"
            title="${escapeHtml(hint)}"
            oninput="window.__opp.set('${field}', Number(this.value))" />
        </label>
      </div>`;
  }

  return `
    <div class="section" style="margin-top:16px">
      <div class="section-label">Opponent Profile</div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">
        Estimated opponent actions per round (your full turn cycle). Used to fire
        <em>opponent_draw</em> and <em>opponent_cast</em> triggered abilities
        like Rhystic Study or Mystic Remora. Set these to simulate those effects;
        leave at 0 to keep them as track-only.
      </p>
      ${numInput('numOpponents', numOpponents, 'Number of opponents', 'How many opponents in the pod (e.g. 3 for a 4-player game)', 'opponents', 1)}
      <p class="muted" style="font-size:11px;margin-top:2px;margin-bottom:8px">
        Baseline: each opponent draws 1 card/turn (${numOpponents} draw${numOpponents !== 1 ? 's' : ''}/round automatically). Use <em>Extra draws</em> for opponents drawing beyond that.
      </p>
      ${numInput('opponentExtraDrawsPerRound',       extraDraws, 'Extra opponent draws',       'Additional draws beyond 1/turn baseline (e.g. wheels, Consecrated Sphinx)')}
      ${numInput('opponentCreatureSpellsPerRound',   creatures,  'Opponent creature spells',   'Creature spells cast by all opponents per round')}
      ${numInput('opponentNoncreatureSpellsPerRound', noncreat,   'Opponent noncreature spells','Noncreature spells cast by all opponents per round (Rhystic Study, Mystic Remora)')}
      <p class="muted" style="font-size:11px;margin-top:6px">
        Any-spell triggers (e.g. Rhystic Study) fire creature + noncreature total times per round.
        For cards where opponents can pay to prevent the draw (like Rhystic Study), override the
        <em>Cards/trigger</em> value to a fraction (e.g. 0.7 = they don't pay 70% of the time).
        These two settings multiply: 0.7 × 6 spells/round = 4.2 expected draws/round.
      </p>
    </div>`;
}

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

  return '';
}
