var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-fW2Bhu/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// index.js
var TAGGER_HOME = "https://tagger.scryfall.com";
var TAGGER_GRAPHQL = "https://tagger.scryfall.com/graphql";
var BATCH_SIZE = 15;
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://bradholbrook.github.io",
  "http://localhost:8080",
  "http://localhost:8000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8000",
  "null"
  // file:// origins (local dev without server)
]);
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
async function getSessionAndToken() {
  const res = await fetch(TAGGER_HOME, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error(`Tagger home fetch failed: HTTP ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sessionMatch = setCookie.match(/_scryfall_tagger_session=([^;]+)/);
  if (!sessionMatch) throw new Error("No session cookie in Tagger response");
  const sessionCookie = `_scryfall_tagger_session=${sessionMatch[1]}`;
  const html = await res.text();
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i) ?? html.match(/content="([^"]+)"\s+name="csrf-token"/i);
  if (!csrfMatch) throw new Error("No CSRF token found in Tagger page HTML");
  return { sessionCookie, csrfToken: csrfMatch[1] };
}
__name(getSessionAndToken, "getSessionAndToken");
async function queryTaggerBatch(cards, sessionCookie, csrfToken) {
  const aliases = cards.map(
    (c, i) => `card${i}: cardBySet(set: ${JSON.stringify(c.set)}, number: ${JSON.stringify(c.collectorNumber)}) {
      oracleId
      taggings { classifier tag { slug } }
    }`
  );
  const query = `query { ${aliases.join("\n")} }`;
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * 1e3));
      ({ sessionCookie, csrfToken } = await getSessionAndToken());
    }
    res = await fetch(TAGGER_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Cookie": sessionCookie,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": TAGGER_HOME
      },
      body: JSON.stringify({ query })
    });
    if (res.status !== 429) break;
  }
  if (!res.ok) throw new Error(`Tagger GraphQL error: HTTP ${res.status}`);
  const json = await res.json();
  const firstAlias = Object.keys(json.data ?? {})[0];
  console.log("[tagger-worker] first card raw:", firstAlias, JSON.stringify(json.data?.[firstAlias])?.slice(0, 300));
  if (json.errors) console.log("[tagger-worker] graphql errors:", JSON.stringify(json.errors).slice(0, 300));
  const result = {};
  for (const [alias, cardData] of Object.entries(json.data ?? {})) {
    const idx = parseInt(alias.replace("card", ""), 10);
    const inputOracleId = cards[idx]?.oracleId;
    if (!inputOracleId || !cardData) continue;
    result[inputOracleId] = (cardData.taggings ?? []).filter((t) => t.classifier === "ORACLE_CARD_TAG").map((t) => t.tag.slug).filter(Boolean);
  }
  return result;
}
__name(queryTaggerBatch, "queryTaggerBatch");
var index_default = {
  async fetch(request, _env, _ctx) {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    let cards;
    try {
      ({ cards } = await request.json());
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders(origin) });
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return Response.json({ error: "cards array required" }, { status: 400, headers: corsHeaders(origin) });
    }
    try {
      const allSlugs = {};
      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const batch = cards.slice(i, i + BATCH_SIZE);
        const { sessionCookie, csrfToken } = await getSessionAndToken();
        const batchResult = await queryTaggerBatch(batch, sessionCookie, csrfToken);
        Object.assign(allSlugs, batchResult);
      }
      for (const card of cards) {
        if (card.oracleId && !(card.oracleId in allSlugs)) {
          allSlugs[card.oracleId] = [];
        }
      }
      return Response.json(allSlugs, { headers: corsHeaders(origin) });
    } catch (err) {
      console.error("[tagger-worker]", err.message);
      return Response.json(
        { error: err.message },
        { status: 502, headers: corsHeaders(origin) }
      );
    }
  }
};

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-fW2Bhu/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = index_default;

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-fW2Bhu/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
