/**
 * MTG Goldfish Simulator - Scryfall Enrichment
 *
 * Fetches oracle text, CMC, and other data from Scryfall for each card,
 * then runs detectEffectTags() to build the effectTags[] array.
 *
 * Import is a single step that includes enrichment — call enrichDeckWithScryfall()
 * immediately after parsing the decklist.
 *
 * Cache: localStorage, keyed by lowercase card name, 30-day TTL.
 * Cards already cached are not re-fetched even across different deck imports.
 */

import { detectEffectTags, detectEtbTapped } from './effects.js';
import { fetchOracleTags, mapTagsToCategories } from './tagger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'scryfall_card_';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75;       // Scryfall's max identifiers per POST
const BATCH_DELAY_MS = 100;  // Required polite delay between batches

// ─── Cache Helpers ────────────────────────────────────────────────────────────

/**
 * Build the localStorage key for a card name.
 * @param {string} name
 * @returns {string}
 */
function cacheKey(name) {
  return CACHE_PREFIX + name.toLowerCase();
}

/**
 * Read a cached Scryfall card entry, returning null if absent or expired.
 * @param {string} name
 * @returns {Object|null} Scryfall card data, or null on cache miss
 */
function readCache(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.data || !entry.cachedAt) return null;
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(name));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Write a Scryfall card entry to the cache.
 * @param {string} name
 * @param {Object} data - Scryfall card object
 */
function writeCache(name, data) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // localStorage may be full or unavailable — silently skip caching
  }
}

// ─── Scryfall Fetch ───────────────────────────────────────────────────────────

/**
 * POST a batch of card names to Scryfall /cards/collection.
 * Returns a map of lowercased name → Scryfall card object for found cards.
 * Cards in not_found[] are absent from the returned map.
 *
 * @param {string[]} names
 * @returns {Promise<Map<string, Object>>}
 */
