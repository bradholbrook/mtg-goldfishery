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
User will manually perform validation steps, simply present them.

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
| `js/ui.js` | Thin shell: re-exports from `js/ui/*`. Contains `renderActiveDeck`, `setImportLoading`, `showToast`. |
| `js/ui/shared.js` | `TYPE_COLORS`, `escapeHtml`, `formatRelativeTime` |
| `js/ui/deck-list.js` | `renderDeckList` |
| `js/ui/overview-tab.js` | `buildOverviewTab` |
| `js/ui/cards-tab.js` | `buildCardsTab` + card effect editor |
| `js/ui/config-tab.js` | `buildConfigTab` + good hand def editor + discard priorities |
| `js/ui/results-tab.js` | `buildResultsTab` + charts |

### UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│ 🐟 MTG Goldfishery                           ↑ Load  ↓ Save  │
├───────────────┬──────────────────────────────────────────────┤
│  + Import     │  [Overview]  [Cards]  [Config]  [Simulate]   │
│  My Decks     ├──────────────────────────────────────────────┤
│  Deck 1  ●    │  (active tab content)                        │
└───────────────┴──────────────────────────────────────────────┘
```

`app.js` holds `activeTab = 'overview' | 'cards' | 'config' | 'results'`.

### Key Patterns

**`refresh()` pattern:** After every mutation, `app.js` calls `refresh()` which re-renders from appState.

**Event delegation:** HTML templates use `data-action` / `data-*` attributes. One listener on `#active-deck` dispatches to handlers. No `onclick=` on elements.

**CRITERION_TYPES registry** (`criteria.js`): Add one entry → UI, evaluation, and save/load all work automatically. Replicate for any new extensible feature type.

**Pre-computed tags:** `effects.js` runs at import time. Simulation reads `card.effectTags[]`, never oracle text.

**Effect tiers:** `simulatable` | `simulatable_soon` | `track_only` | `skip`.

**CORS proxy:** Moxfield API: `CORS_PROXY = 'https://corsproxy.io/?url='` in `app.js`.

### Card Data Model

```js
Card {
  name, quantity, types, isCommander,           // from parser
  oracleText, cmc, manaCost, keywords,          // from Scryfall
  producedMana, scryfallId, enriched,
  effectTags[],   // merged from all faces; source:'auto'|'user'
  isMDFC, faces,  // MDFC-only; faces: [{name, types, oracleText, cmc, manaCost, effectTags}]
}
```

`card.types` includes all face types + `'MDFC'` sentinel for modal DFCs. Multi-type non-MDFCs (e.g. Urza's Saga) get all matching types. Type counts intentionally exceed card count.

### Save File Schema

Version `"2.0"` (`CURRENT_SAVE_VERSION` in `js/types.js`). Bump + migrate in `storage.js` on breaking changes. Additive fields don't need a bump.

### Simulation

Turn loop: **Untap → Upkeep → Draw → Mana (lands + mana rocks) → Land (+ land_etb) → Tap Draw → Cast (+ cast triggers) → End Step → Record**

`runSimulation(deck, gameCount, goodHandDefs)` — no DOM/localStorage.

Phase 1 fires `tier: 'simulatable'` effects only. Cards drawn mid-turn available next turn (conservative).

Mana rocks with a simulatable `mana_rock` tag are tapped automatically in the Mana phase and add their `value` to `gs.manaAvailable`. Lands are counted but not individually marked tapped (pool model).

### Test Suite

```bash
node --test tests/*.test.js   # Node 18+, no npm install
# or double-click run-tests.command
```

### Phase Roadmap

| Phase | Scope |
|-------|-------|
| 1 ✓ | Scryfall enrichment, ETB/upkeep/end-step draw, turn loop, MDFC support, loot/discard, cast triggers, mana rock simulation |
| 2 | Land ramp simulation (Cultivate etc.), multi-draw ETB condition filters, mana curve stats |
| 3 | London Mulligan (keep rule = GoodHandDef criteria) |
| 4 | Tutor simulation with priority target list |
| 5 | Win condition tracking (pieces assembled by turn N) |
