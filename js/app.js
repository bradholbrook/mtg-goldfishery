/**
 * mullstat - App Entry Point
 *
 * Wires together: parser → storage → simulator → ui
 * Handles all user events.
 */

import { parseMoxfieldDecklist, parseMoxfieldApiResponse } from './parser.js';
import { hypgeomAtLeast } from './hypergeometric.js';
import { runSimulation, flattenDeck } from './simulator.js';
import {
  addDeck, removeDeck, addResults,
  getDeckById, getResultsForDeck, saveToFile, loadFromFile,
  updateDeckGoodHandDefs, removeGoodHandDef,
  updateDeckDiscardPriorities,
  renameDeck,
  clearResultsForDeck,
  updateEffectDef, removeEffectDef,
} from './storage.js';
import {
  renderDeckList, renderActiveDeck, showToast,
  setImportLoading, TYPE_COLORS,
} from './ui.js';
import { generateId } from './types.js';
import { CRITERION_TYPES, CRITERION_TYPE_OPTIONS, evaluateGoodHandDef } from './criteria.js';
import { enrichDeckWithScryfall, enrichTagsForDeck } from './enrichment.js';
import {
  setLabN, setLabTarget,
  setActiveSubTab, setEffectOpen,
  matchingCardsForEffect, matchingCardsForCriterion,
  buildNSensGraph, buildSrcSensGraph,
} from './ui/calculate-tab.js';
import { setBottomOpen } from './ui/config-tab.js';

// ─── State ────────────────────────────────────────────────────────────────────

let activeDeckId = null;

/**
 * When non-null, the active deck panel shows the definition editor.
 * Shape: { defId: string|null, name: string, criteria: Criterion[] }
 *   defId = null  → creating a new definition
 *   defId = uuid  → editing an existing definition
 */
let editingDef = null;

let activeTab = 'dashboard';

/** Which view to show in the inline results section: 'tags' or 'types'. */
let resultView = 'tags';

/** Sort order for avg cards in kept hand: 'alpha' or 'value'. */
let resultSort = 'value';

/** Section labels currently expanded in the card browser accordion. */
const expandedTypeGroups = new Set();

/** Whether the card browser shows 'types' or 'tags' grouping. */
let cardBrowserView = 'types';

/** Whether cards are sorted 'alpha' or 'cmc' within each group. */
let cardBrowserSort = 'alpha';

// ─── Modal Dialogs ────────────────────────────────────────────────────────────

