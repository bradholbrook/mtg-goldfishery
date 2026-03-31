import { CARD_TYPES } from '../types.js';
import { TYPE_COLORS, escapeHtml } from './shared.js';
import {
  getEffectiveCategories,
  getEffectiveCategoryNames,
  getEffectiveOtagMappings,
} from '../category-config.js';

// Display order for type sections (Commander is synthetic, not in CARD_TYPES)
const DISPLAY_TYPE_ORDER = [
  'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment',
  'Land', 'Planeswalker', 'Battle', 'MDFC', 'Other',
];

// Categories that carry a numeric value
const VALUE_CATEGORIES = new Set(['Ramp', 'Mana Rock', 'Mana Dork', 'Card Draw', 'Mill']);

// Fallback effect-tag subtype to pull a default value from
export const CATEGORY_TAG_SUBTYPE = {
  'Card Draw': 'draw_n',
  'Mana Rock': 'mana_rock',
  'Mana Dork': 'mana_dork',
  'Ramp':      'ramp',
  'Mill':      'mill',
};

// Regex patterns for auto-detecting numeric values from oracle text
const ORACLE_VALUE_PATTERNS = {
  'Card Draw': /\bdraw (\d+) cards?\b/i,
  'Mill':      /\bmills? (\d+)\b/i,
};

// ─── Pill Formatting ──────────────────────────────────────────────────────────

function getCategoryValue(card, cat) {
  if (card.categoryValues?.[cat] != null) return card.categoryValues[cat];
  const subtype = CATEGORY_TAG_SUBTYPE[cat];
  if (subtype) {
    const tag = card.effectTags?.find(t => t.subtype === subtype);
    if (tag?.value != null) return tag.value;
  }
  // Auto-detect from oracle text if no assigned or tagged value
  const pattern = ORACLE_VALUE_PATTERNS[cat];
  if (pattern && card.oracleText) {
    const m = card.oracleText.match(pattern);
    if (m) return Number(m[1]);
  }
  return null;
}

function formatPillLabel(cat, val) {
  if (val != null && val !== '') {
    if (cat === 'Card Draw')  return `Draw ${val}`;
    if (cat === 'Mana Rock')  return `${val}-Mana Rock`;
    if (cat === 'Mana Dork')  return `${val}-Mana Dork`;
    if (cat === 'Ramp')       return `${val}-Mana Ramp`;
    if (cat === 'Mill')       return `Mill ${val}`;
    return `${cat} ${val}`;
  }
  return cat;
}

// ─── Tab Entry ────────────────────────────────────────────────────────────────

export function buildCardsTab(deck, expandedTypeGroups = new Set(), expandedCards = new Set(), categoryConfigOpen = false, allDeckOtags = []) {
  // Compute category counts for the config editor
  const catCounts = {};
  for (const card of (deck?.cards || [])) {
    for (const cat of (card.categories || [])) {
      catCounts[cat] = (catCounts[cat] || 0) + card.quantity;
    }
  }
  const categoryEditor = buildCategoryConfigEditor(categoryConfigOpen, allDeckOtags, catCounts);
  const cardList = buildCardList(deck, expandedTypeGroups, expandedCards);
  return `${categoryEditor}${cardList}`;
}

// ─── Category Config Editor ────────────────────────────────────────────────────

const PROTECTED_CATEGORIES = new Set(['Card Draw', 'Cascade', 'Mill', 'Discover']);

