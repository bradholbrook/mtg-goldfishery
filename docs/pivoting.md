The following is research on apply categoric thinking to commander mulliganing
we will be pivoting our site from focusing on goldfishing and (e.g.) in-game board state effects to the mulliganing process. we in some analysis care about what turn something could happen, for example casting your commander or cards on curve, but will not be simulating actual game play - other than the spell and srtifact ramp to achieve this.

here is what we need to do to update the application for this pivot:
use the user interaction tool to assess desired features and priorities - suggest features based on the research - lets do this exhaustively
document those features into a near term project plan and future wishes
analyze the application for features and screens that need to be removed.
remove those things to trim down the application to its mulligan focus
assess and begin implementing the planed features.
note: build a hypergeometric calculator interface we can re-use as we grow
note: one day we want to compare two decklists in the app - how did cards perform in each version. this also means we'll want to analyze each card for each of its effects (questions like how likely is this to mill a creature, how many cards do i have to mill to guarantee a creature - or have a percentile likelihood graph -- note this thinking will get applied across effect types)
note: we need to consider standardizing on the archidekt automatic card tag categories. they will be common for folks and are a basis to standardize. we should look for ways to pull in moxfield tags and map them into those categories (let's talk about this). card type tag is more or less the effect tag - draw/draw engines, mill, interaction etc. Some effects are only relevant for valid hands but others as detailed below are important to either calculate or simulate e.g. draw, mill, cascade, discover, etc.
note: effects are much simpler now that we are not simulating everything and we can likely trim down our editor (we will care more about what could be drawn probabalistically than how many cards the one ring could have drawn in a game - although that amount will be relevant for the calculation. hm. lets talk about this more - suggest some ideas here as we'll need to generalize the effects to be "singular" vs constant like beast whisperer persistent effect... its a draw 1, the player is drawing and not an opponent. that is the most relevant thing. the rest we do in a graph vs simulation like "heres how the probability changes per draw for each card drawn" "you need to draw X to get anothe creature")
note: i care about some configurables - maybe people are happy with 80% likelihood when we're graphing probability, maybe some want 95%. whats easiest? showing them multiple numbers across common likelihood %'s?

the full research: (all phases are just examples below and know nothing about our existing app - refer to my steps above)
# Building a Commander probability engine that actually thinks in categories

**The most impactful tool you can build sits in a gap no existing product fills: connecting functional card categories to real probability math with Commander-aware mulligan simulation.** Every major deckbuilder (Moxfield, Archidekt, TappedOut) lets users tag cards as "ramp" or "removal," but none connect those tags to hypergeometric calculations or Monte Carlo simulation. Meanwhile, every probability calculator (AetherHub, StatTrek) forces users to manually count category sizes and compute one variable at a time. Your tool would be the first to unify auto-classification, multi-category probability analysis, and custom mulligan simulation in a Commander-specific package — a position no competitor currently occupies.

This report covers the complete technical and mathematical foundation: Commander mulligan rules, the statistical distributions you need, what to simulate versus compute analytically, how to model every common MTG effect type, and a concrete architecture for shipping this as a fast client-side SPA on GitHub Pages.

---

## The Commander mulligan gives you two free looks at seven cards

The London Mulligan in Commander follows Rule 103.5 of the comprehensive rules, with a critical multiplayer addition in **Rule 103.5c: the first mulligan is free and does not reduce hand size**. This is an official rule, not a house rule. The sequence works as follows: draw 7, optionally shuffle back and draw 7 again (free — keep all 7), then each subsequent mulligan draws 7 but requires putting back cards equal to the number of paid mulligans. Effective hand sizes are **7, 7, 6, 5, 4** across four mulligan attempts.

This free mulligan fundamentally changes the math. A single card like Sol Ring has a **7.07%** chance of appearing in any given 7-card draw from a 99-card deck. But with two free looks, that jumps to roughly **13.6%**. With a third look (mulling to 6), it reaches approximately **19.6%**. Your simulator must model this accurately — all probability calculations for Commander opening hands should account for the free mulligan as the baseline expectation.

The deck size for all calculations is **N = 99**, not 100. The commander starts in the command zone and is always accessible. This means the library is 99 cards, and the commander functions as a guaranteed card that doesn't need to be drawn — only cast, subject to mana and color requirements.

**Simulation structure for one iteration:**

1. Build the 99-card deck as a typed array (categorical encoding)
2. Shuffle using partial Fisher-Yates (only 7 swaps needed)
3. Draw 7, evaluate the keep function
4. If mulligan and count ≤ 1: reshuffle entire deck, draw 7 (free mulligan — keep all 7)
5. If mulligan and count > 1: reshuffle, draw 7, select (count − 1) cards to bottom using a heuristic
6. Repeat until keep or minimum hand size reached (typically 4)
7. Record: mulligan depth, final hand size, hand composition, whether each tracked condition was met

The **"bottom selection" heuristic** — which cards to put back after the London Mulligan — is itself a design decision. A reasonable default: put back the highest-CMC non-land cards first, but allow users to define a priority ordering (e.g., "keep lands and ramp, bottom everything else"). This heuristic significantly affects simulation outcomes and should be configurable.

---

## When to compute directly and when to simulate

The hypergeometric distribution handles any single-category, single-draw-phase probability exactly and instantly (~0.01ms per calculation). The formula P(X = k) = C(K,k) × C(N−K, n−k) / C(N,n) gives you the probability of drawing exactly k successes from K total in the deck, when drawing n cards from N. For Commander: **N = 99, n = 7 for opening hand, n = 7 + T for turn T** (Commander always draws on turn 1 since everyone is "on the draw" in multiplayer).

Key reference probabilities for a 37-land deck drawing 7 from 99: expected lands = **2.62**, P(≥2 lands) ≈ **93%**, P(≥3 lands) ≈ **79%**, P(≥4 lands) ≈ **54%**. These numbers shift meaningfully across the 33–40 land range that Commander decks typically span.

**Use analytical hypergeometric for:**

- Single-category probabilities: "What's the probability of 3+ lands in my opening 7?"
- Expected values: E[lands] = n × K/N — trivial computation
- Simple scry/surveil calculations: same formula with small n
- Tutor target counting: purely deterministic
- Any single-variable question where the answer doesn't depend on decisions or game state

**Use Monte Carlo simulation for:**

- **Mulligan decisions**: The keep/mulligan choice creates conditional probability branches that are analytically intractable. "Given my keep condition, what's the probability distribution of my final hand?" requires simulation.
- **Multi-category intersections with complex conditions**: "3+ lands AND at least 1 ramp AND at least 1 card with CMC ≤ 2" — the multivariate hypergeometric with threshold constraints across overlapping categories becomes computationally explosive.
- **Commander casting probability**: "Can I cast my 4-mana Sultai commander by turn 4?" depends on total lands drawn, color distribution of those lands, ramp spells resolved on earlier turns, and mana rock deployment. Far too many interacting variables for closed-form solutions.
- **Sequential multi-turn modeling**: When deck composition changes after each draw, land drop, and spell cast, analytical solutions break down.
- **Color fixing over multiple turns**: Joint probability of having all required colors by turn X, accounting for dual lands, fetchlands, and mana rocks.

For convergence, **10,000 iterations** provide a margin of error of approximately **±1%** at the 95% confidence level (for proportions near 0.5). **100,000 iterations** tighten this to **±0.31%**, which is publication-quality precision. Frank Karsten and Allen Wu both use 100,000–1,000,000 iterations in their published analyses. For real-time interactive feedback, 10,000 iterations is sufficient; run 100,000 in the background for final results.

---

## The category-based analysis framework is the key differentiator

The core architectural insight is that Commander deckbuilding operates on **functional categories, not individual cards**. The widely-adopted "Command Zone template" (10 ramp, 10 card draw, 5 targeted removal, 3 board wipes, etc.) is how players actually think — but no existing tool connects this mental model to probability math.

**Non-overlapping categories** (where each card belongs to exactly one category) use the multivariate hypergeometric directly. For a deck partitioned into c categories with K₁, K₂, ..., Kc cards: P(k₁ from category 1, k₂ from category 2, ...) = ∏ C(Kᵢ, kᵢ) / C(N, n). This handles questions like "P(exactly 3 lands, 2 creatures, 1 removal, 1 ramp in opening 7)."

**Overlapping categories** are the realistic case. Ravenous Chupacabra is both "creature" and "removal." Beast Whisperer is both "creature" and "card draw." Three approaches handle this:

- **Sub-category decomposition**: Break overlaps into disjoint groups. If 5 cards are both creature AND removal, create three sub-categories: "creature-only" (20), "removal-only" (7), "creature+removal" (5). Run multivariate hypergeometric on the disjoint groups, then aggregate results.
- **Inclusion-exclusion**: For "at least 1 creature OR at least 1 removal," compute P(≥1 creature) + P(≥1 removal) − P(≥1 of either). Works cleanly for 2–3 categories but gets unwieldy beyond that.
- **Monte Carlo**: For 4+ overlapping categories with "at least" constraints, simulation is most practical. Shuffle 100,000 times, draw n, check all conditions.

**Auto-classification** should use a two-tier approach. **Primary**: Query Scryfall's community-curated oracle tags (`otag:ramp`, `otag:removal`, `otag:card-advantage`, `otag:counterspell`, `otag:board-wipe`, `otag:tutor`) which cover thousands of cards with human-verified classifications. **Fallback**: Regex patterns on `oracle_text` for cards missing tags — e.g., `/destroy target (creature|permanent)/i` for removal, `/search your library for a.*land/i` for ramp, `/draw(s)? (a |one |two |three |\d+ )?card/i` for card draw. Always let users override auto-classifications with custom tags, stored in IndexedDB.

---

## Every common MTG effect maps to a known probability distribution

Each effect type your tool should support maps cleanly to one of three distributions, plus one deterministic counting operation:

**Standard hypergeometric** (draw/mill/scry): Drawing or milling X cards is mathematically identical — sample X from the remaining deck. "Draw 4: what's the probability of at least 1 creature?" is 1 − C(N−K, 4)/C(N, 4). For mill effects, the key user question is the **inverse**: "How many cards must I mill to have a 95% chance of hitting at least 1 creature?" Solve iteratively or use the approximation n ≈ −ln(1−p) × N/K. With 25 creatures in 90 remaining cards, the **50% threshold is ~2 cards, 80% is ~5 cards, 95% is ~9 cards**. This inverse calculation is unique and valuable — no existing tool provides it.

**Negative hypergeometric** (cascade/discover/reveal-until): When you reveal cards one at a time until you hit a success, the expected number of reveals is **(N+1)/(K+1)** where K is valid targets remaining. For cascade with CMC 6, if 40 of 90 remaining cards are valid hits (nonland with CMC < 6), expect to reveal **91/41 ≈ 2.2 cards**. The probability distribution over *what* you hit is simply the proportion among valid targets: if 15 of 40 valid hits are creatures, there's a **37.5%** chance cascade finds a creature. Cascade decks with very few valid targets (like Living End builds with only 1 target) have extreme expected reveals — **45+ cards** — which your tool should visualize dramatically.

**Multivariate hypergeometric** (wheel effects/complex draws): When drawing 7 fresh cards (wheel) and tracking multiple categories simultaneously, use the multivariate form. For wheel effects, the critical nuance is that N equals the current library size (not 99), since cards on battlefield, in exile, and in graveyard are excluded. The discarded hand goes to graveyard, not back to the library.

**Deterministic counting** (tutors/fetchlands): "Search your library for a basic land" — count remaining valid targets. After drawing X cards from a deck with K basics: expected targets remaining = K × (N−X)/N. Track this across turns to show fetchland target depletion curves.

**Impulse draw** (exile top X, may cast) requires a compound model: the hypergeometric probability of hitting a card you can cast given your available mana. P(castable card in top X) where "castable" means CMC ≤ available mana. With 50 cards having CMC ≤ 3 in 85 remaining cards and 2 exiled: P(at least 1 castable) ≈ **83%**.

| MTG effect | Distribution | Formula for expected value |
|---|---|---|
| Draw/Mill X | Hypergeometric | E = n × K/N |
| Cascade/Reveal until | Negative Hypergeometric | E = (N+1)/(K+1) |
| Scry X | Hypergeometric (small n) | Same as draw |
| Wheel (draw 7) | Hypergeometric from current library | E = 7 × K/N_remaining |
| Tutor | Deterministic count | K − (cards of type K already drawn) |
| Impulse draw | Compound hypergeometric | Filter by CMC ≤ available mana |

---

## No existing tool combines categories with probability math

The competitive landscape reveals a clear market gap. **Moxfield** has the best UI and shows "average lands in opening hand" and "percent of playing cards on curve," but offers no hypergeometric calculator, no Monte Carlo simulation, and no mulligan analysis. **Archidekt** has excellent EDHREC integration and card packages but zero probability features. **AetherHub's hypergeometric calculator** is the most-referenced MTG probability tool but handles only one category at a time, doesn't connect to decklists, and can't model mulligans. **ManaTap AI** is the closest competitor — it runs Commander mulligan simulations with up to 20,000 iterations — but its keep conditions are limited to land count thresholds, with no effect-based category analysis.

The critical gaps your tool fills:

- **Custom mulligan keep conditions using functional categories**: No tool lets users define "keep if 3+ lands AND 1+ ramp AND 1+ card with CMC ≤ 2" and simulate 100,000 hands to estimate keep rates at each mulligan depth.
- **Category-to-probability pipeline**: Every deckbuilder has manual category tagging. No tool connects those categories to hypergeometric or Monte Carlo analysis. Users currently must count their removal spells, open a separate calculator, and manually input numbers.
- **Cascade/discover/mill probability analysis**: Zero consumer tools model these mechanics probabilistically. Cascade commanders (Maelstrom Wanderer, Averna) and mill strategies are hugely popular in Commander.
- **Joint multi-category probability**: "What's the probability my opening hand has lands AND ramp AND interaction?" requires multivariate analysis that no existing tool provides.
- **Inverse hypergeometric queries**: "How many mill cards do I need for a 90% chance of hitting a creature?" — no tool offers this.

---

## The JavaScript architecture prioritizes instant analytical feedback with background simulation

**For analytical calculations** (hypergeometric), use the log-space approach to avoid factorial overflow: log(C(n,k)) = logΓ(n+1) − logΓ(k+1) − logΓ(n−k+1), then exponentiate the final result. This runs in **~0.01ms** per calculation — fast enough for real-time slider updates. The jStat library provides `jStat.hypgeom.pdf()` and `jStat.hypgeom.cdf()` out of the box (~70KB), but a custom implementation in ~30 lines avoids the dependency.

**For Monte Carlo simulation**, use **Web Workers** to parallelize across CPU cores. Split iterations across `navigator.hardwareConcurrency` workers (typically 4–8 on modern machines). Each worker independently shuffles, draws, evaluates, and reports aggregate statistics via `postMessage`. With the **partial Fisher-Yates optimization** (only shuffle the 7 positions you need, not all 99), each iteration requires ~7 swaps instead of 99 — a **14× speedup**. Expected throughput: **50,000–200,000 iterations/second** per thread. With 4 workers, 100,000 iterations complete in **~0.2–0.5 seconds**. Send progressive results every 1,000 iterations so the UI updates live.

**Memory optimization**: Represent the deck as a `Uint8Array` where each byte encodes a card's category bitmask. Reuse a single deck array per iteration with `typedArray.set(template)` for fast reset. This avoids garbage collection pressure across 100,000+ iterations.

**Recommended tech stack:**

| Component | Choice | Rationale |
|---|---|---|
| Build tool | **Vite** | Fast HMR, tree-shaking, native GitHub Pages deploy |
| Framework | **Svelte** or vanilla JS | Lightweight; Draw-Probability-Calculator (a proven reference project) uses Svelte |
| Statistics | Custom hypergeometric + jStat fallback | 30-line log-space implementation avoids 70KB dependency |
| Charting | **Chart.js** for histograms/curves, **ECharts** for heatmaps | Chart.js is 70KB, responsive, real-time updates via `chart.update('none')` |
| Card data | **Scryfall bulk data** → **IndexedDB** via idb library | ~30MB oracle_cards JSON, offline-first, no rate limits |
| Deck import | `POST /cards/collection` (75 cards/batch) | Full Commander deck in 2 API calls |
| Parallelism | **Web Workers** with postMessage | Simple, no CORS header requirements |
| Persistence | **IndexedDB** for cards/classifications, **URL hash** (pako-compressed) for shareable deck links | localStorage is too small for card databases |
| Offline | **vite-plugin-pwa** with Workbox | Service worker caches Scryfall data and app shell |

**Deck input parsing** should handle MTGO format (`4 Lightning Bolt`), Arena format (`4 Lightning Bolt (M20) 152`), and plain text with quantities. The regex `^(\d+)x?\s+(.+?)(?:\s+\((\w+)\)\s+(\d+\w*))?$` captures all common formats. Use Scryfall's `/cards/autocomplete` endpoint for real-time name completion during manual entry.

---

## Metrics that answer real deckbuilding questions

The mulligan simulator should track and display these metrics per simulation run, segmented by mulligan depth:

**Keep rate distribution**: A histogram showing what percentage of games keep at each depth (7-7-6-5-4). This immediately reveals whether a keep condition is reasonable or too greedy. A good heuristic: if more than **5%** of games are forced to keep at 4 cards, the keep condition is too strict for the deck's composition.

**Conditional hand composition at each depth**: For each mulligan level, show the average number of lands, ramp spells, and other tracked categories in kept hands. This reveals the quality tradeoff of mulliganing deeper.

**Progressive relaxation modeling**: Let users define different keep conditions at each mulligan depth — strict at depth 0–1, moderate at depth 2, desperate at depth 3+. Track how this affects the overall hand quality distribution compared to a fixed keep condition.

**"Greediness score"**: A single metric combining average hand size with condition-met rate. Defined as (average final hand size) × (probability condition is met in final hand). A greediness score below 4.0 suggests the keep condition is unrealistic.

For the broader probability dashboard, compute these automatically for any imported deck:

- **Lands in opening hand**: Full probability distribution (0 through 7) for the deck's land count, with and without free mulligan
- **Commander castability curve**: Turn-by-turn probability of having enough mana AND correct colors to cast the commander, accounting for ramp
- **Category coverage by turn**: For each user-defined category, P(≥1 in hand or drawn) by turns 1–10
- **Curve-out probability**: P(having a playable card on turns 1, 2, and 3 given mana available)
- **Sol Ring / fast mana probability**: P(any fast mana in opening hand) across both free-mulligan looks
- **Color source adequacy**: For each color in the commander's identity, P(≥1 source by turn 2), P(≥2 sources by turn 4)

---

## Putting it all together as a phased build plan

**Phase 1 — Analytical foundation** (ship first, provides immediate value): Build the hypergeometric calculator with Commander defaults (N=99, n=7). Accept deck import via paste or Scryfall lookup. Auto-classify cards into categories. Display per-category probability of "at least 1 in opening 7" and turn-by-turn cumulative probabilities. Add the inverse calculator: "how many copies of an effect do you need for X% confidence of seeing one by turn Y?" This alone would be more useful than any existing tool because it connects categories to probabilities automatically.

**Phase 2 — Mulligan simulator**: Add the Monte Carlo engine with Web Workers. Implement the London Mulligan with free first mulligan. Build the composable keep-condition editor (AND/OR/NOT with category thresholds). Display keep rate distributions, average hand quality, and greediness scores. Default to 10,000 iterations for interactive use, 100,000 for "detailed analysis" mode.

**Phase 3 — Effect-based analysis**: Add cascade/discover probability distributions (negative hypergeometric), mill threshold calculations, wheel analysis, impulse draw modeling, and fetchland target depletion curves. Each effect type gets its own analysis panel that draws from the deck's category data. The cascade analyzer should show a full probability distribution over hit categories — "Cascade 6: 40% creature, 25% removal, 20% ramp, 15% card draw."

**Phase 4 — Multi-turn simulation**: Extend Monte Carlo to model sequential turns. Track mana availability, land drops, ramp resolution, and card draw engine output. Answer compound questions: "If I play a ramp spell on turn 2, what's the probability I can cast my 5-mana commander on turn 3?" and "Expected cards seen per turn with X draw engines." This is where the tool becomes genuinely unique — modeling dynamic game progression rather than static snapshots.

The architectural decision to analyze by category rather than by individual card interaction is what makes this tractable. You don't need to model Cultivate differently from Kodama's Reach — both are "ramp: +1 land to battlefield." You don't need card-specific rules engines. You need category counts, hypergeometric math, and Monte Carlo simulation. The existing Scryfall classification pipeline feeds categories directly into probability calculations, and every analytical feature compounds on the same underlying data model.

## Conclusion

The deepest insight from this research is that the gap between how Commander players think (functional categories, mulligan heuristics, "do I have enough interaction?") and how existing tools compute (individual card lookups, single-variable hypergeometric, no simulation) is enormous. Frank Karsten's work proved that Monte Carlo simulation answers questions hypergeometric math cannot — but his methodology lives in Python scripts and academic articles, not accessible web tools. The negative hypergeometric distribution for cascade/reveal-until effects is well-understood mathematically but implemented in zero consumer products. By building the category-to-probability pipeline first (Phase 1), you ship immediate differentiated value — every Commander player who has ever manually counted their removal spells and opened a separate calculator tab becomes your user. The simulation engine (Phases 2–4) then compounds that value into territory no competitor has reached.