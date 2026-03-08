# Architecture: Informed Simulation with Card Effects

## 1. Design Principles

**Goldfishing only.** No opponent interaction is modeled. The simulator plays one side of a solitaire game: draw, ramp, cast, trigger.

**Pre-computed tags, not runtime regex.** All oracle-text analysis happens at enrichment time (import). During simulation, the engine reads `effectTags[]` on each card object — it never inspects oracle text strings. This keeps the simulation loop fast enough to run 1,000 10-turn games in under 1 second.

**Unconditional effects first.** Phase 1 resolves only effects that fire unconditionally (ETB draw 1, upkeep draw 1). Conditional effects (Beast Whisperer, Rhystic Study) are tagged `track_only`: they appear in stats but their effects do not fire. This keeps the model honest without requiring opponent-state simulation.

**Scryfall enrichment is part of import.** There is no separate "Enrich Deck" button. When a user imports a deck, cards are immediately looked up in the local cache; misses are batch-fetched from Scryfall. The import button shows a loading state until enrichment finishes.

**No save-file migration.** Save files that include enriched card data (marked with `enriched: true` on the deck) are loaded directly. Old saves without enrichment data will be re-enriched on next import.

---

## 2. Scryfall Enrichment Pipeline

### Import Flow

```
User pastes URL or decklist
       ↓
parseMoxfieldDecklist() / parseMoxfieldApiResponse()
       ↓
enrichDeckWithScryfall(deck)   ← new, in js/enrichment.js
  ├─ Check localStorage for each card name (30-day TTL cache)
  ├─ Batch-fetch cache misses → Scryfall /cards/collection (≤75 per POST)
  │    wait 100ms between batches
  ├─ detectEffectTags(oracleText, keywords) per card  ← new, in js/effects.js
  ├─ Write enriched card data back to localStorage
  └─ Return fully-enriched DeckConfig (deck.enriched = true)
       ↓
addDeck(enrichedDeck)
       ↓
refresh() → renderActiveDeck()
```

### Scryfall Fields Fetched Per Card

| Field | Source | Purpose |
|-------|--------|---------|
| `oracle_text` | Scryfall card object | Effect detection |
| `cmc` | Scryfall card object | Casting cost for greedy cast loop |
| `mana_cost` | Scryfall card object | Phase 2 color tracking |
| `keywords` | Scryfall card object | Keyword-based tag shortcuts |
| `produced_mana` | Scryfall card object | Phase 2 ramp modeling |
| `scryfall_id` | Scryfall card object | Cache key, deduplication |

### Fetch Method

`POST https://api.scryfall.com/cards/collection` with body:
```json
{ "identifiers": [{ "name": "Phyrexian Arena" }, ...] }
```

- Up to 75 cards per POST (Scryfall limit)
- 100ms delay between batches
- Response includes `not_found[]` — those cards get `effectTags: []`, `cmc: null`

### localStorage Cache

- **Key:** `scryfall_card_${cardName.toLowerCase()}`
- **Value:** `{ data: ScryfallCard, cachedAt: ISOString }`
- **TTL:** 30 days — cards not re-fetched if cached, even across different imports
- **Load-from-file:** If `deck.enriched === true`, no Scryfall fetch — enriched data already on card objects

### Failure Handling

Cards that fail Scryfall lookup get:
```js
{ effectTags: [], cmc: null, enriched: false }
```
The simulation degrades gracefully — unenriched cards are treated as spells with no effects.

---

## 3. Card Data Model

The `Card` type gains new fields from enrichment:

```js
/**
 * @typedef {Object} Card
 * @property {string}      name
 * @property {number}      quantity
 * @property {string[]}    types          - ['Creature'], ['Land'], etc.
 * @property {boolean}     isCommander
 * @property {string|null} oracleText     - Full oracle text from Scryfall
 * @property {number|null} cmc            - Converted mana cost
 * @property {string|null} manaCost       - e.g. "{2}{B}{B}"
 * @property {string[]|null} keywords     - e.g. ["Flying", "Deathtouch"]
 * @property {string[]|null} producedMana - e.g. ["B", "G"]
 * @property {string|null} scryfallId     - UUID from Scryfall
 * @property {boolean}     enriched       - true after Scryfall enrichment
 * @property {EffectTag[]} effectTags     - Detected/user-overridden effects
 */
```

