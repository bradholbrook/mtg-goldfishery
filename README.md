# 🎣 MTG Goldfishery — Commander Simulator

A client-side Commander deck simulator that runs entirely in the browser.
No server, no login, no build step. All computation happens locally.

**Live site:** `https://bradholbrook.github.io/mtg-goldfishery/`

---

## What It Does

### Import & Enrich
- Import a Moxfield Commander decklist (plain-text paste or Moxfield URL)
- Automatically fetches card data from Scryfall (oracle text, CMC, types, keywords)
- Detects card effects via regex and tags them as simulatable or track-only
- Supports Modal Double-Faced Cards (MDFCs) with per-face type and effect data
- Caches all Scryfall data in localStorage (30-day TTL — no repeat fetches)

### Effect Detection
Cards are analyzed for draw and ramp effects at import time:

| Effect | Examples | Simulated? |
|--------|----------|-----------|
| ETB draw | Mulldrifter, Rhystic Oracle | ✅ |
| Upkeep draw | Phyrexian Arena, Howling Mine | ✅ |
| End step draw | Jin-Gitaxias, Alhammarret's Archive | ✅ |
| Tap draw | Azami, Staff of Nin | ✅ |
| Loot (draw+discard) | Faithless Looting, Hazoret's Monument | ✅ |
| Spell resolution draw | Night's Whisper, Harmonize | ✅ |
| Cast trigger draw | Beast Whisperer, Edric | ✅ |
| Land ETB draw | Tatyova, Tireless Tracker | ✅ |
| Mana rocks | Sol Ring, Arcane Signet, Grim Monolith | ✅ |
| Conditional draw | Rhystic Study, Consecrated Sphinx | tracked |
| Sacrifice draws | Greater Good, Life's Legacy | tracked |
| Combat damage draw | Toski, Coastal Piracy | tracked |
| Death triggers | Dark Confidant (upkeep detected) | tracked |

Users can override any auto-detected tag in the Cards tab.

### Simulation
Turn-by-turn goldfish simulation (no opponent decisions):
- **Turn loop:** Untap → Upkeep → Draw → Mana (lands + rocks) → Land → Tap Draw → Cast → End Step → Record
- Greedy play engine: casts highest-priority affordable spells each turn
- Mana rocks tap automatically for mana before the cast phase
- Discard priority rules for loot effects (configurable)
- Commander tax applied to commander recasts
- MDFC land-back selection (sacrifices worst spell face to make land drops)
- Configurable cast priority order and CMC preference

### Opening Hand Analysis
- Simulates N opening hands (100 / 1,000 / 5,000 / 10,000)
- Average cards of each type per opening hand
- % of hands containing at least one of each type
- Custom "Good Hand Definitions" — define criteria for what makes a keepable hand

### Results
- Average cards drawn by turn N (cumulative)
- Effect draw breakdown by card (draws per game from each draw engine)
- % of games with at least one draw effect firing

### Save / Load
- All decks, config, and results saved as a portable `.json` file
- Save version `2.0` with forward-compatible schema

---

## Getting Started (Local)

No build step required. Pure HTML/CSS/JS with ES modules.

```bash
git clone https://github.com/bradholbrook/mtg-goldfishery
cd mtg-goldfishery

./serve.sh          # python3 dev-server.py on port 8080
# or: python3 -m http.server 8080
# open http://localhost:8080
```

---

## Deploying to GitHub Pages

1. Fork or push this repo to your GitHub account
2. Go to **Settings → Pages → Source → GitHub Actions**
3. The included `.github/workflows/deploy.yml` auto-deploys on every push to `main`
4. Your site will be live at `https://yourusername.github.io/mtg-goldfishery/`

---

## Project Structure

```
mtg-goldfishery/
├── index.html              # App shell — single page
├── css/
│   └── style.css           # Dark-mode design system
├── js/
│   ├── app.js              # Entry point, state, event wiring, refresh()
│   ├── types.js            # Typedefs, CARD_TYPES, DEFAULT_STRATEGY_CONFIG
│   ├── parser.js           # Moxfield decklist parser
│   ├── enrichment.js       # Scryfall fetch + localStorage cache
│   ├── effects.js          # Effect tag detection (regex at import time only)
│   ├── effect-types.js     # Effect type registry (draw, loot, mana_rock, etc.)
│   ├── simulator.js        # Turn-by-turn simulation engine
│   ├── criteria.js         # Good Hand Definition criteria registry
│   ├── storage.js          # In-memory appState + save/load JSON
│   ├── ui.js               # Thin shell re-exporting UI modules
│   └── ui/
│       ├── shared.js       # TYPE_COLORS, escapeHtml, formatRelativeTime
│       ├── deck-list.js    # Left-panel deck list
│       ├── overview-tab.js # Deck overview + type breakdown
│       ├── cards-tab.js    # Card list + effect tag editor
│       ├── config-tab.js   # Strategy config + Good Hand Defs + discard priorities
│       └── results-tab.js  # Simulation results + charts
├── tests/
│   ├── helpers.js          # makeCard / makeDeck / makeGoodHandDef factories
│   ├── fixtures.js         # Standard test decks
│   ├── effects.test.js     # Effect detection tests
│   ├── simulator.test.js   # Simulation engine tests
│   └── criteria.test.js    # Good Hand Definition criteria tests
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages deployment
└── README.md
```

---

## Running Tests

```bash
node --test tests/*.test.js   # Node 18+, no npm install required
# or double-click run-tests.command
```

---

## Roadmap

### Done
- Scryfall enrichment with localStorage cache
- MDFC (Modal Double-Faced Card) support with per-face type/effect data
- Turn-by-turn simulation: draw, land drop, tap draw, cast, ETB/upkeep/end step effects
- Loot / rummage / additional-cost discard effects
- Cast trigger effects with spell-type filters (creature, instant/sorcery, etc.)
- Mana rock simulation (Sol Ring, Arcane Signet, etc. contribute to cast budget)
- Configurable discard priorities for loot effects
- Good Hand Definition system (criteria-based opening hand evaluation)
- Card effect editor (override or supplement auto-detected tags)
- Opponent phase modeling (draws and spell casts between our turns)

### Next
- **Land ramp simulation** — Cultivate, Kodama's Reach put lands into play
- **Mana curve stats** — mana available vs. spent by turn N
- **London Mulligan** — draw 7, keep based on Good Hand Definition criteria
- **Multi-draw ETB** — conditional ETB draw filters (CMC ≤ 3, power ≤ 2)

### Later
- Tutor simulation with priority target list
- Win condition tracking (pieces assembled by turn N)
- Deck comparison (run two versions side by side)

---

## Contributing

Issues and PRs welcome. The codebase is deliberately simple:
no build tools, no framework, no npm dependencies.
All logic is plain ES module JS files.
