import { CARD_TYPES } from '../types.js';
import { EFFECT_TYPES, EFFECT_TYPE_OPTIONS, TIMING_LABELS, CAST_FILTER_OPTIONS, getCastFilterKey } from '../effect-types.js';
import { TYPE_COLORS, escapeHtml } from './shared.js';

export function buildCardsTab(deck, expandedEffectCards = new Set(), expandedTypeGroups = new Set()) {
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
    const isCollapsed = expandedTypeGroups.has(type);
    const color = TYPE_COLORS[type] || TYPE_COLORS.Other;
    const cardRows = isCollapsed ? '' : cards.map(card => buildCardRow(card, expandedEffectCards)).join('');
    return `
      <div class="type-group-item">
        <div class="type-group-header" onclick="window.__ovr.toggle('${type}')">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="type-group-name">${type}</span>
          <span class="type-group-count muted">${count}</span>
          <span class="type-group-chevron">${isCollapsed ? '▶' : '▼'}</span>
        </div>
        ${isCollapsed ? '' : `<div class="type-group-cards card-list">${cardRows}</div>`}
      </div>`;
  }).join('');

  return `<div class="type-group-list">${rows}</div>`;
}

function buildCardRow(card, expandedEffectCards = new Set()) {
  const isExpanded = expandedEffectCards.has(card.name);
  const allTags = card.effectTags || [];
  // When a user tag overrides an auto tag (same subtype+timing), show only the user tag.
  const userOverriddenKeys = new Set(
    allTags.filter(t => t.source === 'user').map(t => `${t.subtype}:${t.timing}`)
  );
  const isPureLand = card.types?.every(t => t.toLowerCase() === 'land' || t.toLowerCase() === 'mdfc');
  const chips = allTags
    .filter(t => t.tier !== 'skip')
    .filter(t => !(t.source === 'auto' && userOverriddenKeys.has(`${t.subtype}:${t.timing}`)))
    // mana_rock on a land or MDFC is handled by the land pool — don't show it as a chip
    .filter(t => !(t.subtype === 'mana_rock' && (isPureLand || card.isMDFC) && t.source === 'auto'))
    .map(t => {
      const typeInfo = EFFECT_TYPES[t.subtype];
      const base = typeInfo
        ? typeInfo.describe(t)
        : (t.value != null ? `${t.category}·${t.timing}·${t.value}` : `${t.category}·${t.timing}`);
      const baseWithFilter = base + describeTriggerFilter(t.triggerFilter);
      const label = t.tier === 'track_only' ? `${baseWithFilter} (track)` : baseWithFilter;
      const sourceClass = t.source === 'user' ? ' effect-chip--user' : '';
      const tierClass = t.tier === 'simulatable_soon' ? 'track_only' : t.tier;
      return `<span class="effect-chip effect-chip--${tierClass}${sourceClass}">${label}</span>`;
    }).join('');
  const cmc = card.cmc != null
    ? `<span class="card-row-cmc">${card.cmc}</span>`
    : `<span class="card-row-cmc muted">—</span>`;
  const chevron = `<span class="card-row-chevron">${isExpanded ? '▼' : '▶'}</span>`;
  const editor = isExpanded ? buildCardEffectEditor(card) : '';
  return `
    <div class="card-row-wrapper">
      <div class="card-row card-row--clickable"
           data-card-name="${escapeHtml(card.name)}"
           onclick="window.__eff.toggle(this.dataset.cardName)">
        <span class="card-row-qty muted">${card.quantity}×</span>
        <span class="card-row-name"
              data-image-url="${escapeHtml(card.imageUrl || '')}"
              data-back-image-url="${escapeHtml(card.backImageUrl || '')}"
              onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
              onmouseleave="window.__preview?.hide()">${escapeHtml(card.name)}</span>
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

  const dual = card.isMDFC && card.backImageUrl;
  const imageCol = card.imageUrl
    ? `<div class="card-effect-image${dual ? ' card-effect-image--dual' : ''}">
        <img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}" loading="lazy" />
        ${dual ? `<img src="${escapeHtml(card.backImageUrl)}" alt="${escapeHtml(card.name)} back" loading="lazy" />` : ''}
       </div>`
    : '';

  return `
    <div class="card-effect-editor">
      ${imageCol}
      <div class="card-effect-body">
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
      </div>
    </div>`;
}

/**
 * Return a short human-readable description of a TriggerFilter, or empty string.
 * Used to annotate auto-detected chips when a spell/death filter was detected.
 */
function describeTriggerFilter(tf) {
  if (!tf) return '';
  if (tf.isCommander) return ' [commander]';
  if (tf.deathSubject === 'self') return ' [self]';
  if (tf.deathSubject === 'any_creature') return ' [any creature]';
  if (tf.excludeTypes?.includes('Creature')) return ' [noncreature]';
  if (tf.spellTypes?.includes('Instant') && tf.spellTypes?.includes('Sorcery')) return ' [instant/sorcery]';
  if (tf.spellTypes?.length === 1) return ` [${tf.spellTypes[0].toLowerCase()}]`;
  return '';
}

/**
 * Render an auto-detected tag as a chip + "Override" button.
 * Shown when no user override exists for this (subtype, timing).
 */
function buildAutoTagRow(autoTag, cardNameAttr) {
  const typeInfo = EFFECT_TYPES[autoTag.subtype];
  const baseLabel = typeInfo ? typeInfo.describe(autoTag) : `${autoTag.subtype}·${autoTag.timing}`;
  const filterSuffix = describeTriggerFilter(autoTag.triggerFilter);
  const label = baseLabel + filterSuffix;
  return `
    <div class="effect-auto-row">
      <span class="effect-chip effect-chip--${autoTag.tier === 'simulatable_soon' ? 'track_only' : autoTag.tier}">${label}</span>
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
 * Original auto value is shown read-only. User sets tier + EV override.
 */
