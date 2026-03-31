/**
 * mullstat - Scryfall Tagger Proxy Worker
 *
 * Proxies requests to the Scryfall Tagger GraphQL API, handling the
 * session/CSRF dance that browsers can't do directly.
 *
 * POST /
 *   Body: { cards: [{ set: "eld", collectorNumber: "10", oracleId: "..." }, ...] }
 *   Returns: { [oracleId]: string[] }  — oracle tags per card
 *
 * Deploy: wrangler deploy
 */

const TAGGER_HOME    = 'https://tagger.scryfall.com';
const TAGGER_GRAPHQL = 'https://tagger.scryfall.com/graphql';
const BATCH_SIZE     = 15; // Tagger GraphQL complexity limit: ~6/card, max 100

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://bradholbrook.github.io',
  'http://localhost:8080',
  'http://localhost:8000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8000',
  'null', // file:// origins (local dev without server)
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ─── Tagger Session ───────────────────────────────────────────────────────────

/**
 * Fetch the Tagger home page and extract the session cookie + CSRF token.
 * Must be done in a single fetch so the cookie and token come from the same session.
 *
 * @returns {{ sessionCookie: string, csrfToken: string }}
 */
async function getSessionAndToken() {
  const res = await fetch(TAGGER_HOME, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) throw new Error(`Tagger home fetch failed: HTTP ${res.status}`);

  // The session cookie comes back in Set-Cookie — grab the full value
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sessionMatch = setCookie.match(/_scryfall_tagger_session=([^;]+)/);
  if (!sessionMatch) throw new Error('No session cookie in Tagger response');
  const sessionCookie = `_scryfall_tagger_session=${sessionMatch[1]}`;

  // CSRF token is in a <meta> tag in the HTML
  const html = await res.text();
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i)
                 ?? html.match(/content="([^"]+)"\s+name="csrf-token"/i);
  if (!csrfMatch) throw new Error('No CSRF token found in Tagger page HTML');

  return { sessionCookie, csrfToken: csrfMatch[1] };
}

// ─── Tagger GraphQL ───────────────────────────────────────────────────────────

/**
 * Query the Tagger GraphQL endpoint with a batch of cards.
 * Uses aliased fields (card0, card1, …) to fetch all in one round-trip.
 *
 * @param {Array<{set:string, collectorNumber:string, oracleId:string}>} cards
 * @param {string} sessionCookie
 * @param {string} csrfToken
 * @returns {Promise<Record<string, string[]>>} oracleId → slug[]
 */
async function queryTaggerBatch(cards, sessionCookie, csrfToken) {
  const aliases = cards.map((c, i) =>
    `card${i}: cardBySet(set: ${JSON.stringify(c.set)}, number: ${JSON.stringify(c.collectorNumber)}) {
      oracleId
      taggings { classifier tag { slug } }
    }`
  );

  const query = `query { ${aliases.join('\n')} }`;

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt * 1000));
      ({ sessionCookie, csrfToken } = await getSessionAndToken());
    }
    res = await fetch(TAGGER_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie':       sessionCookie,
        'User-Agent':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer':      TAGGER_HOME,
      },
      body: JSON.stringify({ query }),
    });
    if (res.status !== 429) break;
  }

  if (!res.ok) throw new Error(`Tagger GraphQL error: HTTP ${res.status}`);

  const json = await res.json();
  const firstAlias = Object.keys(json.data ?? {})[0];
  console.log('[tagger-worker] first card raw:', firstAlias, JSON.stringify(json.data?.[firstAlias])?.slice(0, 300));
  if (json.errors) console.log('[tagger-worker] graphql errors:', JSON.stringify(json.errors).slice(0, 300));

  const result = {};

  // Key by alias index → input card's oracleId (not Tagger's, which may differ).
  for (const [alias, cardData] of Object.entries(json.data ?? {})) {
    const idx = parseInt(alias.replace('card', ''), 10);
    const inputOracleId = cards[idx]?.oracleId;
    if (!inputOracleId || !cardData) continue;
    result[inputOracleId] = (cardData.taggings ?? [])
      .filter(t => t.classifier === 'ORACLE_CARD_TAG')
      .map(t => t.tag.slug)
      .filter(Boolean);
  }

  return result;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, _env, _ctx) {
    const origin = request.headers.get('Origin') ?? '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let cards;
    try {
      ({ cards } = await request.json());
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders(origin) });
    }

    if (!Array.isArray(cards) || cards.length === 0) {
      return Response.json({ error: 'cards array required' }, { status: 400, headers: corsHeaders(origin) });
    }

    try {
      const allSlugs = {};

      // Process in batches, getting a fresh session per batch
      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const batch = cards.slice(i, i + BATCH_SIZE);
        const { sessionCookie, csrfToken } = await getSessionAndToken();
        const batchResult = await queryTaggerBatch(batch, sessionCookie, csrfToken);
        Object.assign(allSlugs, batchResult);
      }

      // Fill in empty arrays for any cards not returned by Tagger
      for (const card of cards) {
        if (card.oracleId && !(card.oracleId in allSlugs)) {
          allSlugs[card.oracleId] = [];
        }
      }

      return Response.json(allSlugs, { headers: corsHeaders(origin) });

    } catch (err) {
      console.error('[tagger-worker]', err.message);
      return Response.json(
        { error: err.message },
        { status: 502, headers: corsHeaders(origin) }
      );
    }
  },
};
