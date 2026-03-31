/**
 * mullstat - App Entry Point
 *
 * Wires together: parser → storage → simulator → ui
 * Handles all user events.
 */

import { parseMoxfieldDecklist, parseMoxfieldApiResponse } from './parser.js';
import { runSimulation, flattenDeck } from './simulator.js';
import {
  addDeck, removeDeck, addResults,
  getDeckById, saveToFile, loadFromFile,
  updateDeckGoodHandDefs, removeGoodHandDef,
  updateDeckDiscardPriorities,
  renameDeck,
  clearResultsForDeck,
} from './storage.js';
import {
  renderDeckList, renderActiveDeck, showToast,
  setImportLoading, TYPE_COLORS,
} from './ui.js';
import { generateId } from './types.js';
import { CRITERION_TYPES, evaluateGoodHandDef } from './criteria.js';
import { enrichDeckWithScryfall } from './enrichment.js';
import { mapTagsToCategories } from './tagger.js';
import { CATEGORY_TAG_SUBTYPE } from './ui/cards-tab.js';
import {
  addCategory, removeCategory, renameCategory, setCategoryColor,
  setOtagMapping, removeOtagMapping, resetCategoryConfig,
  getEffectiveCategoryNames, getEffectiveOtagMappings,
  exportCategoryConfig, importCategoryConfig,
} from './category-config.js';

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

/** Type names currently expanded in the Card Tags tab type list. */
const expandedTypeGroups = new Set();

/** Card names currently expanded in the Card Tags tab detail view. */
const expandedCards = new Set();

/** Whether the Category Config <details> panel is open in the Card Tags tab. */
let categoryConfigOpen = false;

/** Current otag search filter (persisted across refresh so type-group toggle doesn't clear it). */
let otagSearchQuery = '';

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

// ─── Category Helpers ─────────────────────────────────────────────────────────

/** Re-derive categories for every card in the active deck from current otag mappings. */
function rederiveAllCardCategories() {
  const deck = getDeckById(activeDeckId);
  if (!deck) return;
  const otagMap = getEffectiveOtagMappings();
  for (const card of deck.cards) {
    card.categories = mapTagsToCategories(card.otags || [], card.keywords ?? [], card.oracleText, otagMap);
  }
  clearResultsForDeck(deck.id);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindImportPanel();
  bindSaveLoad();
  bindCategoryConfig();
  refresh();

  // Close card multiselect dropdowns when clicking outside them
  document.addEventListener('click', e => {
    if (!e.target.closest('.card-multiselect-dropdown')) {
      document.querySelectorAll('.card-multiselect-dropdown[open]').forEach(el => el.removeAttribute('open'));
    }
  });
});

// ─── Refresh (re-render everything from state) ────────────────────────────────