### EffectTag Schema

```js
/**
 * @typedef {Object} EffectTag
 * @property {'draw'|'ramp'|'tutor'|'removal'|'token'|'other'} category
 * @property {string}   subtype      - e.g. 'draw_n', 'loot', 'land_fetch', 'add_mana_tap'
 * @property {'etb'|'cast'|'upkeep'|'tap'|'draw_step'|'death'|'passive'} timing
 * @property {number|null} value     - cards drawn, mana added, etc.
 * @property {boolean}  isConditional
 * @property {string|null} condition - human-readable condition description
 * @property {'simulatable'|'simulatable_soon'|'track_only'|'skip'} tier
 * @property {'auto'|'user'} source  - 'user' overrides survive re-enrichment
 */
```

**Tier meanings:**
- `simulatable` — resolves in Phase 1 simulation (ETB draw 1, upkeep draw 1)
- `simulatable_soon` — planned for Phase 2 (ETB draw N>1, cast triggers, loot)
- `track_only` — tagged and counted in stats, effect not fired (conditional draws)
- `skip` — not modeled (opponent-gated, replacement effects)

**User overrides:** Tags with `source: 'user'` are preserved when a deck is re-enriched. Auto-detected tags are replaced; user tags are merged on top.

---

## 4. Effect Detection (`js/effects.js`)

All regex runs once at enrichment time. The exported function returns `EffectTag[]`.

```js
export function detectEffectTags(oracleText, keywords = []) → EffectTag[]
```

### Draw Pattern Library

| Pattern | Subtype | Example Cards |
|---------|---------|---------------|
| `/\bdraw a card\b/i` (unconditional) | `draw_n` (value: 1) | Phyrexian Arena (upkeep), Mulldrifter (ETB) |
| `/\bdraw (two\|three\|four) cards\b/i` | `draw_n` (value: 2/3/4) | Mulldrifter evoke, Harmonize |
| `/\bdraw (\d+) cards?\b/i` | `draw_n` (value: N) | Fact or Fiction |
| `/\byou may draw a card\b/i` | `draw_n` conditional | Welcoming Vampire |
| `/\bdraw a card if\b/i` | `draw_n` conditional | Various |
| `/\bdraw a card for each\b/i` | `draw_n` conditional | Beast Whisperer, Rhystic Study |
| `/\bdraw (?:a\|\d+) cards?,\s*then discard\b/i` | `loot` | Faithless Looting, Tormenting Voice |

### Timing Detection

Timing is determined by the sentence containing the draw pattern, checked against trigger patterns:

| Trigger pattern | Timing value |
|----------------|-------------|
| `/when .* enters/i` (same or preceding sentence) | `etb` |
| `/at the beginning of your upkeep/i` | `upkeep` |
| `/{T}:/` | `tap` |
| `/when you cast/i` | `cast` |
| `/whenever you draw/i` | `draw_step` |
| `/when .* dies/i` | `death` |
| No trigger found | `passive` |

### Tier Assignment

```
isConditional = true  → track_only
timing = 'etb' AND value = 1  → simulatable
timing = 'upkeep' AND value = 1  → simulatable
timing = 'etb' AND value > 1  → simulatable_soon
timing = 'cast'  → simulatable_soon
subtype = 'loot'  → simulatable_soon
else  → track_only
```

### Worked Examples

**Phyrexian Arena** — `"At the beginning of your upkeep, you lose 1 life and draw a card."`
```js
{
  category: 'draw', subtype: 'draw_n', timing: 'upkeep',
  value: 1, isConditional: false, condition: null,
  tier: 'simulatable', source: 'auto'
}
```

**Mulldrifter** — `"When Mulldrifter enters the battlefield, draw two cards."`
```js
{
  category: 'draw', subtype: 'draw_n', timing: 'etb',
  value: 2, isConditional: false, condition: null,
  tier: 'simulatable_soon', source: 'auto'
}
```