function buildCategoryConfigEditor(categoryConfigOpen = false, allDeckOtags = [], catCounts = {}) {
  const CALC_CATS = new Set(['Card Draw', 'Cascade', 'Mill', 'Discover']);
  const allCats = getEffectiveCategories().slice().sort((a, b) => a.name.localeCompare(b.name));
  const cats = allCats; // already sorted
  const otagMap = getEffectiveOtagMappings();

  // Split into regular + calculated
  const regularCats = cats.filter(c => !CALC_CATS.has(c.name));
  const calcCats    = cats.filter(c => CALC_CATS.has(c.name));

  // Group otags by category, sorted alphabetically within each
  const byCategory = {};
  for (const cat of cats) byCategory[cat.name] = [];
  for (const [slug, catName] of Object.entries(otagMap)) {
    if (byCategory[catName]) byCategory[catName].push(slug);
  }
  for (const catName of Object.keys(byCategory)) byCategory[catName].sort();

  // Unmapped = in allDeckOtags but not in any mapped category
  const unmappedSlugs = allDeckOtags.filter(s => !otagMap[s]).sort();

  function buildColumn(cat) {
    const isProtected = PROTECTED_CATEGORIES.has(cat.name);
    const pills = byCategory[cat.name].map(slug => `
      <div class="otag-pill-item" draggable="true" data-slug="${escapeHtml(slug)}"
        ondragstart="window.__catcfg.otagDragStart(event, '${escapeHtml(slug)}')"
        onclick="window.__catcfg.showOtagMenu(event, '${escapeHtml(slug)}', ${escapeHtml(JSON.stringify(cat.name))})"
        title="Click to reassign · drag to move">
        ${escapeHtml(slug)}
        <span class="otag-pill-remove"
          onclick="event.stopPropagation(); window.__catcfg.removeOtag('${escapeHtml(slug)}')"
          title="Remove from category">×</span>
      </div>`
    ).join('');

    const nameEl = isProtected
      ? `<span class="cat-column-name" style="color:${cat.color}">${escapeHtml(cat.name)}</span>`
      : `<span class="cat-column-name" contenteditable="true" style="color:${cat.color}"
           onblur="window.__catcfg.rename(${escapeHtml(JSON.stringify(cat.name))}, this.textContent.trim())"
         >${escapeHtml(cat.name)}</span>`;

    const actionEl = isProtected
      ? ''
      : `<button class="btn-icon btn-danger" style="font-size:10px;padding:2px 4px" title="Remove category"
           onclick="window.__catcfg.removeCategory(${escapeHtml(JSON.stringify(cat.name))})">✕</button>`;

    const count = catCounts[cat.name] || 0;

    return `
      <div class="cat-column"
        ondragover="event.preventDefault(); this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="window.__catcfg.otagDrop(event, ${escapeHtml(JSON.stringify(cat.name))})">
        <div class="cat-column-header">
          <label class="cat-color-swatch" style="background:${cat.color}" title="Click to change color">
            <span>${count}</span>
            <input type="color" value="${cat.color}"
              onchange="window.__catcfg.setColor(${escapeHtml(JSON.stringify(cat.name))}, this.value)" />
          </label>
          ${nameEl}
          ${actionEl}
        </div>
        <div class="cat-column-pills">
          ${pills || '<span class="muted" style="font-size:10px;padding:2px 0">—</span>'}
        </div>
      </div>`;
  }

  const regularColsHTML = regularCats.map(buildColumn).join('');
  const calcColsHTML    = calcCats.map(buildColumn).join('');

  const availablePillsHTML = unmappedSlugs.map(slug => `
    <div class="otag-pill-item otag-pill-item--unmapped" draggable="true" data-slug="${escapeHtml(slug)}"
      ondragstart="window.__catcfg.otagDragStart(event, '${escapeHtml(slug)}')"
      onclick="window.__catcfg.showOtagMenu(event, '${escapeHtml(slug)}', null)"
      title="Click to assign category">${escapeHtml(slug)}</div>`
  ).join('');

  return `
    <details class="category-config-editor" ${categoryConfigOpen ? 'open' : ''}
      ontoggle="window.__catcfg._setOpen(this.open)">
      <summary class="category-config-summary">
        <span>⚙ Category Config</span>
        <span class="muted" style="font-size:10px">${cats.length} categories</span>
        <span style="flex:1"></span>
        <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
          <button class="btn-secondary btn-sm" style="font-size:10px;padding:2px 8px"
            onclick="window.__catcfg.exportConfig()">↓ Export</button>
          <button class="btn-secondary btn-sm" style="font-size:10px;padding:2px 8px"
            onclick="window.__catcfg.importConfig()">↑ Import</button>
        </div>
      </summary>
      <div class="category-config-body">
        <div class="cat-editor-flex">
          <div class="cat-editor-main">
            <div class="cat-config-add-row" style="margin-bottom:8px">
              <input id="new-cat-name" class="input-text" type="text" placeholder="New Category" style="flex:1;font-size:11px;padding:5px 8px" />
              <input id="new-cat-color" class="cat-color-input" type="color" value="#94a3b8" />
              <button class="btn-secondary btn-sm" onclick="window.__catcfg.addCategory()">+ Add</button>
            </div>
            <div class="muted" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Available Categories (${cats.length})</div>
            <div class="cat-columns" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">${regularColsHTML}</div>
            ${calcColsHTML ? `
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
              <div class="muted" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Calculated Categories</div>
              <div class="cat-columns" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${calcColsHTML}</div>
            </div>` : ''}
            <div style="margin-top:10px">
              <button class="btn-secondary btn-sm" style="color:var(--red);border-color:var(--red)"
                onclick="window.__catcfg.reset()">Reset to Defaults</button>
            </div>
          </div>
          <div class="cat-editor-sidebar">
            <div class="cat-editor-sidebar-label">Unmapped Tags in Deck (${unmappedSlugs.length})</div>
            <div style="position:relative;margin-bottom:6px">
              <input id="cat-otag-search" class="input-text" type="text" placeholder="Search tags"
                style="width:100%;font-size:11px;padding:5px 28px 5px 8px;box-sizing:border-box"
                oninput="window.__catcfg.searchOtags(this.value)" />
              <button style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px"
                onclick="document.getElementById('cat-otag-search').value='';window.__catcfg.searchOtags('')">×</button>
            </div>
            <div class="cat-available-pills">${availablePillsHTML || '<span class="muted" style="font-size:10px">All tags assigned</span>'}</div>
          </div>
        </div>
      </div>
    </details>`;
}

