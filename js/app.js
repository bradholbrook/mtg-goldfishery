/**
 * MTG Goldfish Simulator - App Entry Point
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
  updateDeckXCost,
  renameDeck,
} from './storage.js';
import {
  renderDeckList, renderActiveDeck, showToast,
  setImportLoading, TYPE_COLORS,
} from './ui.js';
import { generateId } from './types.js';
import { CRITERION_TYPES, evaluateGoodHandDef } from './criteria.js';
import { enrichDeckWithScryfall } from './enrichment.js';
import { EFFECT_TYPES, EFFECT_TYPE_OPTIONS, resolveCastFilter } from './effect-types.js';

// ─── State ────────────────────────────────────────────────────────────────────

let activeDeckId = null;

/**
 * When non-null, the active deck panel shows the definition editor.
 * Shape: { defId: string|null, name: string, criteria: Criterion[] }
 *   defId = null  → creating a new definition
 *   defId = uuid  → editing an existing definition
 */
let editingDef = null;

let activeTab = 'cards';

/** Card names currently expanded in the Cards tab effect editor. */
const expandedEffectCards = new Set();

/** Type names currently expanded in the Overview tab type list. */
const expandedTypeGroups = new Set();

/** Persistent simulate tab settings — survive re-renders. */
let simGameCount = 1000;
let simMaxTurns = 10;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindImportPanel();
  bindSaveLoad();
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
  renderActiveDeck(getDeckById(activeDeckId), handleRunSimulation, editingDef, activeTab, expandedEffectCards, expandedTypeGroups, simGameCount, simMaxTurns);
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

const MOXFIELD_URL_RE = /moxfield\.com\/decks\/([\w-]+)/i;

// Moxfield's API doesn't set CORS headers, so browsers block direct fetches.
// corsproxy.io proxies the request server-side and adds CORS headers for us.
// Swap this constant if a self-hosted proxy is added later.
const CORS_PROXY = 'https://corsproxy.io/?url=';