**Rhystic Study** — `"Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."`
```js
{
  category: 'draw', subtype: 'draw_n', timing: 'passive',
  value: 1, isConditional: true, condition: 'opponent pays {1}',
  tier: 'track_only', source: 'auto'
}
```

---

## 5. Game State Model

```js
/**
 * @typedef {Object} BattlefieldCard
 * @property {Card}    card
 * @property {boolean} tapped
 * @property {number}  turnEntered
 */

/**
 * @typedef {Object} GameState
 * @property {Card[]}            library           - top = index 0
 * @property {Card[]}            hand
 * @property {BattlefieldCard[]} battlefield
 * @property {Card[]}            graveyard
 * @property {Card[]}            commandZone
 * @property {number}            turn
 * @property {boolean}           landPlayedThisTurn
 * @property {number}            landDropsAvailable
 * @property {number}            manaAvailable     - total CMC-level mana (color tracking in Phase 2)
 * @property {number}            commanderCastCount
 * @property {TurnRecord}        currentTurnRecord
 * @property {TurnRecord[]}      turnHistory
 * @property {boolean}           deckedOut
 */

/**
 * @typedef {Object} TurnRecord
 * @property {number}   turn
 * @property {Card[]}   cardsDrawn
 * @property {Card[]}   landsPlayed
 * @property {Card[]}   spellsCast
 * @property {number}   manaSpent
 * @property {string[]} effectsFired   - e.g. ['Phyrexian Arena:upkeep:draw']
 */
```

---

## 6. Turn Simulation Loop

Each game runs for `strategyConfig.maxTurns` turns (default: 10). Turns run: **Untap → Upkeep → Draw → Mana → Land → Cast → Record**.

```
for turn = 1 to maxTurns:
  Untap:     untap all permanents on battlefield
  Upkeep:    for each permanent with timing='upkeep' simulatable tag:
               fire effect (e.g. draw 1 card)
               record in currentTurnRecord.effectsFired
  Draw:      draw 1 card from library
               if library empty → set deckedOut = true, break
  Mana:      manaAvailable = sum of lands on battlefield
  Land:      find first land in hand; if found, play it (enters untapped, manaAvailable += 1)
  Cast loop: repeat until no affordable spell found:
               score hand cards by castPriority category, break ties by CMC
               if highest-priority affordable card exists:
                 remove from hand, add to battlefield
                 fire ETB simulatable effects (e.g. draw 1)
                 deduct CMC from manaAvailable
                 record in currentTurnRecord.spellsCast
  Record:    push currentTurnRecord into turnHistory
```

### Greedy Casting Details

- **Priority:** user-configured `StrategyConfig.castPriority` (default: `['ramp', 'draw', 'tutor', 'creature', 'enchantment', 'artifact', 'sorcery', 'instant', 'other']`)
- Scoring: category index in priority list (lower = higher priority). Ties broken by CMC (lower CMC cast first when `preferLowCMC: true`)
- Lands are never cast through this loop — they're played in the Land step
- Commander tax: cost = `card.cmc + (commanderCastCount * 2)` when `castCommanderWhenAble: true`

### ETB and Upkeep Effect Resolution (Phase 1)

Only tags with `tier: 'simulatable'` fire. Phase 1 simulatable effects:
- `{ timing: 'etb', category: 'draw', value: 1 }` → draw 1 card (available next turn)
- `{ timing: 'upkeep', category: 'draw', value: 1 }` → draw 1 card at upkeep

Cards drawn mid-turn (ETB, upkeep) are available for casting **next turn** in Phase 1. This conservative model prevents compounding complexity.

### Conditional Effects (`track_only`)

Tags with `tier: 'track_only'` do not fire, but their presence is counted for stats:
- `pctGamesWithDrawEffect` counts games where at least one `track_only` draw source is in play
- `drawEffectSourceBreakdown` tallies turns each `track_only` source was active on the battlefield

---

## 7. Strategy Configuration

```js
/**
 * @typedef {Object} StrategyConfig
 * @property {string[]} castPriority        - ordered category list, highest priority first
 * @property {'any'|'basic_first'|'dual_first'} landPriority
 * @property {number}   maxTurns            - default: 10
 * @property {boolean}  preferLowCMC        - tiebreaker within same priority category
 * @property {boolean}  castCommanderWhenAble
 */
```

