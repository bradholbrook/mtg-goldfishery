# mullstat — Project Plan

> Pivoted from goldfish simulator → Commander mulligan probability engine.
> Source of truth for near-term phases and future wishes.

---

## Strategic Direction

**What we are:** A Commander-specific mulligan analysis and probability engine. We help players understand whether their deck can reliably keep a hand, cast their commander on curve, and get value from their effects.

**What we are not:** A turn-by-turn board state simulator. We do not model combat, end step effects, opponent interactions, or complex boardstate beyond what's needed to evaluate mana/castability.

**Name:** mullstat
**Icon:** TBD — flat 1-2 color design, ruler measurement ticks alongside a Magic card silhouette

---

## Tab Structure (post-pivot)

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Always-visible static analysis: category breakdown bars, mana curve, commander color profile |
| **Cards** | Category tag editor: auto-classified + user-editable tags per card, effect values |
| **Mulligan** | Keep condition editor per depth, bottom priority list, run button |
| **Results** | Post-sim: Summary stats / Mulligan analysis / Per-card effect graphs |

---

## Card Tag System — Three Distinct Rows

Each card has **three distinct groups of pills** displayed as separate rows in both the card list and the card editor:

1. **Type pills** — card types, supertypes, subtypes (e.g., `Legendary`, `Creature`, `Wizard`). From Scryfall type line. Read-only (derived from Scryfall).
2. **Category pills** — functional deck role (e.g., `Ramp`, `Card Draw`, `Removal`). Auto-classified + user-editable.
3. **Effect pills** — specific quantified effects (e.g., `draw 2`, `+2 mana`, `mill 4`). Some effects need a value field inline — show a small input next to those pills.

The card editor shows all three rows. User can toggle category/effect pills on/off and type values where needed. No tier display (simulatable/track_only) — we either calculate an effect or we don't.

---

## Card Category System

### Tags (effect-based, multiple per card)

Auto-classified via Scryfall otags → our canonical set, then user-editable. No tier system — removed.

| Tag | Description | Value field? |
|-----|-------------|--------------|
| **Ramp** | Any mana acceleration (rocks, dorks, land ramp) | ramp value (mana added) |
| **Card Draw** | Draw engines, cantrips, looters, wheels, impulse | draw count |
| **Interaction** | Counterspells, bounce, stax | — |
| **Board Wipe** | Mass removal | — |
| **Tutor** | Search library for a card | — |
| **Mill** | Self or opponent mill | mill count |
| **Cascade** | Cascade keyword | cascade CMC threshold |
| **Discover** | Discover keyword | discover value |
| **N/A** | For now don't match effects that don't fit above | — |

### Card Type drives Ramp sub-behavior (no separate sub-tags)