function refresh() {
  renderDeckList(handleSelectDeck, handleDeleteDeck);
  renderActiveDeck(getDeckById(activeDeckId), handleRunSimulation, editingDef, activeTab, expandedTypeGroups, expandedCards, categoryConfigOpen);
  // Restore otag search filter after re-render
  if (otagSearchQuery && activeTab === 'cards') {
    const input = document.getElementById('cat-otag-search');
    if (input) input.value = otagSearchQuery;
    window.__catcfg?.searchOtags(otagSearchQuery);
  }
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

const MOXFIELD_URL_RE = /moxfield\.com\/decks\/([\w-]+)/i;

// Moxfield's API doesn't set CORS headers, so browsers block direct fetches.
// corsproxy.io proxies the request server-side and adds CORS headers for us.
// Swap this constant if a self-hosted proxy is added later.
const CORS_PROXY = 'https://corsproxy.io/?url=';

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
        console.log(`[mullstat] Moxfield: parsed ${deck.cards.length} unique cards (${mainboardEntries.reduce((s, e) => s + (e.quantity || 1), 0)} total)`);

        errors.forEach(e => showToast(e, 'warn'));

        if (deck.cards.length === 0) {
          showToast('Could not parse any cards from Moxfield.', 'error');
          return;
        }

        // Enrich with Scryfall data
        importBtn.textContent = '· Enriching…';
        setImportLoading(true, 'Fetching card data from Scryfall…');
        let deckToSave = deck;
        try {
          deckToSave = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg), msg => showToast(msg, 'warn'));
        } catch (enrichErr) {
          showToast(`Scryfall enrichment failed: ${enrichErr.message}`, 'warn');
        }
        setImportLoading(false);

        logEnrichedDeck(deckToSave);
        addDeck(deckToSave);
        activeDeckId = deckToSave.id;
        clearImportPanel();
        showToast(`Imported "${deckToSave.name}" — ${deckToSave.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();
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

      // Enrich with Scryfall data
      importBtn.disabled = true;
      importBtn.textContent = '· Enriching…';
      setImportLoading(true, 'Fetching card data from Scryfall…');
      try {
        const enriched = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg), msg => showToast(msg, 'warn'));
        setImportLoading(false);

        logEnrichedDeck(enriched);
        addDeck(enriched);
        activeDeckId = enriched.id;
        clearImportPanel();
        showToast(`Imported "${enriched.name}" — ${enriched.cards.reduce((s,c)=>s+c.quantity,0)} cards`, 'success');
        refresh();
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

function freshCriterion() {
  const firstType = Object.values(CRITERION_TYPES)[0];
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
        ? [{ type: 'at_least_type', count: 2, cardType: 'Land' }]
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
  },

  /** Toggle a type in/out of a criterion's cardTypes array and re-render. */
  toggleType(idx, typeName) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].cardTypes || [];
    editingDef.criteria[idx].cardTypes = current.includes(typeName)
      ? current.filter(t => t !== typeName)
      : [...current, typeName];
    refresh();
  },

  /** Toggle a card name in/out of a criterion's cardNames array. */
  toggleCard(idx, cardName) {
    if (!editingDef?.criteria[idx]) return;
    const current = editingDef.criteria[idx].cardNames || [];
    editingDef.criteria[idx].cardNames = current.includes(cardName)
      ? current.filter(n => n !== cardName)
      : [...current, cardName];
    // Update the dropdown summary text without a full re-render
    const count = editingDef.criteria[idx].cardNames.length;
    const summary = document.querySelector(`[data-crit-idx="${idx}"] .card-multiselect-toggle`);
    if (summary) {
      summary.textContent = count > 0
        ? `${count} card${count !== 1 ? 's' : ''} selected`
        : 'Select cards…';
    }
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

  add() {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    if (!Array.isArray(deck.discardPriorities)) deck.discardPriorities = [];
    deck.discardPriorities.push({ id: generateId(), modifier: 'highest_cmc', cardType: 'Any' });
    updateDeckDiscardPriorities(deck.id, deck.discardPriorities);
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


// ─── Category Actions ─────────────────────────────────────────────────────────

window.__cat = {
  /** Add a canonical category to a card. */
  add(cardName, category) {
    if (!category) return;
    const card = getCardByName(cardName);
    if (!card) return;
    if (!Array.isArray(card.categories)) card.categories = [];
    if (!card.categories.includes(category)) {
      card.categories.push(category);
      refresh();
    }
  },

  /** Remove a canonical category from a card. */
  remove(cardName, category) {
    const card = getCardByName(cardName);
    if (!card?.categories) return;
    card.categories = card.categories.filter(c => c !== category);
    refresh();
  },
};

/** Find the card object in the active deck by name. */
function getCardByName(cardName) {
  const deck = getDeckById(activeDeckId);
  return deck?.cards.find(c => c.name === cardName) ?? null;
}

// ─── Category Value Actions ───────────────────────────────────────────────────

window.__catval = {
  /** Set the numeric value for a value-bearing category on a card (no refresh needed). */
  set(cardName, category, value) {
    const card = getCardByName(cardName);
    if (!card) return;
    card.categoryValues = card.categoryValues ?? {};
    card.categoryValues[category] = Number(value);
    // Also sync to the matching effectTag so pill labels update
    const subtype = CATEGORY_TAG_SUBTYPE[category];
    if (subtype && card.effectTags) {
      const tag = card.effectTags.find(t => t.subtype === subtype);
      if (tag) tag.value = Number(value);
    }
  },
};

// ─── Card Image Preview ───────────────────────────────────────────────────────

{
  const _previewEl      = document.getElementById('card-image-preview');
  const _previewImg     = document.getElementById('card-image-preview-img');
  const _previewImgBack = document.getElementById('card-image-preview-img-back');

  let _locked = false;
  window.__preview = {
    show(imageUrl, backImageUrl) {
      if (_locked || !imageUrl || !_previewEl || !_previewImg) return;
      _previewImg.src = imageUrl;
      if (backImageUrl && _previewImgBack) {
        _previewImgBack.src = backImageUrl;
        _previewEl.classList.add('dual');
      } else {
        if (_previewImgBack) _previewImgBack.src = '';
        _previewEl.classList.remove('dual');
      }
      _previewEl.style.display = backImageUrl ? 'flex' : 'block';
    },
    hide() {
      if (_previewEl) {
        _previewEl.style.display = 'none';
        _previewEl.classList.remove('dual');
      }
    },
    setLocked(val) {
      _locked = val;
      if (val && _previewEl) {
        _previewEl.style.display = 'none';
        _previewEl.classList.remove('dual');
      }
    },
  };

  document.addEventListener('mousemove', e => {
    if (!_previewEl || _previewEl.style.display === 'none') return;
    const w = _previewEl.offsetWidth || 220;
    const h = _previewEl.offsetHeight || 310;
    const x = Math.min(e.clientX + 20, window.innerWidth - w - 10);
    const y = Math.max(10, Math.min(e.clientY - 50, window.innerHeight - h - 10));
    _previewEl.style.left = x + 'px';
    _previewEl.style.top  = y + 'px';
  });
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────

window.__tab = function(tab) {
  activeTab = tab;
  editingDef = null;
  refresh();
};

// ─── Overview Type Group Toggle ───────────────────────────────────────────────


window.__ovr = {
  // Exclusive accordion: open one section at a time; clicking the open one closes it.
  toggle(type) {
    const wasOpen = expandedTypeGroups.has(type);
    expandedTypeGroups.clear();
    if (!wasOpen) expandedTypeGroups.add(type);
    refresh();
  },
  toggleCard(cardName) {
    const wasOpen = expandedCards.has(cardName);
    expandedCards.clear();
    if (!wasOpen) expandedCards.add(cardName);
    refresh();
  },
};

// ─── Card Otag Actions ────────────────────────────────────────────────────────

window.__cardotag = {
  /** Remove an otag slug from a specific card's otag list and re-derive categories. */
  remove(cardName, slug) {
    const card = getCardByName(cardName);
    if (!card) return;
    card.otags = (card.otags || []).filter(s => s !== slug);
    card.categories = mapTagsToCategories(card.otags, card.keywords ?? [], card.oracleText);
    refresh();
  },

  /** Add an otag slug to a specific card's otag list and re-derive categories. */
  add(cardName, slug) {
    const card = getCardByName(cardName);
    if (!card || !slug) return;
    if (!Array.isArray(card.otags)) card.otags = [];
    if (!card.otags.includes(slug)) {
      card.otags.push(slug);
      card.categories = mapTagsToCategories(card.otags, card.keywords ?? [], card.oracleText);
      refresh();
    }
  },

  /** Map an unmapped otag slug to a category globally, then refresh. */
  mapGlobal(slug, catName) {
    if (!slug || !catName) return;
    window.__catcfg.addOtagDirect(slug, catName);
  },
};

// ─── Category Config ──────────────────────────────────────────────────────────

window.__catcfg = {
  /** Called by the <details ontoggle> to persist open state across refresh(). */
  _setOpen(val) { categoryConfigOpen = val; },

  _dragSlug: null,
  _menuEl: null,

  addCategory() {
    const nameEl  = document.getElementById('new-cat-name');
    const colorEl = document.getElementById('new-cat-color');
    if (!nameEl?.value.trim()) return;
    addCategory(nameEl.value.trim(), colorEl?.value || '#94a3b8');
    nameEl.value = '';
    categoryConfigOpen = true; // keep the editor open after adding
    refresh();
  },
  removeCategory(name) {
    showConfirmModal(`Remove category "<strong>${name}</strong>"? This will unassign it from all cards.`, () => {
      removeCategory(name);
      rederiveAllCardCategories();
      refresh();
    }, { title: 'Remove Category', confirmLabel: 'Remove', danger: true });
  },
  rename(oldName, newName) {
    if (newName && newName !== oldName) { renameCategory(oldName, newName); refresh(); }
  },
  setColor(name, color) { setCategoryColor(name, color); refresh(); },
  addOtag() {
    const slugEl = document.getElementById('new-otag-slug');
    const catEl  = document.getElementById('new-otag-cat');
    if (!slugEl?.value.trim() || !catEl?.value) return;
    setOtagMapping(slugEl.value.trim(), catEl.value);
    rederiveAllCardCategories();
    slugEl.value = '';
    categoryConfigOpen = true; // keep the editor open after adding
    refresh();
  },
  setOtag(slug, catName) { setOtagMapping(slug, catName || null); rederiveAllCardCategories(); refresh(); },
  removeOtag(slug) { removeOtagMapping(slug); rederiveAllCardCategories(); refresh(); },
  addOtagDirect(slug, catName) { setOtagMapping(slug, catName); rederiveAllCardCategories(); categoryConfigOpen = true; refresh(); },
  reset() {
    showConfirmModal('Reset all category config to defaults? This cannot be undone.', () => {
      resetCategoryConfig();
      rederiveAllCardCategories();
      refresh();
    }, { title: 'Reset Config', confirmLabel: 'Reset', danger: true });
  },

  otagDragStart(event, slug) {
    this._dragSlug = slug;
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  },

  otagDrop(event, catName) {
    event.preventDefault();
    // Clear ALL drag-over highlights
    document.querySelectorAll('.cat-column.drag-over').forEach(el => el.classList.remove('drag-over'));
    const slug = this._dragSlug;
    this._dragSlug = null;
    if (!slug || !catName) return;
    setOtagMapping(slug, catName);
    rederiveAllCardCategories();
    categoryConfigOpen = true;
    refresh();
  },

  showOtagMenu(event, slug, currentCat) {
    event.stopPropagation();
    this._closeMenu();
    const cats = getEffectiveCategoryNames();

    const menu = document.createElement('div');
    menu.className = 'otag-context-menu';

    // Category options
    for (const cat of cats) {
      const item = document.createElement('div');
      item.className = 'otag-context-item' + (cat === currentCat ? ' otag-context-item--active' : '');
      item.textContent = (cat === currentCat ? '✓ ' : '') + cat;
      item.addEventListener('click', () => {
        this._closeMenu();
        setOtagMapping(slug, cat);
        rederiveAllCardCategories();
        categoryConfigOpen = true;
        refresh();
      });
      menu.appendChild(item);
    }

    if (currentCat) {
      const sep = document.createElement('div');
      sep.className = 'otag-context-separator';
      menu.appendChild(sep);

      const unmap = document.createElement('div');
      unmap.className = 'otag-context-item otag-context-item--danger';
      unmap.textContent = 'Unmap';
      unmap.addEventListener('click', () => {
        this._closeMenu();
        removeOtagMapping(slug);
        rederiveAllCardCategories();
        categoryConfigOpen = true;
        refresh();
      });
      menu.appendChild(unmap);
    }

    document.body.appendChild(menu);
    this._menuEl = menu;

    // Position below the clicked element
    const rect = event.currentTarget.getBoundingClientRect();
    const mw = 160;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';

    // Close on outside click
    const close = (e) => {
      if (!menu.contains(e.target)) {
        this._closeMenu();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  },

  _closeMenu() {
    this._menuEl?.remove();
    this._menuEl = null;
  },

  searchOtags(query) {
    otagSearchQuery = query;
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.otag-pill-item').forEach(el => {
      const slug = el.dataset.slug || el.textContent.trim();
      el.style.display = (q && !slug.toLowerCase().includes(q)) ? 'none' : '';
    });
  },

  exportConfig() {
    try {
      const json = exportCategoryConfig();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mullstat-categories.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Category config exported', 'success');
    } catch (err) {
      showToast(`Export failed: ${err.message}`, 'error');
    }
  },

  importConfig() {
    let input = document.getElementById('cat-import-input-cc');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.display = 'none';
      input.id = 'cat-import-input-cc';
      document.body.appendChild(input);
      input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          importCategoryConfig(text);
          rederiveAllCardCategories();
          categoryConfigOpen = true;
          refresh();
          showToast('Category config imported', 'success');
        } catch (err) {
          showToast(`Import failed: ${err.message}`, 'error');
        }
        input.value = '';
      });
    }
    input.click();
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
      const goodHandDefs = deck.goodHandDefs || [];
      const results = runSimulation(deck, SIM_GAME_COUNT, goodHandDefs);
      results.goodHandDefNames = Object.fromEntries(
        goodHandDefs.map(d => [d.id, d.name])
      );
      window.__currentSampleHands = results.sampleGoodHands || [];
      addResults(results);
      activeTab = 'results';
      refresh();
      showToast(`Simulated ${SIM_GAME_COUNT.toLocaleString()} opening hands`, 'success');
    } catch (err) {
      showToast(`Simulation error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run Simulation'; }
    }
  }, 20);
}