function logEnrichedDeck(deck) {
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  console.groupCollapsed(`[goldfishery] Enriched deck: "${deck.name}" — ${deck.cards.length} unique / ${total} total`);
  console.table(deck.cards.map(c => ({
    name:     c.name,
    qty:      c.quantity,
    types:    c.types?.join(', ') ?? '—',
    cmc:      c.cmc ?? '—',
    tags:     c.effectTags?.map(t => t.tag).join(', ') || '',
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
      importBtn.textContent = '⏳ Fetching…';

      try {
        const apiUrl = `https://api2.moxfield.com/v2/decks/all/${publicId}`;
        const res = await fetch(CORS_PROXY + encodeURIComponent(apiUrl));
        if (!res.ok) throw new Error(`Moxfield returned HTTP ${res.status}`);

        const apiData = await res.json();

        const mainboardEntries = Object.values(apiData.mainboard || {});
        const { deck, errors } = parseMoxfieldApiResponse(apiData, name);
        const noTypeLine = mainboardEntries.filter(e => !e.card?.type_line);
        if (noTypeLine.length) console.warn('[goldfishery] Moxfield entries with missing type_line:', noTypeLine.map(e => e.card?.name));
        console.log(`[goldfishery] Moxfield: parsed ${deck.cards.length} unique cards (${mainboardEntries.reduce((s, e) => s + (e.quantity || 1), 0)} total)`);

        errors.forEach(e => showToast(e, 'warn'));

        if (deck.cards.length === 0) {
          showToast('Could not parse any cards from Moxfield.', 'error');
          return;
        }

        // Enrich with Scryfall data
        importBtn.textContent = '⏳ Enriching…';
        setImportLoading(true, 'Fetching card data from Scryfall…');
        let deckToSave = deck;
        try {
          deckToSave = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg));
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
      importBtn.textContent = '⏳ Enriching…';
      setImportLoading(true, 'Fetching card data from Scryfall…');
      try {
        const enriched = await enrichDeckWithScryfall(deck, msg => setImportLoading(true, msg));
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
  activeTab = 'overview';

  document.querySelectorAll('.deck-card').forEach(el => {
    el.classList.toggle('deck-card--active', el.dataset.deckId === deckId);
  });

  refresh();
}

function handleDeleteDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  if (!confirm(`Remove "${deck.name}"?`)) return;

  removeDeck(deckId);
  if (activeDeckId === deckId) activeDeckId = null;

  showToast(`Removed "${deck.name}"`, 'info');
  refresh();
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
    if (!deck || !confirm('Remove this good hand definition?')) return;
    removeGoodHandDef(deck.id, defId);
    refresh();
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

// ─── X Spell Value Actions ────────────────────────────────────────────────────

window.__xcosts = {
  set(cardName, value) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    updateDeckXCost(deck.id, cardName, Math.max(0, Math.floor(value) || 0));
    // No refresh — input is live
  },
};

// ─── Opponent Profile Actions ─────────────────────────────────────────────────

window.__opp = {
  set(field, value) {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    if (!deck.strategyConfig) deck.strategyConfig = {};
    const min = field === 'numOpponents' ? 1 : 0;
    deck.strategyConfig[field] = Math.max(min, Math.floor(value) || min);
    // No refresh — input is live
  },
};

// ─── Effect Tag Editor Actions ────────────────────────────────────────────────
//
// Exposed on window.__eff so onclick= attributes in effect editor templates can
// reach them without circular imports. All mutating actions call refresh().

/** Find the card object in the active deck by name. */
function getCardByName(cardName) {
  const deck = getDeckById(activeDeckId);
  return deck?.cards.find(c => c.name === cardName) ?? null;
}

window.__eff = {

  /** Toggle the effect editor open/closed for a card row. Only one open at a time. */
  toggle(cardName) {
    const wasOpen = expandedEffectCards.has(cardName);
    expandedEffectCards.clear();
    if (!wasOpen) expandedEffectCards.add(cardName);
    window.__preview?.setLocked(expandedEffectCards.size > 0);
    refresh();
  },

  /**
   * Create a user override for an auto-detected tag.
   * The override inherits the auto tag's detected values as a starting point.
   * In the simulator, the auto tag is skipped when a user tag exists for the
   * same (subtype, timing) pair.
   */
  override(cardName, subtype, timing) {
    const card = getCardByName(cardName);
    if (!card) return;
    const autoTag = card.effectTags.find(
      t => t.source === 'auto' && t.subtype === subtype && t.timing === timing
    );
    if (!autoTag) return;
    // Guard: don't create a duplicate override
    const alreadyOverridden = card.effectTags.some(
      t => t.source === 'user' && t.subtype === subtype && t.timing === timing
    );
    if (alreadyOverridden) return;

    const typeInfo = EFFECT_TYPES[subtype];
    card.effectTags.push({
      category:      autoTag.category,
      subtype:       autoTag.subtype,
      timing:        autoTag.timing,
      condition:     autoTag.condition ?? null,
      expectedValue: null,
      tier:          autoTag.tier,
      source:        'user',
      ...(typeInfo?.defaultValues() ?? {}),
      // Inherit the auto-detected value so the override starts accurate
      value:         autoTag.value,
      // Inherit trigger filter so override reflects the detected spell/death filter
      triggerFilter: autoTag.triggerFilter ?? null,
    });
    refresh();
  },

  /**
   * Add a new user effect tag. Picks the first (subtype, timing) pair not
   * already covered by an auto-detected tag so there's no immediate conflict.
   */
  add(cardName) {
    const card = getCardByName(cardName);
    if (!card) return;
    card.effectTags = card.effectTags || [];

    // Each card gets at most one tag per subtype — hide the entire subtype if any
    // tag (auto or user) already uses it.
    const coveredSubtypes = new Set(card.effectTags.map(t => t.subtype));
    const chosenType = EFFECT_TYPE_OPTIONS.find(et => !coveredSubtypes.has(et.id));

    if (!chosenType) {
      showToast('Every effect type is already on this card. Use Override to customise auto-detected ones.', 'warn');
      return;
    }

    const chosenTiming = chosenType.validTimings[0];

    card.effectTags.push({
      category:      chosenType.category,
      subtype:       chosenType.id,
      timing:        chosenTiming,
      condition:     null,
      expectedValue: null,
      tier:          chosenType.defaultTier,
      source:        'user',
      ...chosenType.defaultValues(),
    });
    refresh();
  },

  /** Remove a user tag by its index in card.effectTags. */
  remove(cardName, tagIdx) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    card.effectTags.splice(tagIdx, 1);
    refresh();
  },

  /** Update a single field on a user tag. Re-renders only when needed. */
  setField(cardName, tagIdx, fieldKey, value) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    tag[fieldKey] = value;
  },

  /**
   * Change the subtype of a user addition tag.
   * Picks the first uncovered timing for the new subtype.
   * Only applies to addition tags (not overrides — their subtype is fixed).
   */
  setSubtype(cardName, tagIdx, subtypeId) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;

    const typeInfo = EFFECT_TYPES[subtypeId];
    if (!typeInfo) return;

    // Block if any tag (auto or user) already uses this subtype — one per card.
    const coveredSubtypes = new Set(
      card.effectTags.filter((_, i) => i !== tagIdx).map(t => t.subtype)
    );
    if (coveredSubtypes.has(subtypeId)) return; // UI should already prevent this

    const availableTiming = typeInfo.validTimings[0];

    card.effectTags[tagIdx] = {
      category:      typeInfo.category,
      subtype:       subtypeId,
      timing:        availableTiming,
      condition:     null,
      expectedValue: null,
      tier:          typeInfo.defaultTier,
      source:        'user',
      ...typeInfo.defaultValues(),
    };
    refresh();
  },

  /** Change the timing of a user addition tag. Re-renders to show/hide trigger filter widgets. */
  setTiming(cardName, tagIdx, timing) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    tag.timing = timing;
    refresh();
  },

  /** Toggle tier for a conditional user tag. Re-renders to show/hide EV input. */
  setTier(cardName, tagIdx, tier) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    tag.tier = tier;
    refresh();
  },

  /** Set the cast spell-type filter on a user tag. */
  setCastFilter(cardName, tagIdx, key) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    tag.triggerFilter = resolveCastFilter(key);
  },

  /** Set the death subject filter on a user tag. */
  setDeathSubject(cardName, tagIdx, key) {
    const card = getCardByName(cardName);
    if (!card) return;
    const tag = card.effectTags[tagIdx];
    if (!tag || tag.source !== 'user') return;
    if (!tag.triggerFilter) tag.triggerFilter = {};
    tag.triggerFilter.deathSubject = key;
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

// ─── Simulate Tab Settings ────────────────────────────────────────────────────

window.__sim = {
  setGameCount(v) { simGameCount = parseInt(v, 10); },
  setMaxTurns(v)  { simMaxTurns  = parseInt(v, 10); },
};

window.__ovr = {
  toggle(type) {
    if (expandedTypeGroups.has(type)) {
      expandedTypeGroups.delete(type);
    } else {
      expandedTypeGroups.add(type);
    }
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

window.__deck = {
  rename() {
    const deck = getDeckById(activeDeckId);
    if (!deck) return;
    const newName = prompt('Rename deck:', deck.name)?.trim();
    if (newName) {
      renameDeck(deck.id, newName);
      refresh();
    }
  },
};

// ─── Simulation ───────────────────────────────────────────────────────────────

function handleRunSimulation(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;

  const gameCount = simGameCount;
  const maxTurns  = simMaxTurns;

  const btn = document.getElementById('run-sim-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Simulating…'; }

  // Defer to next tick so the UI updates before the heavy loop
  setTimeout(() => {
    try {
      const goodHandDefs = deck.goodHandDefs || [];
      const deckWithTurns = { ...deck, strategyConfig: { ...(deck.strategyConfig || {}), maxTurns } };
      const results = runSimulation(deckWithTurns, gameCount, goodHandDefs);
      results.goodHandDefNames = Object.fromEntries(
        goodHandDefs.map(d => [d.id, d.name])
      );
      addResults(results);
      activeTab = 'results';
      refresh();
      showToast(`Simulated ${gameCount.toLocaleString()} games`, 'success');
    } catch (err) {
      showToast(`Simulation error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Goldfish'; }
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