- **Artifact + Ramp** → Mana Rock (available same turn as played, taps for mana next turn onward)
- **Creature + Ramp** → Mana Dork (summoning sickness: can't tap turn played, available next turn)
- **Instant/Sorcery + Ramp** → Land Ramp (puts a land onto battlefield; that land available next turn, possibly ETB tapped)
- **Enchantment + Ramp** → Enchantment ramp (persistent mana source)

### Scryfall otag Mapping

Scryfall oracle tags (`otag:ramp`, `otag:card-advantage`, etc.) will be fetched as part of card enrichment and mapped to our canonical tag set. The mapping table needs exploration before implementation — see Phase 2.

---

## Mulligan System

### London Mulligan Rules (Commander)
- Hand sequence: 7, 7, 6, 5, 4 (first mulligan is free — draw 7 again, keep all 7)
- 99-card deck (commander in command zone, always accessible)
- Bottom selection: configurable priority list (what to put back when mulliganing to 6/5/4)

### Keep Condition Definitions
- Named definitions, one per mulligan depth (or shared)
- AND/OR criteria using existing criterion types (at_least_type, n_of_cards, has_tag, etc.)
- **Priority ordering**: definitions are tried in order. If a 7-card keep condition requires only 5 cards to satisfy, it applies automatically at mull-to-5. This means more lenient definitions should be lower priority.
- **Note in UI**: "This hand definition requires X cards — it will auto-apply on any mull to ≤X cards."

### Bottom Selection Priority
- Ordered list of what to put back (repurposed from current discard priority system)
- Default: bottom highest-CMC non-land cards first
- User can reorder via drag-and-drop

### Simulation
- 100,000 iterations by default (no user-facing count control — just run it)
- **No Web Workers** — 100k simple mulligan iterations (draw 7, evaluate, repeat) runs in ~0.5-1s on the main thread. Not worth the complexity. Add a worker only if profiling shows it's actually slow.
- Run button in Mulligan tab → immediately navigate to Results

---

## Mana Model (Commander Castability)

### Color-Aware + Sequencing

Goal: answer "What turn can I reliably cast my commander?"

- Track mana sources per color (from land color data, rock/dork mana output)
- Mana dorks: summoning sickness — can't tap until the turn after they ETB
- ETB-tapped lands: don't contribute mana on the turn played
- Ramp sequencing: you need mana to cast the ramp spell before it helps
- Graph: "Turn you had all N colors of commander's cost available, untapped" (distribution)
- Stat: "Commander castability by turn" — P(can cast commander by turn N) for N=1..8

### Scope (what we simulate for mana)
- Land drops (pure lands + MDFC land faces)
- Mana rocks (artifact ramp)
- Mana dorks (creature ramp, summoning sickness)
- Land ramp spells (add land to battlefield)
- ETB-tapped lands (delay 1 turn)

### Out of scope (removed)
- ETB triggers (beyond mana contribution)
- End step / upkeep effects
- Cast triggers
- Loot/discard during play
- Opponent simulation

---

## Results Tab Structure

```
[ RESULTS TAB ]

── Summary ─────────────────────────────────────
  Avg keep hand: 6.4    Greediness score: 5.8
  Commander castable by turn: 3.2 (avg)
  All colors untapped by turn: T2 in 94% of games

── Mulligan Analysis ───────────────────────────
  [Keep rate histogram: % kept at 7/7/6/5/4]
  [Category counts at each mulligan depth]

  Per-definition results (same as today):
  ┌─ "Keepable Hand" ─────────── 78% ─┐
  │ [3 sample hand images]             │
  └────────────────────────────────────┘
  ┌─ "Minimum Viable" ─────────── 91% ─┐
  │ [3 sample hand images]             │
  └────────────────────────────────────┘

── Per-Card Analysis ───────────────────────────
  Card list includes the commander (may have effects).

  For draw/mill cards: curves are NOT card-specific.
  The "draws to hit Y% of category Z" curve is purely
  a function of (draw_N, library_remaining, category_K).
  Compute ONE shared table [draw_count × category] and
  all draw/mill cards just display from it. Only
  cascade/discover gets its own calculation (negative
  hypergeometric, CMC-threshold dependent).

  Click a draw/mill card →
    "This card draws 3"
    [Lookup from shared draw=3 row of the table]
    "X% to hit [Creature] per draw" (filterable by type)
    "Draws needed to hit [type] at 80%/90%/95%"
    [Curve graph, toggleable by category type]

  Click a cascade/discover card →
    [Unique calculation per CMC threshold]
    "Expected reveals: 2.4"
    "P(hit Creature): 40%, P(hit Ramp): 22%..."
```

---

## Phases

### Phase 1 — Pivot & Cleanup (near-term)

**Goal:** Get the app to a clean, focused state reflecting the new direction. No regressions in what remains. Ship a renamed, stripped-down foundation.

**Tasks:**
1. Rename to mullstat (update title, header, meta, manifest)
2. Design and add new icon (SVG: ruler ticks + card silhouette, 1-2 color flat)
3. Rename tabs: Overview→Dashboard, Cards→Cards, Config→Mulligan, Simulate/Results→Results
4. **Remove** from simulator.js: end step, upkeep, cast triggers, loot/discard, ETB (non-mana), death triggers, opponent simulation
5. **Remove** from UI: opponent config fields, ETB/death effect editor UI elements, tier/simulatability display
6. **Repurpose** discard priority UI → bottom selection priority for mulligan (same drag-to-reorder code, new purpose)
7. **Remove** from effects.js: non-mana effect timing patterns (end_step, death, opponent_cast, opponent_draw, attack, combat_damage, sacrifice)
8. **Remove** tier system (`simulatable`/`track_only`/`simulatable_soon`) — replace with simpler "does it need a value?" flag
9. Update criteria types in criteria.js to use the new canonical tag set
10. Update Good Hand Def editor to support per-depth definitions with priority ordering
11. Save file: bump version, migrate old effect tags to simplified system

### Phase 2 — Category Classification Engine (near-term)

**Goal:** Cards are properly classified into our canonical category set. Cards tab works as a tag editor.

**Tasks:**
1. Explore Scryfall otag vocabulary (sample 20+ representative cards, document the otag values)
2. Define otag → mullstat category mapping table (document in `docs/otag-mapping.md`)
3. Update enrichment.js: fetch `oracle_tags` field from Scryfall bulk data
4. Update effects.js / enrichment: map otags → category tags at import time
5. Build Cards tab as category tag editor:
   - Card list with category chips (auto-assigned)
   - Click chip to remove; click '+' to add from canonical set
   - Editable value field for draw count, ramp value, etc.
6. Dashboard tab: category breakdown bars (vs. "Command Zone template" recommended counts), mana curve, commander color profile
7. Update save schema: category tags replace old effectTags system (or coexist with additive fields)

### Phase 3 — Hypergeometric Engine & Per-Card Analysis

**Goal:** The math layer that powers all probability displays. Per-card effect graphs in Results.

**Tasks:**
1. Build `js/hypergeometric.js`: log-space C(n,k) implementation, hypergeometric PMF/CDF, expected value, inverse solver ("draws needed to hit X at Y%")
2. Dashboard: add basic opening hand math (E[lands], P(≥2 lands), P(≥1 ramp), etc.) — instant, no sim needed
3. Precompute shared draw/mill probability table:
   - Key insight: "draws to hit Y% of category Z" is the same curve for ALL draw-N cards with the same N. It's a function of (draw_count, library_remaining, category_K). Not card-specific.
   - Build one [draw_count × category] lookup table per deck at analysis time. All draw/mill cards share it.
   - Per-card view just reads from the row matching that card's draw_N value.
   - Cascade/discover use separate negative hypergeometric (CMC-threshold dependent — genuinely card-specific).
4. Per-card analysis in Results tab:
   - Card list includes the **commander** (may have draw/ramp/other effects)
   - Click draw/mill card → display from shared table for draw=N
   - Click cascade/discover → dedicated calculation
   - Filterable graph (toggle which categories to overlay)
5. Opening hand distribution histogram (per-category)

### Phase 4 — Mulligan Simulator & Commander Castability

**Goal:** The Monte Carlo engine. Full mulligan analysis. Commander castability curve.

**Tasks:**
1. Build Monte Carlo engine (main thread, no Web Worker):
   - Partial Fisher-Yates shuffle (only 7 positions)
   - London Mulligan with free first mulligan
   - Configurable keep condition evaluation
   - Bottom selection using priority list
   - 100k iterations
2. Color-aware mana model:
   - Fetch land color data from Scryfall at enrichment time
   - Track per-color mana sources through turns 1-8
   - Model mana dork summoning sickness
   - Model ETB-tapped lands
   - Model ramp sequencing (need mana to cast ramp)
3. Results — Summary section: avg keep hand, greediness score, commander castability by turn, P(all colors by T2)
4. Results — Mulligan Analysis: keep rate histogram, category counts per depth, sample kept hands
5. Commander castability curve chart: P(can cast commander by turn N) for N=1..8

---

## Metrics for Success — Note

Do **not** prescribe what a "good" deck looks like in UI. Decks have various intended success profiles — a voltron deck, a turbo-ramp deck, and a control deck have very different keep conditions by design. Metrics describe; they don't judge.

The greediness score and keep rate are descriptive tools to help the player understand their own definition — not benchmarks against an ideal.

---

## Future Wishes (design for, don't build yet)

These are acknowledged but out of scope until the core is solid.

| Feature | Description |
|---------|-------------|
| **"You need X more ramp"** | Recommendation: "To cast your 5-CMC commander by turn 4 in 80% of games, you need 2 more ramp sources." Accounts for castability of those ramp cards themselves, CMC overlap with existing curve, and commander's color requirements. |
| **"You need X more color sources"** | "Add 2 more {G} sources to hit 90% chance of casting commander by turn 3." Derived from the color-aware mana model. |
| **Cascade/Discover analysis** | Negative hypergeometric distribution. "Cascade 6: expected reveals, P(hit creature vs removal vs ramp)." |
| **Mill threshold calculator** | "How many cards do I mill for 95% chance of hitting a creature?" Inverse negative hypergeometric. |
| **Manual Effect Lab tab** | Standalone calculator with effect-based inputs. E.g. "Draw/Mill N" mode: user sets N (draw count), turn number (shifts effective library size: 99 − 7 hand − (turn−1) draws), and which categories to track. Generates the same probability curves as the auto-analysis, but for any hypothetical. Turn-awareness is important: drawing 3 on turn 6 sees a meaningfully different library than drawing 3 from a fresh 99. |
| **Inverse hypergeometric** | "How many copies of X do I need for 90% confidence of seeing it by turn 3?" |
| **Cards on curve** | P(having a castable card at CMC N by turn N) for each CMC bucket |
| **Scry/Surveil modeling** | Add scry/surveil effects to mana model and probability calculations |
| **Compare two decklists** | Side-by-side probability analysis. Per-card delta view across deck versions. |
| **Effect Lab turn slider** | "Cascade on turn 5" — context-aware shift of the library composition |
| **Progressive relaxation mulligan** | Different keep conditions at depth 0-1, depth 2, depth 3+. Track impact on hand quality. |
| **Moxfield tag import** | Pull Moxfield card tags, map to mullstat categories |
| **Archidekt import** | Import directly from Archidekt with tags already mapped |
| **Shareable deck links** | URL hash (pako-compressed) deck state for sharing |
| **PWA / offline** | Caching for offline use |
| **moxfield update** | Form bulk update export for category(tag) values for moxfield |
| **user selected categories** | Show and allow use of the other otags and let users pick otags to filter on for their deck |
---

## Key Architecture Decisions

### What survives from the current simulator
- Opening hand draw + evaluation
- Land drop tracking (with ETB-tapped detection)
- Mana rock/dork mana contribution (with summoning sickness)
- Land ramp resolution (adds land)
- MDFC face selection logic (spell face vs land face)

### What gets removed
- End step, upkeep, draw step trigger simulation
- Cast trigger framework (ETB on cast, triggered abilities)
- Loot/discard system (discard priority UI code **repurposed** for bottom selection, not deleted)
- Death trigger simulation
- Opponent simulation (numOpponents, opponentExtraDraws, etc.)
- Effect tier system entirely (`simulatable`/`track_only`/`simulatable_soon`)

### Hypergeometric implementation
- Custom log-space log-gamma implementation (~30 lines, no library)
- API: `hypgeomPMF(k, N, K, n)` — P(exactly k successes), `hypgeomCDF(k, N, K, n)` — P(≤k)
- `drawsNeeded(N, K, p)` — inverse: minimum draws for probability p of hitting ≥1

### Web Worker strategy
- **Not used** — 100k simple mulligan iterations is ~0.5-1s on main thread. No need to over-engineer. Revisit if profiling shows a problem.

### Save file migration
- Bump to version `"3.0"` when category tag system ships (Phase 2)
- `mergeLoadedData` migration: convert old `effectTags[]` to new category tags where possible



## more tag research
To create highly accurate searches for these major categories while ensuring you get unique cards by their Oracle ID (avoiding duplicate printings), you should use the syntax unique:oracle.

For the tags themselves, Scryfall uses a mix of community-driven otag (Oracle Tags) and more "official" function tags. Using the function: prefix is often more reliable for gameplay-defining roles, while otag: is better for niche mechanics like Mill or Cascade.
Ramp	unique:oracle function:ramp	Includes rocks, dorks, and land-fetch.
Tutor	unique:oracle otag:tutor	Includes "tutor-to-hand" and "tutor-to-battlefield."
Card Draw	unique:oracle function:draw	Filters for cards whose primary role is net-positive draw.
Board Wipe	unique:oracle otag:boardwipe	Standard community tag for "sweepers."
Interaction	unique:oracle (function:removal or function:counterspell)	Combines targeted removal and stacks-based interaction.
Cascade	unique:oracle o:cascade	(Better as a keyword search: o:) or otag:cascade.
Mill	unique:oracle otag:mill	Specifically cards that move library to graveyard.
Discover	unique:oracle o:discover	Modern keyword is best found via o:discover.

## regex
for a creature that causes land to enter the battlefield (alpine guide, sakura-tribe elder, yavimaya elder has other requirements/goes to hand). we should note for simulation if the ramp is available that turn or the next turn (can detect if mana comes in tapped)