async function fetchBatchFromScryfall(names) {
  // Scryfall fuzzy name search chokes on " // " (double-faced card separator).
  // Strip back-face names before sending; the response still has the full
  // canonical name (e.g. "Shatterskull Smashing // Shatterskull, the Hammer Pass")
  // so the result map key will still match our deck's full card name.
  const identifiers = names.map(n => ({ name: n.includes(' // ') ? n.split(' // ')[0].trim() : n }));
  const body = JSON.stringify({ identifiers });

  const res = await fetch(SCRYFALL_COLLECTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Scryfall responded with HTTP ${res.status}`);
  }

  const json = await res.json();
  const result = new Map();

  for (const card of (json.data || [])) {
    // Scryfall returns cards with their canonical names; match by lowercase
    result.set(card.name.toLowerCase(), card);
  }

  // not_found entries simply won't appear in the map — callers handle this
  return result;
}

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Card Enrichment ──────────────────────────────────────────────────────────

const KNOWN_SUPERTYPES = ['Basic', 'Legendary', 'Snow', 'World', 'Ongoing'];

/**
 * Extract supertypes from a type_line string (text before "—").
 * e.g. "Basic Land — Forest" → ['Basic']
 * @param {string} typeLine
 * @returns {string[]}
 */
function typeLineToSupertypes(typeLine) {
  if (!typeLine) return [];
  const mainPart = typeLine.split('—')[0];
  return KNOWN_SUPERTYPES.filter(st => mainPart.includes(st));
}

/**
 * Extract subtypes from a type_line string (text after "—").
 * e.g. "Creature — Human Wizard" → ['Human', 'Wizard']
 * @param {string} typeLine
 * @returns {string[]}
 */
function typeLineToSubtypes(typeLine) {
  if (!typeLine) return [];
  const dashIdx = typeLine.indexOf('—');
  if (dashIdx < 0) return [];
  return typeLine.slice(dashIdx + 1).trim().split(/\s+/).filter(Boolean);
}

/**
 * Extract all recognized card types from a single-face type_line string.
 * Returns every matching main type rather than just the primary.
 * e.g. "Legendary Creature — Human Wizard" → ['Creature']
 *      "Artifact Creature — Golem"          → ['Creature', 'Artifact']
 *      "Basic Land — Forest"                → ['Land']
 *
 * @param {string} typeLine
 * @returns {string[]}
 */
function typeLineToTypes(typeLine) {
  if (!typeLine) return ['Other'];
  const main = typeLine.split('—')[0].toLowerCase();
  const types = [];
  if (main.includes('land'))         types.push('Land');
  if (main.includes('creature'))     types.push('Creature');
  if (main.includes('instant'))      types.push('Instant');
  if (main.includes('sorcery'))      types.push('Sorcery');
  if (main.includes('artifact'))     types.push('Artifact');
  if (main.includes('enchantment'))  types.push('Enchantment');
  if (main.includes('planeswalker')) types.push('Planeswalker');
  if (main.includes('battle'))       types.push('Battle');
  return types.length > 0 ? types : ['Other'];
}

/**
 * Extract and normalize enrichment fields from a raw Scryfall card object.
 * For Modal Double-Faced Cards (layout === 'modal_dfc'), extracts per-face data:
 *   - card.types  = combined unique types from all faces + 'MDFC'
 *   - card.cmc    = front face CMC (the spell you'd cast)
 *   - card.faces  = [{name, types, oracleText, cmc, manaCost, effectTags}, ...]
 *   - card.isMDFC = true
 * Single-faced and transform cards use the existing single-type logic.
 *
 * @param {Object} scryfallCard
 * @returns {Object} enrichment fields to merge onto a Card
 */
function extractEnrichmentFields(scryfallCard) {
  const isMDFC = scryfallCard.layout === 'modal_dfc';

  if (isMDFC && Array.isArray(scryfallCard.card_faces) && scryfallCard.card_faces.length >= 2) {
    // ── Modal Double-Faced Card ────────────────────────────────────────────
    const faces = scryfallCard.card_faces.map(face => {
      const faceOracleText = face.oracle_text || null;
      const faceKeywords = face.keywords || [];
      const faceTypeLine = face.type_line || '';
      const faceTypes = typeLineToTypes(faceTypeLine);
      return {
        name: face.name || '',
        types: faceTypes,
        supertypes: typeLineToSupertypes(faceTypeLine),
        subtypes: typeLineToSubtypes(faceTypeLine),
        oracleText: faceOracleText,
        cmc: face.cmc ?? null,
        manaCost: face.mana_cost || null,
        power: face.power ?? null,
        toughness: face.toughness ?? null,
        effectTags: detectEffectTags(faceOracleText, { keywords: faceKeywords, cardTypes: faceTypes }),
      };
    });

    // Combined unique types from all faces + the MDFC sentinel type
    const allFaceTypes = [...new Set(faces.flatMap(f => f.types))];
    const types = [...allFaceTypes, 'MDFC'];

    // Merge effect tags from all faces (front face first)
    const effectTags = faces.flatMap(f => f.effectTags);

    // Front face drives card-level fields used for casting as a spell
    const frontFace = faces[0];

    // For MDFCs, check the land face for ETB-tapped status
    const landFace = faces.find(f => f.types?.includes('Land'));

    const oracleId = scryfallCard.oracle_id || null;

    return {
      oracleText: frontFace.oracleText,
      cmc: frontFace.cmc ?? scryfallCard.cmc ?? null,
      manaCost: frontFace.manaCost,
      keywords: (scryfallCard.card_faces[0].keywords || []).length > 0
        ? scryfallCard.card_faces[0].keywords
        : null,
      producedMana: scryfallCard.produced_mana || null,
      colorIdentity: (scryfallCard.color_identity || []).filter(c => 'WUBRG'.includes(c)),
      scryfallId: scryfallCard.id || null,
      oracleId,
      set: scryfallCard.set || null,
      collectorNumber: scryfallCard.collector_number || null,
      enriched: true,
      effectTags,
      otags: [],
      categories: [],
      types,
      isMDFC: true,
      faces,
      etbTapped: landFace ? detectEtbTapped(landFace.oracleText) : false,
      power: faces[0].power ?? null,
      toughness: faces[0].toughness ?? null,
      imageUrl: scryfallCard.image_uris?.normal
             ?? scryfallCard.card_faces?.[0]?.image_uris?.normal
             ?? null,
      backImageUrl: scryfallCard.card_faces?.[1]?.image_uris?.normal ?? null,
    };
  }

  // ── Single-faced card (or transform DFC — treat as front face only) ────────
  let oracleText = scryfallCard.oracle_text || null;
  let keywords = scryfallCard.keywords || [];

  if (!oracleText && Array.isArray(scryfallCard.card_faces) && scryfallCard.card_faces.length > 0) {
    oracleText = scryfallCard.card_faces[0].oracle_text || null;
    keywords = scryfallCard.card_faces[0].keywords || keywords;
  }

  // Prefer Scryfall's structured type arrays; fall back to parsing type_line.
  // Scryfall's types[] values match our CARD_TYPES (Land, Creature, Artifact, etc.).
  const typeLine = scryfallCard.type_line || '';
  const types = scryfallCard.types?.length ? scryfallCard.types : typeLineToTypes(typeLine);
  const supertypes = scryfallCard.supertypes ?? typeLineToSupertypes(typeLine);
  const subtypes = scryfallCard.subtypes ?? typeLineToSubtypes(typeLine);
  const effectTags = detectEffectTags(oracleText, { keywords: keywords ?? [], cardTypes: types });
  const oracleId = scryfallCard.oracle_id || null;

  return {
    oracleText,
    cmc: scryfallCard.cmc ?? null,
    manaCost: scryfallCard.mana_cost || scryfallCard.card_faces?.[0]?.mana_cost || null,
    keywords: keywords.length > 0 ? keywords : null,
    producedMana: scryfallCard.produced_mana || null,
    colorIdentity: (scryfallCard.color_identity || []).filter(c => 'WUBRG'.includes(c)),
    scryfallId: scryfallCard.id || null,
    oracleId,
    set: scryfallCard.set || null,
    collectorNumber: scryfallCard.collector_number || null,
    enriched: true,
    effectTags,
    otags: [],
    categories: [],
    types,
    supertypes,
    subtypes,
    isMDFC: false,
    faces: null,
    etbTapped: detectEtbTapped(oracleText),
    power: scryfallCard.power ?? scryfallCard.card_faces?.[0]?.power ?? null,
    toughness: scryfallCard.toughness ?? scryfallCard.card_faces?.[0]?.toughness ?? null,
    imageUrl: scryfallCard.image_uris?.normal
           ?? scryfallCard.card_faces?.[0]?.image_uris?.normal
           ?? null,
    backImageUrl: null,
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Enrich a parsed DeckConfig with Scryfall data.
 *
 * For each card:
 *   - If already in localStorage cache → use cached data
 *   - Otherwise → batch-fetch from Scryfall, cache result
 *   - Run detectEffectTags() → set card.effectTags[]
 *
 * If Scryfall is unreachable, cards that fail get:
 *   { effectTags: [], cmc: null, enriched: false }
 *
 * @param {import('./types.js').DeckConfig} deck  - Parsed (unenriched) deck
 * @param {function(string):void} [onProgress]    - Optional status callback (message string)
 * @returns {Promise<import('./types.js').DeckConfig>} deck with enrichment fields added
 */
export async function enrichDeckWithScryfall(deck, onProgress = null, onError = null) {
  const notify = msg => { if (onProgress) onProgress(msg); };
  const notifyError = msg => { if (onError) onError(msg); };

  // Collect unique card names (cards array may have multiple entries with same name)
  const uniqueNames = [...new Set(deck.cards.map(c => c.name))];

  // ── Check cache ───────────────────────────────────────────────────────────
  const enrichmentMap = new Map(); // name → enrichment fields
  const cacheMisses = [];

  for (const name of uniqueNames) {
    const cached = readCache(name);
    if (cached) {
      enrichmentMap.set(name, extractEnrichmentFields(cached));
    } else {
      cacheMisses.push(name);
    }
  }

  // ── Batch-fetch cache misses ───────────────────────────────────────────────
  if (cacheMisses.length > 0) {
    notify(`Fetching ${cacheMisses.length} card(s) from Scryfall…`);

    const batches = [];
    for (let i = 0; i < cacheMisses.length; i += BATCH_SIZE) {
      batches.push(cacheMisses.slice(i, i + BATCH_SIZE));
    }

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      if (batchIdx > 0) {
        await sleep(BATCH_DELAY_MS);
      }

      notify(`Fetching batch ${batchIdx + 1} of ${batches.length}…`);

      try {
        const scryfallResults = await fetchBatchFromScryfall(batch);

        for (const name of batch) {
          // Primary lookup by full name; fall back to front-face name for DFCs
          // in case the Scryfall canonical name differs slightly from Moxfield's.
          const frontName = name.includes(' // ') ? name.split(' // ')[0].trim() : name;
          const scryfallCard = scryfallResults.get(name.toLowerCase())
            ?? scryfallResults.get(frontName.toLowerCase());
          if (scryfallCard) {
            writeCache(name, scryfallCard);
            enrichmentMap.set(name, extractEnrichmentFields(scryfallCard));
          } else {
            // Card not found on Scryfall — log for debugging
            console.warn(`[mullstat] Scryfall did not find card: "${name}"`);
            enrichmentMap.set(name, {
              oracleText: null,
              cmc: null,
              manaCost: null,
              keywords: null,
              producedMana: null,
              scryfallId: null,
              oracleId: null,
              set: null,
              collectorNumber: null,
              enriched: false,
              effectTags: [],
              otags: [],
              categories: [],
              types: ['Unknown'],
              supertypes: [],
              subtypes: [],
              isMDFC: false,
              faces: null,
              power: null,
              toughness: null,
            });
          }
        }
      } catch (err) {
        // Scryfall batch failed — mark all names in this batch as unenriched
        for (const name of batch) {
          if (!enrichmentMap.has(name)) {
            enrichmentMap.set(name, {
              oracleText: null,
              cmc: null,
              manaCost: null,
              keywords: null,
              producedMana: null,
              scryfallId: null,
              oracleId: null,
              set: null,
              collectorNumber: null,
              enriched: false,
              effectTags: [],
              otags: [],
              categories: [],
              types: ['Unknown'],
              supertypes: [],
              subtypes: [],
              isMDFC: false,
              faces: null,
              power: null,
              toughness: null,
            });
          }
        }
      }
    }
  }

  // ── Merge enrichment fields onto card objects (no tags yet) ──────────────
  const enrichedCards = deck.cards.map(card => {
    const fields = enrichmentMap.get(card.name);
    if (!fields) return { ...card, effectTags: [], enriched: false };

    const merged = {
      ...card,
      ...fields,
      types: fields.types ?? card.types,
    };

    // Override image URL with Moxfield-selected printing if available
    if (card.moxfieldScryfallId) {
      const id = card.moxfieldScryfallId;
      merged.imageUrl = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
      if (merged.backImageUrl) {
        merged.backImageUrl = `https://cards.scryfall.io/normal/back/${id[0]}/${id[1]}/${id}.jpg`;
      }
    }

    return merged;
  });

  notify('Scryfall enrichment complete.');

  return {
    ...deck,
    cards: enrichedCards,
    enriched: true,
    tagsStatus: 'pending',   // tags not yet fetched — caller must run enrichTagsForDeck()
    _enrichmentMap: enrichmentMap, // handed off for Phase 2; stripped before saving
  };
}