function showConfirmModal(message, onConfirm, { title = 'Confirm', confirmLabel = 'Confirm', danger = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  overlay.innerHTML = `
    <div class="app-modal">
      <div class="app-modal-header">
        <span>${title}</span>
        <button class="btn-icon" id="_modal-close">✕</button>
      </div>
      <div class="app-modal-body">${message}</div>
      <div class="app-modal-footer">
        <button class="btn-secondary" id="_modal-cancel">Cancel</button>
        <button class="${danger ? 'btn-danger-filled' : 'btn-primary'}" id="_modal-confirm">${confirmLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#_modal-close').addEventListener('click', close);
  overlay.querySelector('#_modal-cancel').addEventListener('click', close);
  overlay.querySelector('#_modal-confirm').addEventListener('click', () => { close(); onConfirm(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function showPromptModal(message, defaultValue, onConfirm, { title = 'Enter Value' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  overlay.innerHTML = `
    <div class="app-modal">
      <div class="app-modal-header">
        <span>${title}</span>
        <button class="btn-icon" id="_modal-close">✕</button>
      </div>
      <div class="app-modal-body">
        <div style="margin-bottom:8px">${message}</div>
        <input class="input-text" id="_modal-input" type="text" value="${defaultValue.replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box" />
      </div>
      <div class="app-modal-footer">
        <button class="btn-secondary" id="_modal-cancel">Cancel</button>
        <button class="btn-primary" id="_modal-confirm">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const input = overlay.querySelector('#_modal-input');
  const confirm = () => { const v = input.value.trim(); if (v) { close(); onConfirm(v); } };
  overlay.querySelector('#_modal-close').addEventListener('click', close);
  overlay.querySelector('#_modal-cancel').addEventListener('click', close);
  overlay.querySelector('#_modal-confirm').addEventListener('click', confirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindImportPanel();
  bindSaveLoad();
  refresh();

  // Close dropdowns/multiselects when clicking outside them (or into a different one)
  document.addEventListener('click', e => {
    document.querySelectorAll('.card-multiselect-dropdown[open], .crit-ms-dropdown[open], .crit-type-dropdown[open]')
      .forEach(el => { if (!el.contains(e.target)) el.removeAttribute('open'); });
  });
});

// ─── Refresh (re-render everything from state) ────────────────────────────────

function refresh() {
  const deck = getDeckById(activeDeckId);
  const allResults = deck ? getResultsForDeck(deck.id) : [];
  const latestResults = allResults[allResults.length - 1] || null;
  renderDeckList(handleSelectDeck, handleDeleteDeck);
  renderActiveDeck(deck, handleRunSimulation, editingDef, activeTab, expandedTypeGroups, cardBrowserView, cardBrowserSort, latestResults, resultView, resultSort);
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

const MOXFIELD_URL_RE = /moxfield\.com\/decks\/([\w-]+)/i;

// Moxfield's API doesn't set CORS headers, so browsers block direct fetches.
// corsproxy.io proxies the request server-side and adds CORS headers for us.
// Swap this constant if a self-hosted proxy is added later.
const CORS_PROXY = 'https://corsproxy.io/?url=';

/**
 * Run oracle-tag enrichment for a deck in the background.
 * Updates the live appState reference directly, then calls refresh().
 * Safe to call without await — errors are caught and reflected in tagsStatus.
 */
async function runTagEnrichment(deckId, deckPhase1) {
  try {
    const deckWithTags = await enrichTagsForDeck(
      deckPhase1,
      msg => console.log('[tags]', msg),
      msg => showToast(msg, 'warn'),
    );
    const live = getDeckById(deckId);
    if (!live) return; // deck was removed while tags were loading
    live.cards      = deckWithTags.cards;
    live.tagsStatus = deckWithTags.tagsStatus;
    delete live._enrichmentMap;
    refresh();
  } catch (err) {
    const live = getDeckById(deckId);
    if (live) { live.tagsStatus = 'failed'; delete live._enrichmentMap; }
    showToast('Oracle tag fetch timed out or failed — castability unavailable.', 'warn');
    refresh();
  }
}

function logEnrichedDeck(deck) {
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  console.groupCollapsed(`[mullstat] Enriched deck: "${deck.name}" — ${deck.cards.length} unique / ${total} total`);
  console.table(deck.cards.map(c => ({
    name:     c.name,
    qty:      c.quantity,
    types:    c.types?.join(', ') ?? '—',
    cmc:      c.cmc ?? '—',
    tags:     c.effectTags?.map(t => t.subtype).join(', ') || '',
    enriched: c.enriched ?? false,
  })));
  const unenriched = deck.cards.filter(c => !c.enriched);
  if (unenriched.length) console.warn('Failed Scryfall enrichment:', unenriched.map(c => c.name));
  console.groupEnd();
}

function bindImportPanel() {
  const importBtn     = document.getElementById('import-btn');
  const importTextarea = document.getElementById('import-textarea');
  const importNameInput = document.getElementById('import-name');
  const importToggle  = document.getElementById('import-toggle');
  const importPanel   = document.getElementById('import-panel');

  function clearImportPanel() {
    if (importTextarea)  importTextarea.value = '';
    if (importNameInput) importNameInput.value = '';
    importPanel?.classList.add('hidden');
    if (importToggle) importToggle.textContent = '+ Import Deck';
  }

  // Toggle panel visibility
  importToggle?.addEventListener('click', () => {
    importPanel.classList.toggle('hidden');
    importToggle.textContent = importPanel.classList.contains('hidden')
      ? '+ Import Deck' : '− Cancel';
  });

  importBtn?.addEventListener('click', async () => {
    const text = importTextarea?.value?.trim();
    if (!text) {
      showToast('Paste a decklist or Moxfield URL first.', 'warn');
      return;
    }

    const name = importNameInput?.value?.trim() || '';
    const urlMatch = text.match(MOXFIELD_URL_RE);

    if (urlMatch) {
      // ── URL import path ──────────────────────────────────────────────────
      const publicId = urlMatch[1];
      importBtn.disabled = true;
      importBtn.textContent = '· Fetching…';

      try {
        // Append timestamp so corsproxy.io sees a unique URL each import (bypasses proxy cache)
        const apiUrl = `https://api2.moxfield.com/v2/decks/all/${publicId}?_t=${Date.now()}`;
        const res = await fetch(CORS_PROXY + encodeURIComponent(apiUrl), { cache: 'no-store' });
        if (!res.ok) throw new Error(`Moxfield returned HTTP ${res.status}`);

        const apiData = await res.json();

        const mainboardEntries = Object.values(apiData.mainboard || {});
        const { deck, errors } = parseMoxfieldApiResponse(apiData, name);
        const noTypeLine = mainboardEntries.filter(e => !e.card?.type_line);
        if (noTypeLine.length) console.warn('[mullstat] Moxfield entries with missing type_line:', noTypeLine.map(e => e.card?.name));
        const taggedCards = deck.cards.filter(c => c.moxTags?.length > 0);
        console.log(`[mullstat] Moxfield: parsed ${deck.cards.length} unique cards (${mainboardEntries.reduce((s, e) => s + (e.quantity || 1), 0)} total), ${taggedCards.length} with tags`);
        if (taggedCards.length === 0 && mainboardEntries.length > 0) {
          // Log a sample entry to inspect the API structure if no tags were found
          const sample = mainboardEntries.find(e => e.tags?.length) ?? mainboardEntries[0];
          console.log('[mullstat] Sample mainboard entry (checking for tags field):', sample);
        }

        errors.forEach(e => showToast(e, 'warn'));

        if (deck.cards.length === 0) {
          showToast('Could not parse any cards from Moxfield.', 'error');
          return;
        }

        // Phase 1: Scryfall enrichment
        importBtn.textContent = '· Enriching…';
        setImportLoading(true, 'Fetching card data from Scryfall…');
        let deckPhase1 = deck;
        try {
          deckPhase1 = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg), msg => showToast(msg, 'warn'));
        } catch (enrichErr) {
          showToast(`Scryfall enrichment failed: ${enrichErr.message}`, 'warn');
        }
        setImportLoading(false);

        logEnrichedDeck(deckPhase1);
        addDeck(deckPhase1);
        activeDeckId = deckPhase1.id;
        clearImportPanel();
        showToast(`Imported "${deckPhase1.name}" — ${deckPhase1.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();

        // Phase 2: oracle tags in background (non-blocking)
        runTagEnrichment(deckPhase1.id, deckPhase1);

      } catch (err) {
        showToast(`Moxfield fetch failed: ${err.message}`, 'error');
        setImportLoading(false);
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }

    } else {
      // ── Plain-text paste path ────────────────────────────────────────────
      const { deck, errors } = parseMoxfieldDecklist(text, name || 'Unnamed Deck');

      errors.forEach(e => showToast(e, 'warn'));

      if (deck.cards.length === 0) {
        showToast('Could not parse any cards. Check the format.', 'error');
        return;
      }

      // Phase 1: Scryfall enrichment
      importBtn.disabled = true;
      importBtn.textContent = '· Enriching…';
      setImportLoading(true, 'Fetching card data from Scryfall…');
      let deckPhase1 = deck;
      try {
        deckPhase1 = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg), msg => showToast(msg, 'warn'));
        setImportLoading(false);
        logEnrichedDeck(deckPhase1);
        addDeck(deckPhase1);
        activeDeckId = deckPhase1.id;
        clearImportPanel();
        showToast(`Imported "${deckPhase1.name}" — ${deckPhase1.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();
        // Phase 2: oracle tags in background (non-blocking)
        runTagEnrichment(deckPhase1.id, deckPhase1);
      } catch (err) {
        // Enrichment failure: still import the deck, just without enrichment
        setImportLoading(false);
        addDeck(deck);
        activeDeckId = deck.id;
        clearImportPanel();
        showToast(`Imported "${deck.name}" without enrichment (${err.message})`, 'warn');
        refresh();
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }
    }
  });
}

// ─── Deck Selection ───────────────────────────────────────────────────────────

function handleSelectDeck(deckId) {
  activeDeckId = deckId;
  editingDef = null;
  activeTab = 'dashboard';
  expandedTypeGroups.clear();

  document.querySelectorAll('.deck-card').forEach(el => {
    el.classList.toggle('deck-card--active', el.dataset.deckId === deckId);
  });

  refresh();
}

function handleDeleteDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  showConfirmModal(`Remove "<strong>${deck.name}</strong>"? This cannot be undone.`, () => {
    removeDeck(deckId);
    if (activeDeckId === deckId) activeDeckId = null;
    showToast(`Removed "${deck.name}"`, 'info');
    refresh();
  }, { title: 'Remove Deck', confirmLabel: 'Remove', danger: true });
  return;
}

// ─── Good Hand Definition Actions ────────────────────────────────────────────
//
// Exposed on window.__ghh so that inline onclick= attributes in ui.js templates
// can reach them without circular imports or prop-drilling callbacks.
// All mutating actions call refresh() to re-render from the updated state.

/**
 * Update a criterion multiselect summary text from DOM order (so it reflects
 * the canonical list order rather than selection order).
 */
const COMBINED_CRIT_TYPES = ['types_and_tags', 'types_and_tags_at_mv'];

function _updateApplicabilityNote() {
  const el = document.querySelector('.def-editor-applicability');
  if (!el || !editingDef) return;
  const min = (editingDef.criteria || []).reduce((sum, c) => sum + (Number(c.count) || 1), 0);
  let html = '';
  if (min > 7) {
    html = `<span class="mull-note mull-note--warn">⚠ needs ${min} cards — can never be satisfied</span>`;
  } else if (min > 0) {
    const cls = min <= 4 ? 'mull-note--ok' : min <= 6 ? 'mull-note--mid' : 'mull-note--tight';
    html = `<span class="mull-note ${cls}">requires ≥${min} cards</span>`;
  }
  el.innerHTML = html;
}

function _updateSubtypeSection(critIdx, criterion) {
  const details = document.querySelector(`[data-crit-idx="${critIdx}"] details[data-ms-key="subtypes"]`);
  if (!details) return;
  const mapJson = details.dataset.subtypeMap;
  if (!mapJson) return;
  let typeSubtypeMap;
  try { typeSubtypeMap = JSON.parse(mapJson); } catch { return; }

  const selectedTypes = Array.isArray(criterion.cardTypes) ? criterion.cardTypes : [];
  const validSubtypes = selectedTypes.length
    ? [...new Set(selectedTypes.flatMap(t => typeSubtypeMap[t] || []))].sort()
    : [...new Set(Object.values(typeSubtypeMap).flat())].sort();

  // Prune selected subtypes that are no longer valid for the new type selection
  const prev = Array.isArray(criterion.subtypes) ? criterion.subtypes : [];
  criterion.subtypes = prev.filter(s => validSubtypes.includes(s));

  const list = details.querySelector('.crit-ms-list');
  if (!list) return;
  if (!validSubtypes.length) {
    list.innerHTML = '<div class="ms-empty">No subtypes in deck</div>';
  } else {
    list.innerHTML = validSubtypes.map(s => {
      const checked = criterion.subtypes.includes(s);
      return `<label class="ms-item${checked ? ' ms-item--checked' : ''}" data-group="subtype">
        <input type="checkbox" class="ms-checkbox"${checked ? ' checked' : ''}
          onchange="window.__ghh.toggleSubtype(${critIdx},${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <span>${s}</span>
      </label>`;
    }).join('');
  }

  const summaryEl = details.querySelector('.crit-ms-toggle');
  if (summaryEl) summaryEl.textContent = criterion.subtypes.length ? criterion.subtypes.join('/') : '(Any Subtype)';
}

function _updateCombinedTypeTagSummary(critIdx) {
  const details = document.querySelector(`[data-crit-idx="${critIdx}"] details[data-ms-type="combined"]`);
  if (!details) return;
  const getText = el => el.closest('.ms-item')?.querySelector('span')?.textContent?.trim();
  const checkedTypes = [...details.querySelectorAll('.ms-item[data-group="type"] input:checked')].map(getText).filter(Boolean);
  const checkedTags  = [...details.querySelectorAll('.ms-item[data-group="tag"]  input:checked')].map(getText).filter(Boolean);
  const parts = [];
  if (checkedTypes.length) parts.push(checkedTypes.join('/'));
  if (checkedTags.length)  parts.push(checkedTags.join('/'));
  const summaryEl = details.querySelector('.crit-ms-toggle');
  if (summaryEl) summaryEl.textContent = parts.length ? parts.join(' & ') : '(Any Card)';
}

function _updateMsSummary(critIdx, fieldKey, placeholder, fmt = null) {
  const details = document.querySelector(`[data-crit-idx="${critIdx}"] [data-ms-key="${fieldKey}"]`)?.closest('details');
  if (!details) return;
  const checked = [...details.querySelectorAll('.ms-item input:checked')]
    .map(el => el.closest('.ms-item')?.querySelector('span')?.textContent?.trim())
    .filter(Boolean);
  const summaryEl = details.querySelector('.crit-ms-toggle');
  if (summaryEl) summaryEl.textContent = checked.length
    ? (fmt ? fmt(checked) : checked.join('/'))
    : placeholder;
}

function freshCriterion() {
  const firstType = CRITERION_TYPE_OPTIONS[0];
  return { type: firstType.id, ...firstType.defaultValues() };
}

window.__ghh = {

  addDef() {
    const deck = getDeckById(activeDeckId);
    const hasNoDefs = !deck?.goodHandDefs?.length;
    editingDef = {
      defId: null,
      name: hasNoDefs ? 'Keepable Hand' : '',
      criteria: hasNoDefs
        ? [{ type: 'types_and_tags', count: 3, cardTypes: ['Land'], tagNames: [] }]
        : [freshCriterion()],
    };
    refresh();
  },

  editDef(defId) {
    // Toggle: collapse if already expanded
    if (editingDef?.defId === defId) {
      editingDef = null;
      refresh();
      return;
    }
    const deck = getDeckById(activeDeckId);
    const def = deck?.goodHandDefs?.find(d => d.id === defId);
    if (!def) return;
    // Deep-copy so edits don't mutate the stored def until Save
    editingDef = { defId, name: def.name, criteria: def.criteria.map(c => ({ ...c })) };
    refresh();
  },

  removeDef(defId) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    showConfirmModal('Remove this good hand definition?', () => {
      removeGoodHandDef(deck.id, defId);
      refresh();
    }, { title: 'Remove Definition', confirmLabel: 'Remove', danger: true });
  },

  saveDef() {
    if (!editingDef) return;
    // Read name directly from DOM as safety net (oninput may not fire on rapid click)
    const nameEl = document.getElementById('def-name-input');
    let name = (nameEl?.value ?? editingDef.name).trim();
    if (!editingDef.criteria.length) { showToast('Add at least one criterion.', 'warn'); return; }
    // Auto-generate name from first criterion if blank
    if (!name) {
      const firstCrit = editingDef.criteria[0];
      const typeInfo = CRITERION_TYPES[firstCrit.type];
      name = typeInfo ? typeInfo.describe(firstCrit) : 'Good Hand';
    }

    const deck = getDeckById(activeDeckId);
    if (!deck) return;

    updateDeckGoodHandDefs(deck.id, {
      id: editingDef.defId || generateId(),
      name,
      criteria: editingDef.criteria,
    });

    editingDef = null;
    refresh();
    showToast(`Saved "${name}"`, 'success');
  },

  cancelEdit() {
    editingDef = null;
    refresh();
  },

  addCrit() {
    if (!editingDef) return;
    editingDef.criteria.push(freshCriterion());
    refresh();
  },

  removeCrit(idx) {
    if (!editingDef) return;
    editingDef.criteria.splice(idx, 1);
    refresh();
  },

  /** Change the TYPE of a criterion — structural change, triggers re-render */
  changeType(idx, type) {
    if (!editingDef) return;
    const typeInfo = CRITERION_TYPES[type];
    if (!typeInfo) return;
    editingDef.criteria[idx] = { type, ...typeInfo.defaultValues() };
    refresh();
  },

  /** Update a criterion value — no re-render needed */
  setVal(idx, key, val) {
    if (!editingDef?.criteria[idx]) return;
    editingDef.criteria[idx][key] = val;
    if (key === 'count') _updateApplicabilityNote();
  },

  /** Toggle a type in/out of a criterion's cardTypes array (no full re-render). */
  toggleType(idx, typeName, fieldKey = 'cardTypes') {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx][fieldKey] || [];
    editingDef.criteria[idx][fieldKey] = current.includes(typeName)
      ? current.filter(t => t !== typeName)
      : [...current, typeName];
    if (COMBINED_CRIT_TYPES.includes(editingDef.criteria[idx].type)) {
      _updateSubtypeSection(idx, editingDef.criteria[idx]);
      _updateCombinedTypeTagSummary(idx);
    } else {
      _updateMsSummary(idx, fieldKey, '(Any Card)');
    }
  },

  /** Toggle an MV value in/out of a criterion's mvValues array (no full re-render). */
  toggleMv(idx, mv) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].mvValues || [];
    editingDef.criteria[idx].mvValues = current.includes(mv)
      ? current.filter(v => v !== mv)
      : [...current, mv];
    _updateMsSummary(idx, 'mvValues', '(Any MV)');
  },

  /** Toggle a subtype in/out of a criterion's subtypes array (no full re-render). */
  toggleSubtype(idx, subtype) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].subtypes || [];
    editingDef.criteria[idx].subtypes = current.includes(subtype)
      ? current.filter(s => s !== subtype)
      : [...current, subtype];
    _updateMsSummary(idx, 'subtypes', '(Any Subtype)');
  },

  /** Toggle a tag name in/out of a criterion's tagNames array (no full re-render). */
  toggleTag(idx, tagName) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].tagNames || [];
    editingDef.criteria[idx].tagNames = current.includes(tagName)
      ? current.filter(t => t !== tagName)
      : [...current, tagName];
    if (COMBINED_CRIT_TYPES.includes(editingDef.criteria[idx].type)) {
      _updateCombinedTypeTagSummary(idx);
    } else {
      _updateMsSummary(idx, 'tagNames', '(Any Card)');
    }
  },

  /** Toggle a card name in/out of a criterion's cardNames array (no full re-render). */
  toggleCard(idx, cardName) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].cardNames || [];
    editingDef.criteria[idx].cardNames = current.includes(cardName)
      ? current.filter(n => n !== cardName)
      : [...current, cardName];
    _updateMsSummary(idx, 'cardNames', '(Any Card)', (items) =>
      items.length <= 2 ? items.join(' or ') : `${items.length} cards`
    );
  },

  /** Update the definition name — no re-render needed */
  setName(val) {
    if (!editingDef) return;
    editingDef.name = val;
  },

  /** Generate up to 3 sample hands that satisfy a specific good hand def and show them. */
  sampleDef(defId) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    const def = deck.goodHandDefs?.find(d => d.id === defId);
    if (!def) return;

    const flat = flattenDeck(deck);
    const samples = [];
    const MAX_ATTEMPTS = 2000;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && samples.length < 3; attempt++) {
      // Fisher-Yates shuffle
      const lib = [...flat];
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
      const hand = lib.slice(0, 7);
      if (evaluateGoodHandDef(def, hand)) samples.push(hand);
    }

    if (!samples.length) {
      showToast('No matching hands found — criteria may be very restrictive.', 'warn');
      return;
    }
    window.__hands.show(samples);
  },

  /** Drag-to-reorder good hand defs (priority ordering for mulligan evaluation). */
  _dragSrc: null,

  dragStart(idx) {
    this._dragSrc = idx;
  },

  drop(targetIdx) {
    if (this._dragSrc === null || this._dragSrc === targetIdx) {
      this._dragSrc = null;
      return;
    }
    const deck = getDeckById(activeDeckId);
    if (!deck?.goodHandDefs) return;
    const defs = [...deck.goodHandDefs];
    const [moved] = defs.splice(this._dragSrc, 1);
    defs.splice(targetIdx, 0, moved);
    // Direct mutation — getDeckById returns the live appState reference
    deck.goodHandDefs = defs;
    this._dragSrc = null;
    refresh();
  },
};

