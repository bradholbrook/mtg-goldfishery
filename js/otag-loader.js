/**
 * mullstat - Scryfall Otag Loader
 *
 * Fetches Scryfall oracle tag / function tag sets for each canonical category.
 * Called once on app launch; results cached in localStorage with a 30-day TTL.
 *
 * At card enrichment time, call resolveCategories(oracleId) to get the
 * canonical category list for a card.
 *
 * Exported: loadOtagData(), resolveCategories(oracleId), getOtagSets()
 */

const CACHE_PREFIX    = 'mullstat_otag_';
const CACHE_TTL_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days
const SEARCH_BASE_URL = 'https://api.scryfall.com/cards/search';
const REQUEST_DELAY_MS = 100;

/**
 * Scryfall search query for each canonical category.
 * unique:oracle ensures one result per unique card effect (no reprints),
 * which keeps page counts manageable.
 */
const CATEGORY_QUERIES = [
  { category: 'Ramp',       query: 'function:ramp unique:oracle' },
  { category: 'Card Draw',  query: 'function:draw unique:oracle' },
  { category: 'Interaction', query: '(function:removal or function:counterspell) unique:oracle' },
  { category: 'Board Wipe', query: 'otag:boardwipe unique:oracle' },
  { category: 'Tutor',      query: 'otag:tutor unique:oracle' },
  { category: 'Mill',       query: 'otag:mill unique:oracle' },
  { category: 'Cascade',    query: 'keyword:cascade unique:oracle' },
  { category: 'Discover',   query: 'o:discover unique:oracle' },
];

// ─── Cache ────────────────────────────────────────────────────────────────────

function cacheKey(category) {
  return CACHE_PREFIX + category.toLowerCase().replace(/\s+/g, '_');
}

function readCache(category) {
  try {
    const raw = localStorage.getItem(cacheKey(category));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.ids || !entry?.cachedAt) return null;
    if (Date.now() - new Date(entry.cachedAt).getTime() > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(category));
      return null;
    }
    return new Set(entry.ids);
  } catch {
    return null;
  }
}

function writeCache(category, ids) {
  try {
    localStorage.setItem(cacheKey(category), JSON.stringify({
      ids: [...ids],
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // localStorage full — skip caching silently
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all paginated results for a Scryfall search query.
 * Extracts oracle_id from each card and returns a Set.
 *
 * @param {string} query
 * @returns {Promise<Set<string>>}
 */
async function fetchAllOracleIds(query) {
  const ids = new Set();
  let url = `${SEARCH_BASE_URL}?q=${encodeURIComponent(query)}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) break; // query returned no results
      throw new Error(`Scryfall search failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    for (const card of (json.data || [])) {
      if (card.oracle_id) ids.add(card.oracle_id);
    }
    url = json.has_more ? json.next_page : null;
    if (url) await sleep(REQUEST_DELAY_MS);
  }

  return ids;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

/** Map<category, Set<oracle_id>> — populated by loadOtagData(). */
let _otagSets = null;

/** The in-flight (or resolved) promise from loadOtagData(). */
let _loadPromise = null;

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Return a promise that resolves when otag data is fully loaded.
 * Rejects if loadOtagData() was never called or if loading failed.
 *
 * @returns {Promise<Map<string, Set<string>>>}
 */
export function waitForOtagData() {
  if (!_loadPromise) return Promise.reject(new Error('Category data not initialised — loadOtagData() was not called.'));
  return _loadPromise;
}

/**
 * Return the loaded otag sets, or null if not yet loaded.
 * @returns {Map<string, Set<string>>|null}
 */
export function getOtagSets() {
  return _otagSets;
}

/**
 * Resolve canonical categories for a card given its oracle_id.
 * Returns [] if otag data is not yet loaded or oracle_id is missing.
 *
 * @param {string|null} oracleId
 * @returns {string[]}
 */
export function resolveCategories(oracleId) {
  if (!_otagSets || !oracleId) return [];
  const categories = [];
  for (const [category, ids] of _otagSets) {
    if (ids.has(oracleId)) categories.push(category);
  }
  return categories;
}

/**
 * Run supplemental otag queries for cards not found in any cached set.
 * Called when a deck contains cards newer than the last cache population.
 * Updates _otagSets in memory and refreshes localStorage for each category
 * that gains new members.
 *
 * Uses exact-name search (!"Name") which is guaranteed to work regardless
 * of whether Scryfall exposes oracle_id as a search filter.
 *
 * @param {string[]} cardNames - names of uncategorized cards to look up
 */
export async function supplementOtagLookup(cardNames) {
  if (!cardNames.length || !_otagSets) return;

  // Build an OR-joined exact-name filter, stripping any stray quotes from names
  const nameFilter = cardNames
    .map(n => `!"${n.replace(/"/g, '')}"`)
    .join(' OR ');

  await Promise.allSettled(
    CATEGORY_QUERIES.map(async ({ category, query }) => {
      // Strip unique:oracle before appending the name filter —
      // exact name lookup already returns one oracle result per name.
      const baseQuery = query.replace(/\s*unique:oracle/gi, '').trim();
      const filteredQuery = `${baseQuery} (${nameFilter})`;
      try {
        const found = await fetchAllOracleIds(filteredQuery);
        if (found.size > 0) {
          const existing = _otagSets.get(category) ?? new Set();
          for (const id of found) existing.add(id);
          _otagSets.set(category, existing);
          writeCache(category, existing);
        }
      } catch (err) {
        console.warn(`[mullstat] supplemental otag lookup failed for "${category}":`, err.message);
      }
    })
  );
}

/**
 * Load all otag sets. Checks localStorage cache first; fetches missing ones.
 * Safe to call without await — errors are caught per-category.
 *
 * Populates the module-level _otagSets map so resolveCategories() works
 * for all subsequent enrichment calls in the same session.
 *
 * @param {function(string):void} [onProgress]
 * @returns {Promise<Map<string, Set<string>>>}
 */
export function loadOtagData(onProgress = null) {
  _loadPromise = _doLoadOtagData(onProgress);
  return _loadPromise;
}

async function _doLoadOtagData(onProgress = null) {
  const notify = msg => { if (onProgress) onProgress(msg); };
  const sets = new Map();
  const toFetch = [];

  // Read from cache
  for (const { category } of CATEGORY_QUERIES) {
    const cached = readCache(category);
    if (cached) {
      sets.set(category, cached);
    } else {
      toFetch.push(category);
    }
  }

  if (toFetch.length === 0) {
    _otagSets = sets;
    return sets;
  }

  notify(`Loading card categories (${toFetch.length} to fetch)…`);

  await Promise.allSettled(
    CATEGORY_QUERIES
      .filter(({ category }) => toFetch.includes(category))
      .map(async ({ category, query }) => {
        try {
          const ids = await fetchAllOracleIds(query);
          writeCache(category, ids);
          sets.set(category, ids);
        } catch (err) {
          console.warn(`[mullstat] otag load failed for "${category}":`, err.message);
          sets.set(category, new Set()); // empty — won't match anything this session
        }
      })
  );

  _otagSets = sets;
  notify('Category data loaded.');
  return sets;
}
