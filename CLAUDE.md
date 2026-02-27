# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Development Setup

No build step. Pure HTML/CSS/JS with ES modules — requires an HTTP server (`file://` blocks ES modules).

```bash
./serve.sh          # python3 dev-server.py on port 8080
# or: python3 -m http.server 8080
# open http://localhost:8080
```

Pushing to `main` auto-deploys via `.github/workflows/deploy.yml` to GitHub Pages.

**Don't `git push` or `git commit` without asking.**
Instrument the app for debugging instead of trying to replicate it with manual tests like `curl`.

## Architecture

Client-side only. No backend, no build tools, no framework, no npm.

### Module Responsibilities

| File | Role |
|------|------|
| `js/app.js` | Entry point. `activeDeckId` + `activeTab` state. All event wiring. Calls `refresh()` after every mutation. |
| `js/types.js` | JSDoc typedefs, `CARD_TYPES`, `DEFAULT_STRATEGY_CONFIG`, `CURRENT_SAVE_VERSION`, `generateId()`. |
| `js/parser.js` | Parses Moxfield plain-text or API response into `DeckConfig`. |
| `js/effects.js` | `detectEffectTags(oracleText, keywords)` — all regex compiled at import, never at sim time. |
| `js/enrichment.js` | Scryfall fetch + localStorage cache. `typeLineToTypes()` for multi-type extraction. MDFC face data. |
| `js/simulator.js` | Turn-by-turn game loop and opening-hand simulation. No DOM/localStorage — safe for Web Worker migration. |
| `js/storage.js` | In-memory `appState` singleton. Save/load `.json` file. |
| `js/criteria.js` | `CRITERION_TYPES` registry for Good Hand Definition criteria. Canonical registry pattern. |
| `js/ui.js` | All UI rendering — deck list, active deck panel, simulation results, Good Hand editor. |

### UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│ 🐟 MTG Goldfishery                           ↑ Load  ↓ Save  │
├───────────────┬──────────────────────────────────────────────┤
│  + Import     │  [Overview]  [Cards]  [Config]  [Results]    │
│  My Decks     ├──────────────────────────────────────────────┤
│  Deck 1  ●    │  (active tab content)                        │
└───────────────┴──────────────────────────────────────────────┘
```

`app.js` holds `activeTab = 'overview' | 'cards' | 'config' | 'results'`.

### Data Flow

```
User pastes URL or decklist
  → parser.js
  → enrichment.js
      ├─ localStorage cache (key: scryfall_card_${name.toLowerCase()}, 30-day TTL)
      ├─ Scryfall POST /cards/collection (≤75/batch, 100ms between batches)
      ├─ typeLineToTypes() → card.types[] (all face types; MDFCs include 'MDFC')
      └─ effects.js detectEffectTags() → effectTags[]
  → storage.js addDeck()
  → ui.js refresh()
```

### Key Patterns

**`refresh()` pattern:** After every mutation, `app.js` calls `refresh()` which re-renders from appState.

**Event delegation:** HTML templates use `data-action` / `data-*` attributes. One listener on `#active-deck` dispatches to handlers. No `onclick=` on elements, no global pollution.

**CRITERION_TYPES registry** (`criteria.js`): Add one entry → UI, evaluation, and save/load all work automatically. Replicate for any new extensible feature type.

**User override precedence:** `effectTags[].source = 'user'` survives re-enrichment. Card-level overrides live in `card.userOverrides` — Scryfall data is never mutated in place.

**Pre-computed tags:** `effects.js` runs at import time. Simulation reads `card.effectTags[]`, never oracle text.

**Effect tiers:** `simulatable` (fires in sim) | `simulatable_soon` (planned) | `track_only` (stats only) | `skip`.

**CORS proxy:** Moxfield API has no CORS headers. `CORS_PROXY = 'https://corsproxy.io/?url='` in `app.js`.

### Card Data Model

```js
Card {
  // From parser:
  name, quantity, types, isCommander,
  // From Scryfall enrichment:
  oracleText,       // front face oracle text
  cmc,              // spell-face CMC (for MDFCs: front/non-land face)
  manaCost, keywords, producedMana, scryfallId, enriched,
  effectTags[],     // merged from all faces; source:'user' survives re-enrichment
  // MDFC fields (layout === 'modal_dfc'):
  isMDFC,           // true for modal double-faced cards
  faces: [{         // per-face data; null for single-faced cards
    name, types, oracleText, cmc, manaCost, effectTags
  }],
  // User overrides (persist in save file, survive re-enrichment):
  userOverrides: {
    types: null,    // string[] — overrides card.types in sim + display
    cmc:   null,    // number
    manaCost: null,
    tags:  [],      // string[] — custom labels: ['combo piece', 'wincon']
  }
}
```

**`card.types` for multi-type cards:**
- Regular: `['Creature']`, `['Land']`, etc.
- Multi-type (Urza's Saga): `['Land', 'Enchantment']`
- MDFC (Shatterskull Smashing // Land): `['Sorcery', 'Land', 'MDFC']`
- Type breakdown counts each card toward ALL its types — totals intentionally exceed card count.

**`CARD_TYPES`** (order matters for UI):
`Land, Creature, Instant, Sorcery, Artifact, Enchantment, Planeswalker, Battle, MDFC, Other`

### MDFC Simulation Behavior

Turn loop land phase: pure land first → if none, pick the MDFC land-back with the **worst `castScore()`** (highest score = least valuable spell face to sacrifice). This keeps higher-priority MDFC spell faces in hand.

Cast loop: `isCastableAsSpell(card)` returns true if any face is not a land — MDFCs with a spell+land face ARE castable as spells. `effectiveCost()` uses spell-face CMC. `isPermanent` check uses spell-face types (Sorcery // Land cast as sorcery → graveyard).

Key sim helpers in `simulator.js`: `isPureLand`, `getMDFCSpellFace`, `getMDFCLandFace`, `isCastableAsSpell`, `countCardTypesForBreakdown`.

### Save File Schema

Current version: `"2.0"` (`CURRENT_SAVE_VERSION` in `js/types.js`). Bump + add migration to `storage.js` whenever Card or DeckConfig shape changes incompatibly. Additive new fields (like `isMDFC`, `faces`) do not require a bump.

### Simulation

Turn loop: **Untap → Upkeep → Draw → Mana → Land → Tap Draw → Cast → Record** for `maxTurns` turns.

`runSimulation(deck, gameCount, goodHandDefs)` — no DOM/localStorage, safe for Web Worker migration.

Phase 1 fires `tier: 'simulatable'` effects only: ETB draw-1, upkeep draw-1, tap-draw. Cards drawn mid-turn available next turn (conservative model).

### Phase Roadmap

| Phase | Scope |
|-------|-------|
| 1 ✓ | Scryfall enrichment, ETB/upkeep draw-1, turn loop, MDFC support |
| 2 | Ramp (mana rocks, land fetch), multi-draw ETB, cast triggers, mana curve stats |
| 3 | London Mulligan (keep rule = GoodHandDef criteria) |
| 4 | Tutor simulation with priority target list |
| 5 | Win condition tracking (pieces assembled by turn N) |
