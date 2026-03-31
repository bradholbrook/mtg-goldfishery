/**
 * mullstat - Scryfall Tagger Client
 *
 * Fetches per-card oracle tags via the mullstat Cloudflare Worker, which
 * handles the Tagger session/CSRF auth that browsers cannot do directly.
 *
 * Exported:
 *   fetchOracleTags(cards)                   → Promise<{ tags: Map<oracleId, string[]>, failed: boolean }>
 *   mapTagsToCategories(slugs, kws, oracle)  → string[]
 *   OTAG_TO_CATEGORY                         → Record<slug, category>
 */

const WORKER_URL = 'https://mullstat-tagger.bholbr.workers.dev';
const BATCH_SIZE = 50;

// ─── Slug → Category Mapping ──────────────────────────────────────────────────

/**
 * Maps known Scryfall Tagger oracle-tag slugs to canonical categories.
 * Includes both parent slugs (matched by function:X searches) and
 * child slugs (specific sub-types).
 */
export const OTAG_TO_CATEGORY = {
  // ── Ramp ──────────────────────────────────────────────────────────────────
  'ramp':                    'Ramp',
  'ritual':                  'Ramp',
  'treasure-producer':       'Ramp',
  'treasure-token-producer': 'Ramp',
  'gold-producer':           'Ramp',

  // ── Mana Rock ─────────────────────────────────────────────────────────────
  'mana-rock':               'Mana Rock',

  // ── Mana Dork ─────────────────────────────────────────────────────────────
  'mana-dork':               'Mana Dork',

  // ── Card Draw ─────────────────────────────────────────────────────────────
  'draw':                    'Card Draw',
  'card-draw':               'Card Draw',
  'cantrip':                 'Card Draw',
  'card-advantage':          'Card Draw',
  'looting':                 'Card Draw',
  'rummaging':               'Card Draw',
  'impulse-draw':            'Card Draw',
  'wheel':                   'Card Draw',

  // ── Interaction ───────────────────────────────────────────────────────────
  'removal':                 'Interaction',
  'counterspell':            'Interaction',
  'bounce':                  'Interaction',
  'exile-removal':           'Interaction',
  'destroy-removal':         'Interaction',
  'tap-down':                'Interaction',
  'tuck':                    'Interaction',
  'phase-out':               'Interaction',
  'blink':                   'Interaction',
  'redirect':                'Interaction',
  'stifle':                  'Interaction',
  'permanent-steal':         'Interaction',

  // ── Board Wipe ────────────────────────────────────────────────────────────
  'boardwipe':               'Board Wipe',
  'wrath':                   'Board Wipe',
  'mass-removal':            'Board Wipe',

  // ── Tutor ─────────────────────────────────────────────────────────────────
  'tutor':                   'Tutor',
  'tutor-creature':          'Tutor',
  'tutor-equipment':         'Tutor',
  'tutor-instant':           'Tutor',
  'tutor-sorcery':           'Tutor',
  'tutor-enchantment':       'Tutor',
  'tutor-artifact':          'Tutor',

  // ── Mill ──────────────────────────────────────────────────────────────────
  'mill-self':               'Mill',

  // Cascade and Discover are detected from keywords / oracle text below
};

// ─── Category Resolution ──────────────────────────────────────────────────────

/**
 * Map otag slugs (+ keywords + oracle text) to canonical category names.
 * Cascade is detected from keywords; Discover from oracle text regex.
 *
 * @param {string[]}      slugs      - oracle-tag slugs from Scryfall Tagger
 * @param {string[]|null} keywords   - Scryfall keywords array
 * @param {string|null}   oracleText
 * @returns {string[]} unique canonical category names
 */
export function mapTagsToCategories(slugs, keywords = [], oracleText = null, customOtagMap = null) {
  const otagMap = customOtagMap ?? OTAG_TO_CATEGORY;
  const categories = new Set();

  for (const slug of (slugs || [])) {
    const cat = otagMap[slug];
    if (cat) categories.add(cat);
  }

  if (Array.isArray(keywords) && keywords.some(k => k.toLowerCase() === 'cascade')) {
    categories.add('Cascade');
  }

  if (oracleText && /\bdiscover\b/i.test(oracleText)) {
    categories.add('Discover');
  }

  return [...categories];
}

// ─── Worker Fetch ─────────────────────────────────────────────────────────────

/**
 * POST a batch of cards to the Cloudflare Worker and return oracleId → slug[].
 *
 * @param {Array<{oracleId:string, set:string, collectorNumber:string}>} cards
 * @returns {Promise<Map<string, string[]>>}
 */
async function fetchFromWorker(cards) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards }),
    });
    if (res.status !== 429 && res.status !== 503) break;
  }

  if (!res.ok) throw new Error(`Tagger worker error: HTTP ${res.status}`);

  const json = await res.json();
  if (json.error) throw new Error(`Tagger worker: ${json.error}`);

  // Worker returns plain object { [oracleId]: string[] } — convert to Map
  return new Map(Object.entries(json));
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Fetch oracle-tag slugs for a list of cards from the Cloudflare Worker.
 * Gracefully returns empty slug arrays on any failure so enrichment continues.
 *
 * @param {Array<{oracleId:string|null, set:string, collectorNumber:string}>} cards
 * @returns {Promise<{ tags: Map<string, string[]>, failed: boolean }>}
 */
export async function fetchOracleTags(cards) {
  const result = new Map();
  const toFetch = cards.filter(c => c.oracleId && c.set && c.collectorNumber);

  if (toFetch.length === 0) return { tags: result, failed: false };

  const batches = [];
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + BATCH_SIZE));
  }

  let failed = false;

  await Promise.allSettled(batches.map(async batch => {
    try {
      const batchResult = await fetchFromWorker(batch);

      for (const [oracleId, slugs] of batchResult) {
        result.set(oracleId, slugs);
      }

      // Cards missing from the response get empty arrays
      for (const card of batch) {
        if (!result.has(card.oracleId)) result.set(card.oracleId, []);
      }
    } catch (err) {
      console.warn('[mullstat] Tagger worker batch failed:', err.message);
      failed = true;
      for (const card of batch) {
        if (!result.has(card.oracleId)) result.set(card.oracleId, []);
      }
    }
  }));

  return { tags: result, failed };
}