// ─── Discard Priority Actions ─────────────────────────────────────────────────
//
// Exposed on window.__disc so config-tab onclick= attributes can reach them.
// All structural changes call refresh(); value changes mutate in place (no refresh).

window.__disc = {
  _dragSrc: null,

  toggleBottom(v) { setBottomOpen(v); },

  add() {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    if (!Array.isArray(deck.discardPriorities)) deck.discardPriorities = [];
    deck.discardPriorities.push({ id: generateId(), modifier: 'highest_cmc', cardType: 'Any' });
    updateDeckDiscardPriorities(deck.id, deck.discardPriorities);
    setBottomOpen(true);
    refresh();
  },

  remove(idx) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    deck.discardPriorities = (deck.discardPriorities || []).filter((_, i) => i !== idx);
    updateDeckDiscardPriorities(deck.id, deck.discardPriorities);
    refresh();
  },

  /** Direct mutation — no refresh needed, dropdowns are already updated. */
  set(idx, key, val) {
    const deck = getDeckById(activeDeckId);
    if (!deck?.discardPriorities?.[idx]) return;
    deck.discardPriorities[idx][key] = val;
  },

  /** Toggle a card type in/out of a bottom-priority rule's cardTypes array (no re-render). */
  toggleType(idx, typeName) {
    const deck = getDeckById(activeDeckId);
    if (!deck?.discardPriorities?.[idx]) return;
    const rule = deck.discardPriorities[idx];
    // Migrate legacy cardType string → cardTypes array
    if (!Array.isArray(rule.cardTypes)) {
      rule.cardTypes = (rule.cardType && rule.cardType !== 'Any') ? [rule.cardType] : [];
      delete rule.cardType;
    }
    rule.cardTypes = rule.cardTypes.includes(typeName)
      ? rule.cardTypes.filter(t => t !== typeName)
      : [...rule.cardTypes, typeName];
    // Update summary from DOM order (canonical)
    const row = document.querySelector(`[data-disc-idx="${idx}"]`);
    const checked = [...(row?.querySelectorAll('.crit-ms-list .ms-item input:checked') ?? [])]
      .map(el => el.closest('.ms-item')?.querySelector('span')?.textContent?.trim())
      .filter(Boolean);
    const summaryEl = row?.querySelector('.disc-ms-toggle');
    if (summaryEl) summaryEl.textContent = checked.length ? checked.join(' or ') : '(any type)';
  },

  /** Update modifier label inline without full re-render. */
  setModifier(idx, value) {
    const deck = getDeckById(activeDeckId);
    if (!deck?.discardPriorities?.[idx]) return;
    deck.discardPriorities[idx].modifier = value;
    // Update the toggle text — read label from the clicked option's text
    const toggle = document.querySelector(`[data-disc-idx="${idx}"] .crit-type-toggle`);
    if (toggle) {
      // Find the now-active option in the DOM
      const active = document.querySelector(`[data-disc-idx="${idx}"] .crit-type-option.crit-type-option--active`);
      // The option was updated by changeType's onclick before this fires — but we can derive from value
      const labels = { highest_cmc: 'Highest CMC', lowest_cmc: 'Lowest CMC', any: 'Any' };
      toggle.textContent = labels[value] ?? value;
    }
  },

  dragStart(idx) {
    this._dragSrc = idx;
  },

  drop(targetIdx) {
    if (this._dragSrc === null || this._dragSrc === targetIdx) {
      this._dragSrc = null;
      return;
    }
    const deck = getDeckById(activeDeckId);
    if (!deck?.discardPriorities) return;
    const priorities = [...deck.discardPriorities];
    const [moved] = priorities.splice(this._dragSrc, 1);
    priorities.splice(targetIdx, 0, moved);
    updateDeckDiscardPriorities(deck.id, priorities);
    this._dragSrc = null;
    refresh();
  },
};