function buildOverrideRow(autoTag, userTag, fullIdx, cardNameAttr) {
  const typeInfo = EFFECT_TYPES[userTag.subtype];
  const originalDesc = typeInfo ? typeInfo.describe(autoTag) : `${autoTag.subtype} @ ${autoTag.timing}`;

  return `
    <div class="effect-tag-row effect-tag-row--override">
      <div class="effect-tag-row-fields">
        <span class="effect-override-label">${escapeHtml(userTag.subtype)} @ ${escapeHtml(userTag.timing)}</span>
        <span class="muted" style="font-size:11px" title="Auto-detected value">orig: ${escapeHtml(originalDesc)}</span>
        ${buildTierControls(userTag, fullIdx, cardNameAttr)}
        ${buildTriggerFilterWidgets(userTag, fullIdx, cardNameAttr)}
      </div>
      <button class="btn-secondary btn-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
        onclick="window.__eff.remove(this.dataset.cardName, Number(this.dataset.tagIdx))"
        title="Remove override — restores auto behaviour">Reset</button>
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
  const validTimings = (typeInfo?.validTimings ?? ['etb', 'upkeep', 'cast', 'tap', 'death', 'on_resolution'])
    .filter(tm => !autoCoveredKeys.has(`${tag.subtype}:${tm}`));
  const timingSelect = `
    <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
      onchange="window.__eff.setTiming(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)">
      ${validTimings.map(tm =>
        `<option value="${tm}" ${tm === tag.timing ? 'selected' : ''}>${TIMING_LABELS[tm] ?? tm}</option>`
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
        ${buildTriggerFilterWidgets(tag, fullIdx, cardNameAttr)}
        ${buildTierControls(tag, fullIdx, cardNameAttr)}
      </div>
      <button class="btn-icon btn-danger effect-tag-remove" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
        onclick="window.__eff.remove(this.dataset.cardName, Number(this.dataset.tagIdx))"
        title="Remove">✕</button>
    </div>`;
}

/**
 * Render optional TriggerFilter widgets for cast and death timings.
 * Returns empty string for other timings.
 */
function buildTriggerFilterWidgets(tag, tagIdx, cardNameAttr) {
  if (tag.timing === 'cast' || tag.timing === 'opponent_cast') {
    const current = getCastFilterKey(tag.triggerFilter ?? null);
    // 'commander' only applies to your own casts, not opponent's
    const options = tag.timing === 'opponent_cast'
      ? CAST_FILTER_OPTIONS.filter(o => o.key !== 'commander')
      : CAST_FILTER_OPTIONS;
    const opts = options.map(o =>
      `<option value="${o.key}" ${o.key === current ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<label class="effect-field-label">Spell filter
      <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${tagIdx}"
        onchange="window.__eff.setCastFilter(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)">
        ${opts}
      </select></label>`;
  }
  if (tag.timing === 'death') {
    const current = tag.triggerFilter?.deathSubject ?? 'any_creature';
    return `<label class="effect-field-label">Trigger on
      <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${tagIdx}"
        onchange="window.__eff.setDeathSubject(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)">
        <option value="any_creature" ${current === 'any_creature' ? 'selected' : ''}>Any creature</option>
        <option value="self"         ${current === 'self'         ? 'selected' : ''}>Self only</option>
      </select></label>`;
  }
  return '';
}

/**
 * Render tier-select + expected-value input for a user tag.
 * Always shown (not gated on isConditional).
 */
function buildTierControls(tag, fullIdx, cardNameAttr) {
  const tierSelect = `
    <select class="select select-sm" data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}"
      onchange="window.__eff.setTier(this.dataset.cardName, Number(this.dataset.tagIdx), this.value)"
      title="Simulation mode">
      <option value="track_only"  ${tag.tier === 'track_only'  ? 'selected' : ''}>Track only</option>
      <option value="simulatable" ${tag.tier === 'simulatable' ? 'selected' : ''}>Simulate</option>
    </select>`;
  // EV is only meaningful when the tag is actively simulated.
  // on_resolution fires once per cast; other timings fire per trigger event.
  const evLabel = tag.timing === 'on_resolution' ? 'Draws on cast' : 'Draws/trigger';
  const evInput = tag.tier === 'simulatable'
    ? `<label class="effect-field-label">${evLabel}
        <input type="number" class="input-number" style="width:52px"
          value="${tag.expectedValue ?? ''}" step="1" min="0" max="20"
          placeholder="${tag.value ?? 1}"
          data-card-name="${cardNameAttr}" data-tag-idx="${fullIdx}" data-field-key="expectedValue"
          oninput="window.__eff.setField(this.dataset.cardName, Number(this.dataset.tagIdx), this.dataset.fieldKey, this.value === '' ? null : Math.floor(Number(this.value)))"
          title="How many cards to draw each time this effect fires. Blank = use auto-detected value." />
      </label>`
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