**Default:**
```js
{
  castPriority: ['ramp', 'draw', 'tutor', 'creature', 'enchantment', 'artifact', 'sorcery', 'instant', 'other'],
  landPriority: 'any',
  maxTurns: 10,
  preferLowCMC: true,
  castCommanderWhenAble: false
}
```

`StrategyConfig` is stored on `DeckConfig.strategyConfig`. The simulation always has a config — app code merges deck config over the default.

---

## 8. New Summary Statistics

The `summary` object returned by `runSimulation()` gains these fields when turn-by-turn simulation runs:

```js
summary {
  // Existing fields preserved:
  avgTypeCounts, typeSeenPct, goodLandHandPct, deckTypeDistribution,
  totalCardsInDeck, goodHandDefPcts, goodHandAnyPct,

  // New turn-aware fields:
  avgCardsDrawnByTurn: {          // cumulative total cards drawn (hand + draws), keyed by turn number
    3: 10.2,                      // hand(7) + draw(3) + effect draws
    5: 13.8,
    10: 19.4
  },
  avgEffectDrawsPerGame: number,  // avg cards drawn via ETB/upkeep effects across all games
  pctGamesWithDrawEffect: number, // % of games where ≥1 draw engine was ever on battlefield
  drawEffectSourceBreakdown: {    // avg draws contributed per card name per game
    'Phyrexian Arena': 3.2,
    'Mulldrifter': 1.0,
  }
}
```

When turn-by-turn simulation is not available (unenriched deck), only opening-hand stats are computed. The UI renders both stat blocks when present.

---

## 9. File Map

| File | Role |
|------|------|
| `js/effects.js` | `detectEffectTags(oracleText, keywords)` — full regex library |
| `js/enrichment.js` | `enrichDeckWithScryfall(deck, onProgress)` — fetch, cache, tag |
| `js/types.js` | Typedefs for `EffectTag`, `BattlefieldCard`, `GameState`, `TurnRecord`, `StrategyConfig`; save version `2.0` |
| `js/simulator.js` | Turn-by-turn game loop, `GameState` management, effect resolution, updated summary |
| `js/storage.js` | No schema migration — enriched save files are the new baseline |
| `js/ui.js` | Import loading state, turn-by-turn stats panels in results |
| `js/app.js` | Enrichment wired into both import paths; `deck.enriched` check on load-from-file |

---

## 10. Phase Roadmap

| Phase | Scope | Key Deliverable |
|-------|-------|-----------------|
| 1 | Scryfall enrichment + ETB/upkeep draw 1 + turn loop foundation | `effects.js`, `enrichment.js`, extended `simulator.js` |
| 2 | Ramp (mana rocks, land fetch) + cast triggers + multi-draw ETB | Mana curve stats, ramp modeling |
| 3 | London Mulligan (keep rule = GoodHandDef) | Mulligan stats |
| 4 | Tutor simulation with priority target list | Win-piece assembly tracking |
| 5 | Win condition tracking (pieces assembled by turn N) | % games assembled by turn N |

---

## 11. Verification Checklist

1. Import a Moxfield URL → confirm loading state shows in sidebar during fetch
2. After import, confirm `oracleText`, `cmc`, `effectTags` appear on card objects in app state
3. Confirm Phyrexian Arena gets `{ category: 'draw', timing: 'upkeep', value: 1, tier: 'simulatable' }`
4. Confirm Mulldrifter gets `{ category: 'draw', timing: 'etb', value: 2, tier: 'simulatable_soon' }`
5. Confirm Rhystic Study gets `{ isConditional: true, tier: 'track_only' }`
6. Run simulation on enriched deck → confirm `summary.avgCardsDrawnByTurn` is populated
7. Run simulation on unenriched deck → confirm opening-hand stats still render correctly
8. Save enriched deck → reload file → confirm no Scryfall re-fetch occurs (`deck.enriched === true`)
9. Import same card name in two different decks → confirm only one Scryfall fetch (cache hit on second)
10. Simulate a deck with no draw engines → confirm `avgEffectDrawsPerGame ≈ 0`