// ─── Card Image Preview ───────────────────────────────────────────────────────

{
  const _previewEl      = document.getElementById('card-image-preview');
  const _previewImg     = document.getElementById('card-image-preview-img');
  const _previewImgBack = document.getElementById('card-image-preview-img-back');
  const _previewTags    = document.getElementById('card-image-preview-tags');

  function _renderTags(tags) {
    if (!_previewTags) return;
    if (tags && tags.length > 0) {
      const sorted = [...tags].sort((a, b) => a.localeCompare(b));
      _previewTags.innerHTML = sorted.map(t =>
        `<span class="preview-tag-pill">${t.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`
      ).join('');
      _previewTags.style.display = 'flex';
    } else {
      _previewTags.innerHTML = '';
      _previewTags.style.display = 'none';
    }
  }

  let _locked = false;
  let _anchored = false; // true when tags popup is pinned to a pile card

  function _positionAtElement(el, estimatedW = 150) {
    if (!el || !_previewEl) return;
    const rect = el.getBoundingClientRect();
    // Use provided estimate before layout; offsetWidth may be 0 on first paint.
    const w = _previewEl.offsetWidth || estimatedW;
    const h = _previewEl.offsetHeight || 100;
    // Prefer right side of card; flip left if it would overflow
    let x = rect.right + 6;
    if (x + w > window.innerWidth - 6) x = rect.left - w - 6;
    const y = Math.max(6, Math.min(rect.top, window.innerHeight - h - 6));
    _previewEl.style.left = x + 'px';
    _previewEl.style.top  = y + 'px';
  }

  window.__preview = {
    show(imageUrl, backImageUrl, tags = []) {
      if (_locked || !imageUrl || !_previewEl || !_previewImg) return;
      _previewImg.style.display = '';
      _previewImg.src = imageUrl;
      if (backImageUrl && _previewImgBack) {
        _previewImgBack.style.display = '';
        _previewImgBack.src = backImageUrl;
        _previewEl.classList.add('dual');
      } else {
        if (_previewImgBack) _previewImgBack.src = '';
        _previewEl.classList.remove('dual');
      }
      _renderTags(tags);
      _anchored = false;
      _previewEl.style.display = 'flex';
    },
    // anchorEl: when provided, pin the popup to the top-right of that element.
    showTags(tags = [], anchorEl = null) {
      if (_locked || !_previewEl) return;
      // Hide img elements so they don't add width when showing tags only.
      if (_previewImg) { _previewImg.src = ''; _previewImg.style.display = 'none'; }
      if (_previewImgBack) { _previewImgBack.src = ''; _previewImgBack.style.display = 'none'; }
      _previewEl.classList.remove('dual');
      _renderTags(tags);
      if (!tags.length) { _previewEl.style.display = 'none'; return; }
      _previewEl.style.display = 'flex';
      if (anchorEl) {
        _anchored = true;
        _positionAtElement(anchorEl, 160); // tags-only popup ~160px wide
      } else {
        _anchored = false;
      }
    },
    hide() {
      if (_previewEl) {
        _previewEl.style.display = 'none';
        _previewEl.classList.remove('dual');
      }
      if (_previewImg) _previewImg.style.display = '';
      if (_previewImgBack) _previewImgBack.style.display = '';
      if (_previewTags) _previewTags.style.display = 'none';
      _anchored = false;
    },
    setLocked(val) {
      _locked = val;
      if (val && _previewEl) {
        _previewEl.style.display = 'none';
        _previewEl.classList.remove('dual');
      }
    },
  };

  // Follow cursor unless pinned to a pile card.
  document.addEventListener('mousemove', e => {
    if (!_previewEl || _previewEl.style.display === 'none' || _anchored) return;
    const w = _previewEl.offsetWidth || 220;
    const h = _previewEl.offsetHeight || 310;
    const x = Math.min(e.clientX + 20, window.innerWidth - w - 10);
    const y = Math.max(10, Math.min(e.clientY - 50, window.innerHeight - h - 10));
    _previewEl.style.left = x + 'px';
    _previewEl.style.top  = y + 'px';
  });
}

