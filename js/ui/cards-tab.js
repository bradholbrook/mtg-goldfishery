/**
 * mullstat - Card Browser
 *
 * Renders a Moxfield-style card browser accordion embedded in the dashboard.
 * Cards are grouped by either card type or mox tag, with image stacks per section.
 */

import { CARD_TYPES } from '../types.js';
import { TYPE_COLORS, tagColor, escapeHtml } from './shared.js';

const DISPLAY_TYPE_ORDER = [
  'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment',
  'Land', 'Planeswalker', 'Battle', 'MDFC', 'Other',
];

// ─── Public Entry Point ────────────────────────────────────────────────────────

/**
 * Build the full card browser section (toggle + accordion).
 *
 * @param {import('../types.js').DeckConfig} deck
 * @param {Set<string>} expandedGroups  - Which group labels are currently expanded
 * @param {'types'|'tags'} viewMode     - Current grouping toggle state
 * @param {'alpha'|'cmc'} sort          - Current card sort order within groups
 * @returns {string} HTML
 */
export function buildCardBrowser(deck, expandedGroups = new Set(), viewMode = 'types', sort = 'alpha') {
  const allCards = deck.cards;
  const hasTags = allCards.some(c => c.moxTags?.length > 0);

  const viewToggleHTML = `
    <div class="view-toggle">
      <button class="view-toggle-btn ${viewMode === 'types' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__ovr.setView('types')">Types</button>
      <button class="view-toggle-btn ${viewMode === 'tags' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__ovr.setView('tags')">Tags</button>
    </div>`;

  const sortToggleHTML = `
    <div class="view-toggle">
      <button class="view-toggle-btn ${sort === 'alpha' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__ovr.setSort('alpha')">A–Z</button>
      <button class="view-toggle-btn ${sort === 'cmc' ? 'view-toggle-btn--active' : ''}"
        onclick="window.__ovr.setSort('cmc')">CMC</button>
    </div>`;

  let sectionsHTML;
  if (viewMode === 'types') {
    sectionsHTML = buildTypeSections(allCards, expandedGroups, sort);
  } else {
    if (!hasTags) {
      sectionsHTML = `<p class="muted" style="font-size:12px;margin:8px 0">No tags found — add <code>#tags</code> to card lines in plain-text import (e.g. <code>1 Sol Ring #ramp #mana-rock</code>).</p>`;
    } else {
      sectionsHTML = buildTagSections(allCards, expandedGroups, sort);
    }
  }

  return `
    <div class="section">
      <div class="section-label">Cards</div>
      <div class="card-browser-controls">
        ${viewToggleHTML}
        ${sortToggleHTML}
      </div>
      <div class="type-group-list">${sectionsHTML}</div>
    </div>`;
}

// ─── Type Grouping ─────────────────────────────────────────────────────────────

function buildTypeSections(allCards, expandedGroups, sort) {
  const groups = {};

  for (const card of allCards.filter(c => !c.isCommander)) {
    const g = DISPLAY_TYPE_ORDER.find(t => card.types?.includes(t)) || 'Other';
    (groups[g] ??= []).push(card);
  }

  const sections = [];

  for (const type of DISPLAY_TYPE_ORDER) {
    const cards = groups[type];
    if (!cards?.length) continue;
    sections.push(buildSection(type, cards, TYPE_COLORS[type] || TYPE_COLORS.Other, expandedGroups, sort));
  }

  return sections.join('');
}

// ─── Tag Grouping ──────────────────────────────────────────────────────────────

function buildTagSections(allCards, expandedGroups, sort) {
  const tagGroups = {};
  const untagged = [];

  for (const card of allCards) {
    const tags = card.moxTags || [];
    if (!tags.length) {
      untagged.push(card);
    } else {
      for (const tag of tags) {
        (tagGroups[tag] ??= []).push(card);
      }
    }
  }

  const sortedTags = Object.keys(tagGroups).sort((a, b) => a.localeCompare(b));
  const sections = sortedTags.map(tag =>
    buildSection(tag, tagGroups[tag], tagColor(tag), expandedGroups, sort)
  );

  if (untagged.length) {
    sections.push(buildSection('(untagged)', untagged, '#6b7280', expandedGroups, sort));
  }

  return sections.join('');
}

// ─── Section Builder ───────────────────────────────────────────────────────────

function buildSection(label, cards, color, expandedGroups, sort) {
  const count = cards.reduce((s, c) => s + c.quantity, 0);
  const isOpen = expandedGroups.has(label);

  const sortFn = sort === 'cmc'
    ? (a, b) => ((a.cmc ?? 0) - (b.cmc ?? 0)) || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name);
  const sorted = [...cards].sort(sortFn);

  return `
    <div class="type-group-item">
      <div class="type-group-header" data-label="${escapeHtml(label)}" onclick="window.__ovr.toggle(this.dataset.label)">
        <span class="type-count-pill" style="background:${color}">${count}</span>
        <span class="type-group-name">${escapeHtml(label)}</span>
        <span class="type-group-chevron">${isOpen ? '▼' : '▶'}</span>
      </div>
      ${isOpen ? `<div class="card-stack-section">${buildCardPile(sorted)}</div>` : ''}
    </div>`;
}

// ─── Card Pile (3-column stacked layout) ──────────────────────────────────────

function buildCardPile(cards) {
  // Deduplicate (same card can appear in multiple tag groups)
  const seen = new Set();
  const unique = cards.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  // Distribute into 3 columns — fill each column top-to-bottom before moving right
  const colSize = Math.ceil(unique.length / 3);
  const cols = [
    unique.slice(0, colSize),
    unique.slice(colSize, colSize * 2),
    unique.slice(colSize * 2),
  ];

  const colsHTML = cols.map(col => {
    if (!col.length) return `<div class="card-pile-col"></div>`;
    const items = col.map((card, idx) => {
      const isLast = idx === col.length - 1;
      const tags = card.moxTags || [];
      const tagsAttr = JSON.stringify(tags).replace(/"/g, '&quot;');
      const imgUrl = escapeHtml(card.imageUrl || '');
      const backUrl = escapeHtml(card.backImageUrl || '');
      const qty = card.quantity;

      if (card.imageUrl) {
        return `
          <div class="card-stack-item${isLast ? ' card-stack-item--last' : ''}"
            data-image-url="${imgUrl}"
            data-tags="${tagsAttr}"
            onmouseenter="window.__pileCard?.show(this.dataset.imageUrl, this); window.__preview?.showTags(JSON.parse(this.dataset.tags || '[]'), this)"
            onmouseleave="window.__pileCard?.hide(); window.__preview?.hide()">
            <img src="${imgUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
            ${qty > 1 ? `<div class="card-stack-qty">${qty}</div>` : ''}
          </div>`;
      }

      return `
        <div class="card-stack-item card-stack-item--noimage${isLast ? ' card-stack-item--last' : ''}"
          data-tags="${tagsAttr}"
          onmouseenter="window.__preview?.showTags(JSON.parse(this.dataset.tags || '[]'), this)"
          onmouseleave="window.__preview?.hide()">
          <span class="card-stack-name">${escapeHtml(card.name)}</span>
          ${qty > 1 ? `<div class="card-stack-qty">${qty}</div>` : ''}
        </div>`;
    }).join('');
    return `<div class="card-pile-col">${items}</div>`;
  }).join('');

  return `<div class="card-stack">${colsHTML}</div>`;
}