/**
 * Phase 2 of enrichment: fetch oracle tags from the Cloudflare Worker and patch
 * card.otags / card.categories onto an already-Scryfall-enriched deck.
 *
 * The deck should have been returned by enrichDeckWithScryfall() so that
 * _enrichmentMap is still attached. Falls back gracefully to a name→oracleId
 * scan of the cards themselves if _enrichmentMap is missing.
 *
 * @param {import('./types.js').DeckConfig} deck  - deck with tagsStatus:'pending'
 * @param {function} [onProgress]
 * @param {function} [onError]
 * @returns {Promise<import('./types.js').DeckConfig>}  deck with tagsStatus:'ready' or 'failed'
 */
export async function enrichTagsForDeck(deck, onProgress = null, onError = null) {
  const notify      = msg => { if (onProgress) onProgress(msg); };
  const notifyError = msg => { if (onError)    onError(msg); };

  // Rebuild card lookup: name → { oracleId, set, collectorNumber, keywords, oracleText }
  // Prefer the _enrichmentMap attached during Phase 1 (most accurate); fall back to card fields.
  const enrichmentMap = deck._enrichmentMap ?? (() => {
    const m = new Map();
    for (const card of deck.cards) {
      if (card.oracleId) m.set(card.name, card);
    }
    return m;
  })();

  const seenOracles   = new Set();
  const cardsForTagger = [...enrichmentMap.entries()]
    .filter(([, f]) => f.oracleId && f.set && f.collectorNumber)
    .filter(([, f]) => {
      if (seenOracles.has(f.oracleId)) return false;
      seenOracles.add(f.oracleId);
      return true;
    })
    .map(([, f]) => ({ oracleId: f.oracleId, set: f.set, collectorNumber: f.collectorNumber }));

  if (cardsForTagger.length === 0) {
    return { ...deck, tagsStatus: 'ready', _enrichmentMap: undefined };
  }

  notify(`Fetching oracle tags for ${cardsForTagger.length} card(s)…`);
  const { tags: tagMap, failed } = await fetchOracleTags(cardsForTagger);
  if (failed) notifyError('Tag enrichment failed — castability analysis uses ramp estimate only.');

  // Patch categories onto each card
  const patchedCards = deck.cards.map(card => {
    const oracleId = card.oracleId ?? enrichmentMap.get(card.name)?.oracleId;
    if (!oracleId) return card;
    const slugs = tagMap.get(oracleId) ?? [];
    return {
      ...card,
      otags:      slugs,
      categories: mapTagsToCategories(slugs, card.keywords ?? [], card.oracleText),
    };
  });

  notify('Tag enrichment complete.');
  return {
    ...deck,
    cards:        patchedCards,
    tagsStatus:   failed ? 'failed' : 'ready',
    _enrichmentMap: undefined,  // release memory
  };
}