// ─── Card Pile In-Place Expansion ─────────────────────────────────────────────
// Shows the full card image anchored at the hovered strip's position.
// pointer-events:none lets mouse events pass through to cards underneath.
{
  const _overlay = document.createElement('div');
  _overlay.id = 'card-pile-overlay';
  const _overlayImg = document.createElement('img');
  _overlay.appendChild(_overlayImg);
  document.body.appendChild(_overlay);

  window.__pileCard = {
    show(imageUrl, el) {
      if (!imageUrl || !el) return;
      const rect = el.getBoundingClientRect();
      _overlayImg.src = imageUrl;
      _overlay.style.left  = rect.left + 'px';
      _overlay.style.top   = rect.top + 'px';
      _overlay.style.width = rect.width + 'px';
      _overlay.style.display = 'block';
    },
    hide() {
      _overlay.style.display = 'none';
    },
  };

  // Dismiss on scroll so the fixed overlay doesn't drift from the card.
  document.addEventListener('scroll', () => {
    window.__pileCard.hide();
    window.__preview?.hide();
  }, { capture: true, passive: true });
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────

window.__tab = function(tab) {
  activeTab = tab;
  editingDef = null;
  refresh();
};

// ─── Results View Toggle ──────────────────────────────────────────────────────

window.__res = {
  setView(v) { resultView = v; refresh(); },
  setSort(s) { resultSort = s; refresh(); },
};

// ─── Overview Type Group Toggle ───────────────────────────────────────────────


window.__ovr = {
  // Exclusive accordion: open one section at a time; clicking the open one closes it.
  toggle(label) {
    const wasOpen = expandedTypeGroups.has(label);
    expandedTypeGroups.clear();
    if (!wasOpen) expandedTypeGroups.add(label);
    refresh();
  },
  // Switch between 'types' and 'tags' grouping in the card browser.
  setView(view) {
    cardBrowserView = view;
    expandedTypeGroups.clear();
    refresh();
  },
  // Switch card sort order within groups.
  setSort(sort) {
    cardBrowserSort = sort;
    refresh();
  },
};



// ─── Sample Good Hands Popup ──────────────────────────────────────────────────

// Type priority for sorting cards in sample hand display (index = sort key)
const HAND_TYPE_PRIORITY = ['Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'MDFC', 'Other', 'Land'];

function handCardPrimaryType(card) {
  if (!Array.isArray(card.types)) return 'Other';
  for (const t of HAND_TYPE_PRIORITY) {
    if (card.types.includes(t)) return t;
  }
  return 'Other';
}

window.__hands = {
  show(rawHands) {
    const sampleGoodHands = rawHands ?? window.__currentSampleHands ?? [];
    if (!sampleGoodHands.length) return;
    document.querySelector('.hands-modal-overlay')?.remove();

    const handsHTML = sampleGoodHands.map((hand, i) => {
      const sorted = [...hand].sort((a, b) =>
        HAND_TYPE_PRIORITY.indexOf(handCardPrimaryType(a)) - HAND_TYPE_PRIORITY.indexOf(handCardPrimaryType(b))
      );
      const cardsHTML = sorted.map(card => {
        const imgAttr  = card.imageUrl     ? `data-image-url="${card.imageUrl.replace(/"/g, '&quot;')}"` : '';
        const backAttr = card.backImageUrl ? `data-back-image-url="${card.backImageUrl.replace(/"/g, '&quot;')}"` : '';
        const cardType  = handCardPrimaryType(card);
        const typeColor = TYPE_COLORS[cardType] || TYPE_COLORS.Other;
        const safeName  = card.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<div class="card-row card-row--clickable" style="padding:4px 8px"
          ${imgAttr} ${backAttr}
          onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
          onmouseleave="window.__preview?.hide()">
          <span class="legend-dot" style="background:${typeColor};flex-shrink:0"></span>
          <span class="card-row-name">${safeName}</span>
        </div>`;
      }).join('');
      return `<div class="hand-column">
        <div class="hand-column-header">Hand ${i + 1}</div>
        ${cardsHTML}
      </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'hands-modal-overlay';
    overlay.innerHTML = `
      <div class="hands-modal">
        <div class="hands-modal-header">
          <span>Sample Good Opening Hands</span>
          <button class="btn-icon" onclick="this.closest('.hands-modal-overlay').remove()">✕</button>
        </div>
        <div class="hands-modal-body">${handsHTML}</div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },
};

// ─── Deck Rename ──────────────────────────────────────────────────────────────

// ─── Calculate Tab ────────────────────────────────────────────────────────────

/** Show a card-list popup modal (type-sorted, with hover preview). */
function showCardListModal(title, cards) {
  document.querySelector('.calc-card-modal-overlay')?.remove();
  if (!cards.length) return;

  const HAND_TYPE_PRIORITY_CALC = ['Land', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'MDFC', 'Other'];

  // Group by primary type
  const groups = {};
  for (const card of cards) {
    const type = HAND_TYPE_PRIORITY_CALC.find(t => card.types?.includes(t)) || 'Other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(card);
  }

  const groupsHTML = HAND_TYPE_PRIORITY_CALC
    .filter(t => groups[t])
    .map(t => {
      const color = TYPE_COLORS[t] || TYPE_COLORS.Other;
      const rowsHTML = groups[t].map(card => {
        const imgAttr  = card.imageUrl     ? `data-image-url="${card.imageUrl.replace(/"/g, '&quot;')}"` : '';
        const backAttr = card.backImageUrl ? `data-back-image-url="${card.backImageUrl.replace(/"/g, '&quot;')}"` : '';
        return `<div class="card-row card-row--clickable" style="padding:4px 8px"
          ${imgAttr} ${backAttr}
          onmouseenter="window.__preview?.show(this.dataset.imageUrl, this.dataset.backImageUrl)"
          onmouseleave="window.__preview?.hide()">
          <span class="legend-dot" style="background:${color};flex-shrink:0"></span>
          <span class="card-row-name">${card.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>
        </div>`;
      }).join('');
      return `<div class="hand-column">
        <div class="hand-column-header" style="color:${color}">${t} (${groups[t].length})</div>
        ${rowsHTML}
      </div>`;
    }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'calc-card-modal-overlay hands-modal-overlay';
  overlay.innerHTML = `
    <div class="hands-modal">
      <div class="hands-modal-header">
        <span>${title} (${cards.length})</span>
        <button class="btn-icon" onclick="this.closest('.calc-card-modal-overlay').remove()">✕</button>
      </div>
      <div class="hands-modal-body">${groupsHTML}</div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

const CALC_CRIT_TYPES_COMBINED = ['types_and_tags', 'types_and_tags_at_mv'];

function _calcGetDef(defId) {
  return getDeckById(activeDeckId)?.effectDefs?.find(d => d.id === defId) ?? null;
}

function _calcSaveAndRefresh(defId) {
  const deck = getDeckById(activeDeckId);
  const def  = deck?.effectDefs?.find(d => d.id === defId);
  if (!deck || !def) return;
  updateEffectDef(deck.id, def);
  refresh();
}

function _calcUpdateCombinedSummary(defId, critIdx) {
  const row     = document.querySelector(`[data-calc-def-id="${defId}"][data-calc-crit-idx="${critIdx}"]`);
  const details = row?.querySelector('details[data-ms-type="combined"]');
  if (!details) return;
  const getText = el => el.closest('.ms-item')?.querySelector('span')?.textContent?.trim();
  const checkedTypes = [...details.querySelectorAll('.ms-item[data-group="type"] input:checked')].map(getText).filter(Boolean);
  const checkedTags  = [...details.querySelectorAll('.ms-item[data-group="tag"]  input:checked')].map(getText).filter(Boolean);
  const parts = [];
  if (checkedTypes.length) parts.push(checkedTypes.join('/'));
  if (checkedTags.length)  parts.push(checkedTags.join('/'));
  const sumEl = details.querySelector('.crit-ms-toggle');
  if (sumEl) sumEl.textContent = parts.length ? parts.join(' & ') : '(Any Card)';
}

function _calcUpdateMsSummary(defId, critIdx, fieldKey, placeholder) {
  const row     = document.querySelector(`[data-calc-def-id="${defId}"][data-calc-crit-idx="${critIdx}"]`);
  const details = row?.querySelector(`[data-ms-key="${fieldKey}"]`)?.closest('details');
  if (!details) return;
  const checked = [...details.querySelectorAll('.ms-item input:checked')]
    .map(el => el.closest('.ms-item')?.querySelector('span')?.textContent?.trim()).filter(Boolean);
  const sumEl = details.querySelector('.crit-ms-toggle');
  if (sumEl) sumEl.textContent = checked.length ? checked.join('/') : placeholder;
}

function _calcUpdateGraphsInDom(defId) {
  const deck = getDeckById(activeDeckId);
  const def  = deck?.effectDefs?.find(d => d.id === defId);
  if (!def) return;
  const K       = matchingCardsForEffect(deck, def.criteria || []).reduce((s, c) => s + c.quantity, 0);
  const lookAtN = def.lookAtN  || 3;
  const hitTarget = Math.min(def.hitTarget || 1, lookAtN);

  const graphsEl = document.getElementById(`calc-graphs-${defId}`);
  if (graphsEl) {
    graphsEl.innerHTML = buildNSensGraph(lookAtN, hitTarget, K) + buildSrcSensGraph(lookAtN, hitTarget, K);
  }

  // Update hit-list button text
  const hitBtn = document.querySelector(`[data-hitlist-btn="${defId}"]`);
  if (hitBtn) hitBtn.textContent = `Show all ${K} hits`;

  const section = document.querySelector(`details[data-def-id="${defId}"]`);

  // Update summary K= badge
  const summarySpans = section?.querySelectorAll('.calc-effect-summary .muted');
  if (summarySpans?.length) {
    summarySpans[summarySpans.length - 1].textContent = `top ${lookAtN} · K=${K}`;
  }

  // Update summary pct chip
  const canCalc = K > 0 && hitTarget <= K && hitTarget <= lookAtN;
  const currentPct = canCalc ? Math.round(hypgeomAtLeast(hitTarget, 99, K, lookAtN) * 100) : 0;
  const pctClass = K === 0 ? 'def-pct--none'
    : currentPct >= 60 ? 'def-pct--good'
    : currentPct >= 40 ? 'def-pct--warn' : 'def-pct--bad';
  const pctChip = section?.querySelector('.calc-effect-summary .def-pct');
  if (pctChip) {
    pctChip.textContent = K > 0 ? currentPct + '%' : '—';
    pctChip.className = `def-pct ${pctClass}`;
  }
}

window.__calc = {
  // ── Legacy (kept for backward compat) ──────────────────────────────────────
  setN(n)      { setLabN(n);      refresh(); },
  setTarget(t) { setLabTarget(t); refresh(); },

  // ── Sub-tab ────────────────────────────────────────────────────────────────
  setSubTab(tab) { setActiveSubTab(tab); refresh(); },

  // ── Effect open/close tracking ─────────────────────────────────────────────
  onEffectToggle(id, open) { setEffectOpen(id, open); },

  // ── Effect CRUD ────────────────────────────────────────────────────────────
  addEffect() {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    const id = generateId();
    updateEffectDef(deck.id, { id, name: '', lookAtN: 3, hitTarget: 1, criteria: [] });
    setEffectOpen(id, true);
    refresh();
  },

  removeEffect(defId) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    showConfirmModal('Remove this effect?', () => {
      removeEffectDef(deck.id, defId);
      refresh();
    }, { title: 'Remove Effect', confirmLabel: 'Remove', danger: true });
  },

  // ── N stepper ──────────────────────────────────────────────────────────────
  incrementN(defId) {
    const def = _calcGetDef(defId);
    if (!def) return;
    def.lookAtN = Math.min(99, (def.lookAtN || 3) + 1);
    def.hitTarget = Math.min(def.hitTarget || 1, def.lookAtN);
    _calcSaveAndRefresh(defId);
  },

  decrementN(defId) {
    const def = _calcGetDef(defId);
    if (!def) return;
    def.lookAtN = Math.max(1, (def.lookAtN || 3) - 1);
    def.hitTarget = Math.min(def.hitTarget || 1, def.lookAtN);
    _calcSaveAndRefresh(defId);
  },

  setHitTarget(defId, n) {
    const def = _calcGetDef(defId);
    if (!def) return;
    def.hitTarget = n;
    _calcSaveAndRefresh(defId);
  },

  setEffectName(defId, val) {
    const def = _calcGetDef(defId);
    if (def) def.name = val;
    // Save to storage without re-render (name input already reflects it)
    const deck = getDeckById(activeDeckId);
    if (deck && def) updateEffectDef(deck.id, def);
  },

  // ── Criteria CRUD ──────────────────────────────────────────────────────────
  addCrit(defId) {
    const def = _calcGetDef(defId);
    if (!def) return;
    const first = CRITERION_TYPE_OPTIONS[0];
    def.criteria = [...(def.criteria || []), { type: first.id, ...first.defaultValues() }];
    _calcSaveAndRefresh(defId);
  },

  removeCrit(defId, idx) {
    const def = _calcGetDef(defId);
    if (!def) return;
    def.criteria = (def.criteria || []).filter((_, i) => i !== idx);
    _calcSaveAndRefresh(defId);
  },

  changeCritType(defId, idx, type) {
    const def = _calcGetDef(defId);
    if (!def) return;
    const typeInfo = CRITERION_TYPES[type];
    if (!typeInfo) return;
    def.criteria[idx] = { type, ...typeInfo.defaultValues() };
    _calcSaveAndRefresh(defId);
  },

  // ── Criteria value toggles (targeted DOM update, no full refresh) ───────────
  toggleType(defId, idx, typeName, fieldKey = 'cardTypes') {
    const def = _calcGetDef(defId);
    if (!def?.criteria?.[idx]) return;
    const current = def.criteria[idx][fieldKey] || [];
    def.criteria[idx][fieldKey] = current.includes(typeName)
      ? current.filter(t => t !== typeName) : [...current, typeName];
    const deck = getDeckById(activeDeckId);
    if (deck) updateEffectDef(deck.id, def);
    if (CALC_CRIT_TYPES_COMBINED.includes(def.criteria[idx].type)) {
      _calcUpdateCombinedSummary(defId, idx);
    } else {
      _calcUpdateMsSummary(defId, idx, fieldKey, '(Any Card)');
    }
    _calcUpdateGraphsInDom(defId);
  },

  toggleMv(defId, idx, mv) {
    const def = _calcGetDef(defId);
    if (!def?.criteria?.[idx]) return;
    const current = def.criteria[idx].mvValues || [];
    def.criteria[idx].mvValues = current.includes(mv)
      ? current.filter(v => v !== mv) : [...current, mv];
    const deck = getDeckById(activeDeckId);
    if (deck) updateEffectDef(deck.id, def);
    _calcUpdateMsSummary(defId, idx, 'mvValues', '(Any MV)');
    _calcUpdateGraphsInDom(defId);
  },

  toggleSubtype(defId, idx, subtype) {
    const def = _calcGetDef(defId);
    if (!def?.criteria?.[idx]) return;
    const current = def.criteria[idx].subtypes || [];
    def.criteria[idx].subtypes = current.includes(subtype)
      ? current.filter(s => s !== subtype) : [...current, subtype];
    const deck = getDeckById(activeDeckId);
    if (deck) updateEffectDef(deck.id, def);
    _calcUpdateMsSummary(defId, idx, 'subtypes', '(Any Subtype)');
    _calcUpdateGraphsInDom(defId);
  },

  toggleTag(defId, idx, tagName) {
    const def = _calcGetDef(defId);
    if (!def?.criteria?.[idx]) return;
    const current = def.criteria[idx].tagNames || [];
    def.criteria[idx].tagNames = current.includes(tagName)
      ? current.filter(t => t !== tagName) : [...current, tagName];
    const deck = getDeckById(activeDeckId);
    if (deck) updateEffectDef(deck.id, def);
    if (CALC_CRIT_TYPES_COMBINED.includes(def.criteria[idx].type)) {
      _calcUpdateCombinedSummary(defId, idx);
    } else {
      _calcUpdateMsSummary(defId, idx, 'tagNames', '(Any Card)');
    }
    _calcUpdateGraphsInDom(defId);
  },

  toggleCard(defId, idx, cardName) {
    const def = _calcGetDef(defId);
    if (!def?.criteria?.[idx]) return;
    const current = def.criteria[idx].cardNames || [];
    def.criteria[idx].cardNames = current.includes(cardName)
      ? current.filter(n => n !== cardName) : [...current, cardName];
    const deck = getDeckById(activeDeckId);
    if (deck) updateEffectDef(deck.id, def);
    const selected = def.criteria[idx].cardNames;
    _calcUpdateMsSummary(defId, idx, 'cardNames', '(select card…)');
    _calcUpdateGraphsInDom(defId);
  },

  // ── Sample / Hit-list modals ───────────────────────────────────────────────
  showHitList(defId) {
    const deck = getDeckById(activeDeckId);
    const def  = deck?.effectDefs?.find(d => d.id === defId);
    if (!def) return;
    const cards = matchingCardsForEffect(deck, def.criteria || []);
    if (!cards.length) { showToast('No cards match all criteria.', 'info'); return; }
    showCardListModal(`${def.name || 'Effect'} — Matching Cards`, cards);
  },

  showCritSample(defId, critIdx) {
    const deck = getDeckById(activeDeckId);
    const def  = deck?.effectDefs?.find(d => d.id === defId);
    if (!def?.criteria?.[critIdx]) return;
    const cards = matchingCardsForCriterion(deck, def.criteria[critIdx]);
    if (!cards.length) { showToast('No cards match this criterion.', 'info'); return; }
    showCardListModal('Sample — Criterion Matches', cards);
  },
};

window.__deck = {
  rename() {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    showPromptModal('New deck name:', deck.name, (newName) => {
      renameDeck(deck.id, newName);
      refresh();
    }, { title: 'Rename Deck' });
  },
};

// ─── Simulation ───────────────────────────────────────────────────────────────

const SIM_GAME_COUNT = 100000;

function handleRunSimulation(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  const btn = document.getElementById('run-sim-btn');
  if (btn) { btn.disabled = true; btn.textContent = '· Running…'; }

  // Defer to next tick so the UI updates before the loop
  setTimeout(() => {
    try {
      if (!deck.goodHandDefs?.length) {
        updateDeckGoodHandDefs(deck.id, {
          id: generateId(),
          name: 'Keepable Hand',
          criteria: [{ type: 'at_least_type', count: 3, cardType: 'Land' }],
        });
      }
      const goodHandDefs = deck.goodHandDefs || [];
      const results = runSimulation(deck, SIM_GAME_COUNT, goodHandDefs);
      results.goodHandDefNames = Object.fromEntries(
        goodHandDefs.map(d => [d.id, d.name])
      );
      window.__currentSampleHands = results.sampleGoodHands || [];
      addResults(results);
      refresh();
      showToast(`Simulated ${SIM_GAME_COUNT.toLocaleString()} opening hands`, 'success');
    } catch (err) {
      showToast(`Simulation error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run Simulation'; }
    }
  }, 20);
}


// ─── Save / Load ──────────────────────────────────────────────────────────────

function bindSaveLoad() {
  document.getElementById('save-btn')?.addEventListener('click', () => {
    try {
      saveToFile();
      showToast('Save file downloaded.', 'success');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  });

  const loadInput = document.getElementById('load-input');
  document.getElementById('load-btn')?.addEventListener('click', () => {
    loadInput?.click();
  });

  loadInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { decks: decksLoaded, results: resultsLoaded, warnings } = await loadFromFile(file);
      warnings?.forEach(w => showToast(w, 'warn'));
      showToast(`Loaded ${decksLoaded} deck(s), ${resultsLoaded} result(s).`, 'success');

      // Select first loaded deck
      const decks = (await import('./storage.js')).getDecks();
      if (decks.length > 0 && !activeDeckId) {
        activeDeckId = decks[0].id;
      }
      refresh();
    } catch (err) {
      showToast(`Load failed: ${err.message}`, 'error');
    }

    // Reset input so same file can be loaded again
    e.target.value = '';
  });
}
