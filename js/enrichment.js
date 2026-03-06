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

import { detectEffectTags } from './effects.js';

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

/**
 * Derive the primary card type from a Scryfall type_line string.
 * Used for single-faced cards only. For MDFCs use typeLineToTypes() per face.
 *
 * @param {string} typeLine
 * @returns {string}
 */
function typeLineToType(typeLine) {
  if (!typeLine) return 'Other';
  const main = typeLine.split('—')[0].toLowerCase();
  if (main.includes('land'))         return 'Land';
  if (main.includes('creature'))     return 'Creature';
  if (main.includes('instant'))      return 'Instant';
  if (main.includes('sorcery'))      return 'Sorcery';
  if (main.includes('artifact'))     return 'Artifact';
  if (main.includes('enchantment'))  return 'Enchantment';
  if (main.includes('planeswalker')) return 'Planeswalker';
  if (main.includes('battle'))       return 'Battle';
  return 'Other';
}

/**
 * Extract all recognized card types from a single-face type_line string.
 * Unlike typeLineToType(), returns every matching type rather than just the primary.
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
      const faceTypes = typeLineToTypes(face.type_line || '');
      return {
        name: face.name || '',
        types: faceTypes,
        oracleText: faceOracleText,
        cmc: face.cmc ?? null,
        manaCost: face.mana_cost || null,
        power: face.power ?? null,
        toughness: face.toughness ?? null,
        effectTags: detectEffectTags(faceOracleText, faceKeywords, faceTypes),
      };
    });

    // Combined unique types from all faces + the MDFC sentinel type
    const allFaceTypes = [...new Set(faces.flatMap(f => f.types))];
    const types = [...allFaceTypes, 'MDFC'];

    // Merge effect tags from all faces (front face first)
    const effectTags = faces.flatMap(f => f.effectTags);

    // Front face drives card-level fields used for casting as a spell
    const frontFace = faces[0];

    return {
      oracleText: frontFace.oracleText,
      cmc: frontFace.cmc ?? scryfallCard.cmc ?? null,
      manaCost: frontFace.manaCost,
      keywords: (scryfallCard.card_faces[0].keywords || []).length > 0
        ? scryfallCard.card_faces[0].keywords
        : null,
      producedMana: scryfallCard.produced_mana || null,
      scryfallId: scryfallCard.id || null,
      enriched: true,
      effectTags,
      types,
      isMDFC: true,
      faces,
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

  // Use typeLineToTypes() so multi-type cards (e.g. "Enchantment Land", "Artifact Creature")
  // carry all their types rather than only the primary one.
  const types = scryfallCard.type_line ? typeLineToTypes(scryfallCard.type_line) : null;
  const effectTags = detectEffectTags(oracleText, keywords, types ?? []);

  return {
    oracleText,
    cmc: scryfallCard.cmc ?? null,
    manaCost: scryfallCard.mana_cost || scryfallCard.card_faces?.[0]?.mana_cost || null,
    keywords: keywords.length > 0 ? keywords : null,
    producedMana: scryfallCard.produced_mana || null,
    scryfallId: scryfallCard.id || null,
    enriched: true,
    effectTags,
    types,
    isMDFC: false,
    faces: null,
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
export async function enrichDeckWithScryfall(deck, onProgress = null) {
  const notify = msg => { if (onProgress) onProgress(msg); };

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
            console.warn(`[goldfishery] Scryfall did not find card: "${name}"`);
            enrichmentMap.set(name, {
              oracleText: null,
              cmc: null,
              manaCost: null,
              keywords: null,
              producedMana: null,
              scryfallId: null,
              enriched: false,
              effectTags: [],
              types: null,
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
              enriched: false,
              effectTags: [],
              types: null,
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

  // ── Merge enrichment fields onto card objects ──────────────────────────────
  const enrichedCards = deck.cards.map(card => {
    const fields = enrichmentMap.get(card.name);
    if (!fields) return { ...card, effectTags: [], enriched: false };

    return {
      ...card,
      ...fields,
      types: fields.types ?? card.types,
    };
  });

  notify('Enrichment complete.');

  return {
    ...deck,
    cards: enrichedCards,
    enriched: true,
  };
}