// ─── Category Config Save/Load ────────────────────────────────────────────────

function bindCategoryConfig() {
  document.getElementById('cat-export-btn')?.addEventListener('click', () => {
    try {
      const json = exportCategoryConfig();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mullstat-categories.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Category config exported', 'success');
    } catch (err) {
      showToast(`Export failed: ${err.message}`, 'error');
    }
  });

  const catImportBtn = document.getElementById('cat-import-btn');
  const catImportInput = document.getElementById('cat-import-input');

  catImportBtn?.addEventListener('click', () => catImportInput?.click());

  catImportInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importCategoryConfig(text);
      rederiveAllCardCategories();
      categoryConfigOpen = true;
      refresh();
      showToast('Category config imported successfully', 'success');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
    e.target.value = '';
  });
}

// ─── Category Cards Popup ─────────────────────────────────────────────────────

window.__dash = {
  showCategoryCards(catName) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    const TYPE_ORDER = ['Creature','Sorcery','Instant','Artifact','Enchantment','Land','Planeswalker','Battle','MDFC','Other'];
    const matchingCards = deck.cards.filter(c => (c.categories || []).includes(catName));
    if (!matchingCards.length) {
      showToast(`No cards in "${catName}"`, 'info');
      return;
    }

    // Sort by primary type (same order as cards tab)
    matchingCards.sort((a, b) => {
      const ai = TYPE_ORDER.findIndex(t => a.types?.includes(t));
      const bi = TYPE_ORDER.findIndex(t => b.types?.includes(t));
      const order = (ai === -1 ? TYPE_ORDER.length : ai) - (bi === -1 ? TYPE_ORDER.length : bi);
      return order !== 0 ? order : a.name.localeCompare(b.name);
    });

    document.querySelector('.cat-cards-modal-overlay')?.remove();

    // Split into columns of max 10 cards each
    const COL_SIZE = 10;
    const cols = [];
    for (let i = 0; i < matchingCards.length; i += COL_SIZE) {
      cols.push(matchingCards.slice(i, i + COL_SIZE));
    }

    const colsHTML = cols.map(col => {
      const rows = col.map(card => {
        const safeName = card.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const imgAttr  = card.imageUrl     ? `data-image-url="${card.imageUrl.replace(/"/g, '&quot;')}"` : '';
        const backAttr = card.backImageUrl ? `data-back-image-url="${card.backImageUrl.replace(/"/g, '&quot;')}"` : '';
        const qty = card.quantity > 1 ? `<span class="muted" style="font-size:10px">${card.quantity}× </span>` : '';
        const primaryType = (card.types || []).find(t => TYPE_COLORS[t]) || 'Other';
        const typeColor = TYPE_COLORS[primaryType] || TYPE_COLORS.Other;
        const typeChip = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${typeColor};margin-right:4px;flex-shrink:0"></span>`;
        return `<div class="card-row card-row--clickable" style="padding:4px 8px"
          ${imgAttr} ${backAttr}
          onmouseenter="window.__preview?.show(this.dataset.imageUrl,this.dataset.backImageUrl)"
          onmouseleave="window.__preview?.hide()">${typeChip}${qty}<span class="card-row-name">${safeName}</span></div>`;
      }).join('');
      return `<div class="hand-column">${rows}</div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'cat-cards-modal-overlay hands-modal-overlay';
    overlay.innerHTML = `
      <div class="hands-modal" style="max-width:800px">
        <div class="hands-modal-header">
          <span>${catName} (${matchingCards.reduce((s, c) => s + c.quantity, 0)} cards)</span>
          <button class="btn-icon" onclick="this.closest('.cat-cards-modal-overlay').remove()">✕</button>
        </div>
        <div class="hands-modal-body" style="flex-wrap:wrap">${colsHTML}</div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },
};

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