// ─── Card List ─────────────────────────────────────────────────────────────────

function buildCardList(deck, expandedTypeGroups, expandedCards) {
  const groups = {};
  const commanderCards = [];

  for (const card of deck.cards) {
    if (card.isCommander) {
      commanderCards.push(card);
    } else {
      const g = DISPLAY_TYPE_ORDER.find(t => card.types?.includes(t)) || 'Other';
      (groups[g] ??= []).push(card);
    }
  }

  for (const cards of Object.values(groups)) {
    cards.sort((a, b) => a.name.localeCompare(b.name));
  }
  commanderCards.sort((a, b) => a.name.localeCompare(b.name));

  const sections = [];

  // Commander — shown at top, no section wrapper (not part of the 99)
  if (commanderCards.length > 0) {
    const cardRows = commanderCards.map(card => buildCardRow(card, expandedCards)).join('');
    sections.push(`
      <div class="commander-header-row">
        <span class="commander-label">Commander</span>
      </div>
      <div class="card-list commander-card-list">${cardRows}</div>`);
  }

  // Type sections in display order
  for (const type of DISPLAY_TYPE_ORDER) {
    const cards = groups[type];
    if (!cards?.length) continue;
    const color = TYPE_COLORS[type] || TYPE_COLORS.Other;
    sections.push(buildTypeSection(type, cards, color, expandedTypeGroups, expandedCards));
  }

  return `<div class="type-group-list">${sections.join('')}</div>`;
}

function buildTypeSection(type, cards, color, expandedTypeGroups, expandedCards) {
  const count = cards.reduce((s, c) => s + c.quantity, 0);
  const isOpen = expandedTypeGroups.has(type);
  const cardRows = isOpen ? cards.map(card => buildCardRow(card, expandedCards)).join('') : '';

  return `
    <div class="type-group-item">
      <div class="type-group-header" onclick="window.__ovr.toggle('${type}')">
        <span class="type-count-pill" style="background:${color}">${count}</span>
        <span class="type-group-name">${type}</span>
        <span class="type-group-chevron">${isOpen ? '▼' : '▶'}</span>
      </div>
      ${isOpen ? `<div class="type-group-cards card-list">${cardRows}</div>` : ''}
    </div>`;
}

// ─── Card Row ──────────────────────────────────────────────────────────────────

function buildCardRow(card, expandedCards) {
  const isExpanded = expandedCards?.has(card.name);
  const cardNameAttr = escapeHtml(card.name);

  // Build category → color map
  const catDefs = getEffectiveCategories();
  const catColorMap = {};
  for (const c of catDefs) catColorMap[c.name] = c.color;

  // Name + qty (hide "1x" unless quantity > 1)
  const nameCell = `
    <div class="crc-name-cell">
      ${card.quantity > 1 ? `<span class="crc-qty muted">${card.quantity}×</span>` : ''}
      <span class="crc-name"
        data-image-url="${escapeHtml(card.imageUrl || '')}"
        data-back-image-url="${escapeHtml(card.backImageUrl || '')}"
        onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
        onmouseleave="window.__preview?.hide()">${escapeHtml(card.name)}</span>
    </div>`;

  // Unified tag pills (categories only, formatted) — colored variant
  const categories = card.categories || [];
  const pills = categories.map(cat => {
    const val = getCategoryValue(card, cat);
    const label = formatPillLabel(cat, val);
    const color = catColorMap[cat] || '#6b7280';
    const bg = color + '18'; // ~10% opacity hex
    return `<span class="tag-pill-cat" style="border-color:${color};background:${bg};color:${color}">${escapeHtml(label)}</span>`;
  }).join('');
  const tagsCell = `<div class="crc-tags">${pills || '<span class="muted" style="font-size:10px">—</span>'}</div>`;

  const expandedDetail = isExpanded ? buildCardExpandedDetail(card) : '';

  return `
    <div class="card-row-wrapper">
      <div class="crc-row" style="cursor:pointer" onclick="window.__ovr.toggleCard(${escapeHtml(JSON.stringify(card.name))})">
        ${nameCell}
        ${tagsCell}
        <span class="crc-chevron muted" style="font-size:9px;flex-shrink:0">${isExpanded ? '▲' : '▼'}</span>
      </div>
      ${expandedDetail}
    </div>`;
}

