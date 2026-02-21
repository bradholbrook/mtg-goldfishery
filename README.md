# 🎣 MTG Goldfish — Commander Simulator

A client-side Commander deck simulator that runs entirely in the browser.
No server, no login, no ads. All computation happens locally.

**Live site:** `https://bradholbrook.github.io/mtg-goldfishery/`

---

## What It Does (v1.0 — MVP)

- **Import** a Moxfield Commander decklist (plain-text paste)
- **Simulate** N opening hands (100 / 1,000 / 5,000 / 10,000 games)
- **Report** card type breakdown across simulated hands:
  - Average cards of each type seen in opening hand
  - % of hands containing at least one of each type
  - % of "good land hands" (2–4 lands)
  - Deck composition by card type
- **Save / Load** all decks and results as a portable `.json` file

---

## Getting Started (Local)

No build step required. This is pure HTML/CSS/JS with ES modules.

```bash
git clone https://github.com/bradholbrook/mtg-goldfishery
cd mtg-goldfishery

# Serve locally (required for ES modules — can't open index.html directly)
python3 -m http.server 8080
# or: npx serve .
# then open http://localhost:8080
```

---

## Deploying to GitHub Pages

1. Fork or push this repo to your GitHub account
2. Go to **Settings → Pages → Source → GitHub Actions**
3. The included `.github/workflows/deploy.yml` will auto-deploy on every push to `main`
4. Your site will be live at `https://bradholbrook.github.io/mtg-goldfishery/`

---

## Project Structure

```
mtg-goldfishery/
├── index.html              # App shell — single page
├── css/
│   └── style.css           # Dark-mode design system
├── js/
│   ├── types.js            # Data structure definitions & constants
│   ├── parser.js           # Moxfield decklist parser
│   ├── simulator.js        # Simulation engine
│   ├── storage.js          # In-memory state + save/load
│   ├── ui.js               # DOM rendering
│   └── app.js              # Entry point, event wiring
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages deployment
└── README.md
```

---

## Roadmap

### v1.1 — Scryfall Enrichment
- Fetch real card types, CMC, mana cost from Scryfall API on import
- Replace name-based type guessing with accurate data
- Cache card data in localStorage to avoid repeat fetches
- Identify lands, ramp, draw, tutors, removal automatically

### v1.2 — Turn Simulation
- Simulate turns 1–10 (draw step, play land, cast spells)
- Generic greedy play engine (highest CMC affordable first)
- Track mana available per turn, spells cast per turn by type
- Report: average mana curve, average spells/turn

### v1.3 — Commander + Key Cards
- Mark commander (auto-detected from import)
- Track % of games commander could be cast by turn N
- Mark 1–5 key cards, track % of games each seen by turn N
- "Key card in hand by turn 4" consistency stat

### v1.4 — Mulligan Logic
- London Mulligan simulation (draw 7, put N back)
- Configurable keep rules: "keep if 2–4 lands and 1 ramp"
- Report: % of hands that auto-keep vs mulligan

### v2.0 — Win Condition Modeling
- Define a win condition as a set of cards that must be in play
- Report: % of games win condition assembled by turn N
- Tutor targeting: fetch highest-priority missing key card

### v2.1 — Deck Comparison
- Run two deck versions side by side
- Diff stats between versions
- "Is adding card X better than card Y?" answer

### v3.0 — Community Profiles
- Export/import deck configs as shareable JSON URLs
- Public strategy profiles for common Commander archetypes
- Compare your deck stats against archetype benchmarks

---

## Data Structures

All save data is a plain JSON file with this shape:

```json
{
  "version": "1.0",
  "savedAt": "2025-01-01T00:00:00.000Z",
  "decks": [ ...DeckConfig[] ],
  "results": [ ...SimulationResults[] ]
}
```

See `js/types.js` for full type documentation.

---

## Contributing

Issues and PRs welcome. The codebase is deliberately simple:
no build tools, no framework, no dependencies.
All logic is in plain ES module JS files.