// ─── Card Expanded Detail ──────────────────────────────────────────────────────

function buildCardExpandedDetail(card) {
  const otagMap    = getEffectiveOtagMappings();
  const allCatNames = getEffectiveCategoryNames().slice().sort((a, b) => a.localeCompare(b));
  const cardOtags  = card.otags || [];

  // Card image(s)
  const imageHTML = card.imageUrl
    ? `<img src="${escapeHtml(card.imageUrl)}" class="card-detail-image" alt="${escapeHtml(card.name)}" />`
    : '';
  const backImageHTML = card.backImageUrl
    ? `<img src="${escapeHtml(card.backImageUrl)}" class="card-detail-image" alt="${escapeHtml(card.name)} (back)" />`
    : '';
  const imagesHTML = (imageHTML || backImageHTML)
    ? `<div class="card-detail-images">${imageHTML}${backImageHTML}</div>`
    : '';

  // Otag editor rows
  const cardNameAttr = escapeHtml(card.name);
  const otagRows = cardOtags.map(slug => {
    const mappedCat = otagMap[slug] || null;
    const escapedSlug = escapeHtml(slug);

    if (mappedCat) {
      const val = getCategoryValue(card, mappedCat);
      const valueInput = VALUE_CATEGORIES.has(mappedCat)
        ? `<input type="number" class="input-number input-number--sm" value="${val ?? ''}"
            placeholder="val" min="0" max="99" step="1" style="width:52px"
            data-card-name="${cardNameAttr}" data-category="${escapeHtml(mappedCat)}"
            oninput="window.__catval.set(this.dataset.cardName, this.dataset.category, Number(this.value))" />`
        : '';
      return `
        <div class="otag-editor-row">
          <span class="otag-slug">${escapedSlug}</span>
          <span class="otag-arrow muted">→</span>
          <span class="otag-cat-badge">${escapeHtml(mappedCat)}</span>
          ${valueInput}
          <button class="btn-icon btn-danger" title="Remove from card"
            onclick="window.__cardotag.remove(${escapeHtml(JSON.stringify(card.name))}, ${escapeHtml(JSON.stringify(slug))})">✕</button>
        </div>`;
    } else {
      // Unmapped — show category dropdown (assigning globally)
      const catOpts = allCatNames.map(c =>
        `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
      ).join('');
      return `
        <div class="otag-editor-row">
          <span class="otag-slug">${escapedSlug}</span>
          <span class="otag-arrow muted">→</span>
          <select class="select select-sm" style="font-size:10px"
            onchange="window.__cardotag.mapGlobal(${escapeHtml(JSON.stringify(slug))}, this.value); this.value=''">
            <option value="">Map to category…</option>
            ${catOpts}
          </select>
          <button class="btn-icon btn-danger" title="Remove from card"
            onclick="window.__cardotag.remove(${escapeHtml(JSON.stringify(card.name))}, ${escapeHtml(JSON.stringify(slug))})">✕</button>
        </div>`;
    }
  }).join('');

  const otagSection = `
    <div class="card-detail-otag-editor">
      <div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">Scryfall Tags</div>
      ${cardOtags.length === 0
        ? `<span class="muted" style="font-size:11px">No tags — ${card.enriched ? 'none assigned by Scryfall' : 'not enriched yet'}</span>`
        : otagRows}
    </div>`;

  return `
    <div class="card-expanded-detail">
      ${imagesHTML}
      <div class="card-detail-text">
        ${otagSection}
      </div>
    </div>`;
}
