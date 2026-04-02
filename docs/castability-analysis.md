# Commander Castability Calculator — Deep Analysis

**Date:** 2025-04-02  
**Files:** `js/ui/calculate-tab.js` (core), `js/hypergeometric.js` (math), `js/enrichment.js` + `js/tagger.js` + `js/effects.js` (data pipeline)

---

## How It Works Today

### Data Pipeline
1. **Scryfall enrichment** → `card.cmc`, `card.manaCost`, `card.producedMana`, `card.etbTapped`
2. **Oracle tag enrichment** → `card.otags` → `card.categories` (via `OTAG_TO_CATEGORY`)
3. **Effect detection** → `card.effectTags` (mana_rock subtype with value)

### The Calculation (`pCastOnTurn`)
For each turn T (1–8), computes P(commander castable by turn T):

1. `n = 7 + T` cards seen (opening hand + T draws, including T1 draw in Commander)
2. **Multivariate hypergeometric enumeration:** iterates over all compositions of (lands drawn, ramp-bucket-0 drawn, ramp-bucket-1 drawn, …, filler) and sums probability of compositions where `min(l, T) + Σ(rᵢ × effectiveValue(bucketᵢ, T)) ≥ commanderCmc`
3. **Color factor:** Multiplied by `Π P(≥1 source of color c in n draws)` for each commander pip color

### Ramp Bucketing
- Ramp cards grouped by `CMC × isDork`
- Each bucket stores average mana value and average castability (color-weighted)
- `effectiveValue(bucket, T)`: 0 if T < cmc; max(0, value−cmc) on cast turn (rocks only, dorks get 0 for summoning sickness); full value for T > cmc; all × castability

### Color Sources
- `getProducedColors(card)` reads `card.producedMana` from Scryfall (WUBRG filtered)
- Fallback: basic land subtype inference
- Counts ALL non-commander cards that produce each color (lands + rocks + dorks)

---

## Issues Found (by severity)

### 1. CRITICAL: Color Independence Approximation Underestimates Multi-Color Decks

**What:** The color factor is `Π P(≥1 of color c)` — treating each color as independent.

**Why it's wrong:** Dual/tri/5-color lands create *positive correlation* between color availability. Drawing one Command Tower satisfies all 5 colors simultaneously. Independence approximation underestimates P(all colors) when sources overlap.

**Impact on Tom Bombadil (verified numerically):**
- Independent: P(all 5 colors in 12 draws) = 75.5% (individual miss rates: W 6.5%, U 4.0%, B 6.5%, R 5.5%, G 4.7%)
- True joint probability is HIGHER — estimated 83–88% via inclusion-exclusion (dual/tri/5-color lands create ~7–12% positive correction)
- This alone could shift T5 from 39% to ~44–48% (multiplied through the mana total probability)

**Impact on Shilgengar:** Minimal (only 1 color required).

**Fix — Inclusion-Exclusion on the complement:**
```
P(all colors) = 1 - P(miss ≥1 color)
P(miss ≥1) = Σ P(miss c) - Σ P(miss c₁ AND c₂) + Σ P(miss c₁ AND c₂ AND c₃) - ...
```
For each subset S of required colors, P(miss all colors in S) = P(draw 0 from cards producing any color in S). This requires grouping cards by which colors they DON'T produce, but it's exact and fast for ≤5 colors (at most 31 terms).

**Better fix — Unified enumeration:** Group cards by color-production profile (e.g., "W only", "WU", "WUBRG", "none") and enumerate draw compositions, checking BOTH mana total AND color coverage in one pass. More accurate but more buckets = more loops.

**Recommended approach: Inclusion-exclusion.** It's exact, fast (5 colors = 31 terms), and can replace the current `pColors` multiplication with minimal structural change.

**Implementation sketch (replaces lines 273-277 of calculate-tab.js):**
```javascript
// Build color-profile groups from non-commander cards
// colorProfile(card) = set of WUBRG colors the card produces
// For each subset S of commanderColors:
//   nonProducerCount[S] = cards that produce NONE of the colors in S
// P(miss all colors in S) = C(nonProducerCount[S], n) / C(N, n)

function pAllColors(commanderColors, nonCmdrCards, N, n) {
  if (commanderColors.length === 0) return 1;

  // Precompute: for each card, which commander colors does it produce?
  const cardColorSets = nonCmdrCards.map(card => {
    const produced = new Set(getProducedColors(card));
    return commanderColors.filter(c => produced.has(c));
  });

  // For each non-empty subset S of commanderColors:
  const numColors = commanderColors.length;
  let pMissAny = 0;

  for (let mask = 1; mask < (1 << numColors); mask++) {
    const subset = [];
    for (let i = 0; i < numColors; i++) {
      if (mask & (1 << i)) subset.push(commanderColors[i]);
    }

    // Count cards producing NONE of the colors in subset
    let nonProducerCount = 0;
    for (let i = 0; i < nonCmdrCards.length; i++) {
      const producesAny = cardColorSets[i].some(c => subset.includes(c));
      if (!producesAny) nonProducerCount += nonCmdrCards[i].quantity;
    }

    // Inclusion-exclusion sign: odd subset size = +, even = -
    const sign = (subset.length % 2 === 1) ? 1 : -1;
    const pMissSubset = Math.exp(logBinom(nonProducerCount, n) - logBinom(N, n));
    pMissAny += sign * pMissSubset;
  }

  return Math.max(0, Math.min(1, 1 - pMissAny));
}
```
This replaces the `commanderColors.reduce(...)` multiplication. Need to pass `nonCmdrCards` into `pCastOnTurn` (or precompute in `extractDeckProfile`). At most 31 iterations for 5 colors — negligible performance cost.

### 2. HIGH: ETB-Tapped Lands Not Factored Into Probability

**What:** `landMana = min(l, T)` assumes every land tapped immediately. The UI shows "12 of 38 lands enter tapped" as a note but doesn't adjust the math.

**Why it matters:** With 12/38 tapped (31.6%) for Shilgengar:
- On T5, if you drew 5 lands, expected usable = ~5 − 0.316×1 ≈ 4.7 (the land you play on T5 has 31.6% chance of being tapped; prior lands are fine)
- On T3, the most recent land being tapped matters more (you've only played 3, each could be tapped)

**Actually — it's more nuanced:** You choose which land to play each turn. Optimal play: play tapped lands early (when you don't need all mana), untapped lands on the curve turn. So a deck with some tapped lands may play them on T1-T2 and save untapped ones for T4-T5.

**Simple model:** Reduce effective landMana by a fraction based on tapped ratio:
```
tappedFraction = tappedLandCount / landCount
effectiveLandMana = min(l, T) − (T > 0 ? tappedFraction : 0)
```
This is a rough approximation. A more precise model would track tapped/untapped as separate buckets in the multivariate enumeration (but adds complexity).

**Recommended approach:** Split lands into tapped and untapped pools in the multivariate enumeration. The model already enumerates land counts; splitting into two groups (tapped, untapped) adds one loop level but gives accurate results.

### 3. HIGH: Ramp Value Detection Fails for Variable-Output Cards

**What:** `getManaValue()` uses regex to detect mana production. Cards with variable output get wrong values.

**Specific failures from Tom's deck:**
| Card | Actual Output | Detected Value | Why |
|------|--------------|----------------|-----|
| Bloom Tender | 2–5 mana (1 per color of permanents) | 1 | "add one mana of that color" → matches "add one mana" fallback |
| Faeburrow Elder | 2–5 mana (same as Bloom Tender) | 1 | Same issue |
| Sanctum Weaver | X mana (enchantments controlled) | 2 | "add X mana" → matches "add mana equal to" → approximate 2 |

**Impact on Tom:** These 3 cards are his best ramp pieces. Bloom Tender realistically produces 3–4 mana in a 5-color enchantment deck, but the model says 1. This significantly underestimates ramp contribution.

**Fix options:**
1. **Hard-coded overrides** for known variable-output cards (fragile, incomplete)
2. **Regex for "for each color" pattern** → estimate based on commander's color count
3. **User-configurable mana value** on the card editor (already have EV input infrastructure)
4. **Heuristic:** "for each color among permanents" → value = min(commanderColors.length, 3) as a conservative default

**Recommended:** Add regex detection for the "for each color" pattern and default to `commanderColors.length - 1` (conservative — you usually have fewer colors in play than in identity on cast turn). Allow user override. Also detect "add X mana" patterns and map to a configurable default (3?).

### 4. MEDIUM: Land-Ramp Spells (Cultivate/Kodama's Reach) Modeled Incorrectly

**What:** Cultivate is a sorcery tagged as "Ramp." The model treats it like a permanent that produces 1 mana (via `getManaValue()` fallback = 1), but it's actually a one-shot that puts a land onto the battlefield.

**Why the math still approximately works:** Cultivate adds +1 land, producing 1 mana/turn thereafter. The model says "Cultivate contributes 1 mana on turns after cmc." Net effect is similar: +1 mana for turns after casting. The error is that the model double-counts: Cultivate's battlefield land is ALREADY in the deck's land count (it's a land card in the library), so fetching it doesn't add a new card — it just accelerates when you get it.

**Actual effect of Cultivate:**
- Removes 1-2 lands from library (thinning → slightly higher card quality on future draws)
- Puts 1 land onto battlefield (net +1 land in play vs just drawing)
- Puts 1 land into hand (acceleration of 1 draw)
- The fetched land is tapped (Cultivate specifies this)

**The model's `value=1` is reasonable** as a first-order approximation of "one extra land in play." The conceptual error (treating it as a permanent) doesn't change the math much because the result is the same: +1 mana on subsequent turns.

**Color assessment:** Cultivate searches for BASIC lands, so it can find any color in your identity. Scryfall's `produced_mana` for Cultivate is typically null (it doesn't produce mana itself). So Cultivate does NOT contribute to `colorSources` in the current model. This is a minor undercount for color access but Cultivate-type ramp is relatively rare (1-2 cards per deck).

**Recommended:** Leave value=1 as-is. For color, consider adding these cards' commander identity colors to `colorSources` (they effectively provide access to any basic color).

### 5. MEDIUM: `effectiveValue` Cast-Turn Formula Has a Logical Gap

**What:** On the cast turn (T = cmc of ramp piece), rocks get `max(0, value - cmc)`.

**The `max(0, ...)` clamp is actually correct** for the following reason: If value < cmc (e.g., Arcane Signet: value 1, cmc 2), then on the cast turn, the optimal play is to NOT deploy the rock (just use your land mana). The max(0, ...) correctly reflects "best available mana" = use lands if deploying the rock would net-reduce mana.

**Where it slightly breaks:** The model then says on T = cmc + 1, the rock contributes full `value`. But this assumes the rock was deployed on turn `cmc`. If you skipped deploying on turn `cmc` (because it was net-negative), you'd deploy on turn `cmc + 1` instead, where it would have ev = max(0, value - cmc) again (spending this turn's extra land mana to cast it). The model overcounts by giving full `value` when really the rock was just deployed.

**Impact:** Small. By turn cmc + 1, you have cmc + 1 lands. Casting a cmc-cost rock leaves you with 1 + value mana vs the model's (cmc+1) + value. But commander is cmc 5+, so this rarely matters in the winning-hand check.

**Recommended:** Note as a known approximation, don't fix unless pursuing high precision.

### 6. MEDIUM: Ramp Castability Only Checks Colors, Not Mana Availability

**What:** `cardCastability()` computes P(having right colors by turn cmc) but does NOT check P(having enough total mana by turn cmc). For a CMC3 rock, it asks "do I have green?" but not "do I have 3 mana?"

**Why it mostly works:** For CMC 1–2 ramp (the majority), P(≥1 land) or P(≥2 lands) by the right turn is very high (95%+ for reasonable decks). For CMC 3+ ramp, missing is more possible but still unlikely with 37+ lands.

**Impact:** Slightly overestimates castability of expensive ramp in land-light hands. The multivariate enumeration already handles this to some degree (if you drew fewer lands, you drew more ramp, but can't cast it).

**Recommended:** For high-CMC ramp (4+), multiply castability by `hypgeomAtLeast(cmc, N, landCount, 7 + cmc)`. Small improvement for edge cases.

### 7. LOW: Recursive Ramp-Enables-Ramp Not Modeled

**What:** Sol Ring on T1 provides 2 mana on T2, making it easier to cast a CMC2 signet. The model doesn't account for cheaper ramp enabling deployment of more expensive ramp.

**Magnitude:** In a typical deck with 8-12 ramp pieces, maybe 2-3 are CMC 0-1 and could enable others. The probability of drawing both a cheap enabler AND expensive ramp in the right window is modest.

**Proposed layered approach:**
1. Compute base mana from lands only
2. Tier ramp by CMC: T0 (CMC 0-1), T1 (CMC 2), T2 (CMC 3+)
3. T0 ramp's effective value on each turn computed from land base
4. T1 ramp's effective value computed from land base + T0 ramp contribution
5. T2 ramp's effective value computed from land base + T0 + T1

This captures the main cascading effect. Implementation: adjust `effectiveValue` or `cardCastability` per bucket to include contribution from cheaper buckets. The enumeration already has all bucket draw counts, so this is feasible within the existing loop structure.

**Concern:** This adds complexity. The interaction is second-order. For decks with lots of fast mana (cEDH), it matters more; for typical Commander, the current model is adequate.

**Recommended:** Implement if pursuing high accuracy, skip if targeting "good enough" estimates.

### 8. LOW-MEDIUM: Double-Counting Check

**Verified: No double-counting of cards.** `rampCards = nonCmdr.filter(...)` operates on the card list, not the category list. A card with both `Ramp` and `Mana Rock` categories is still filtered as one card. Each card appears in exactly one ramp bucket.

**However:** A cantripping ramp piece (e.g., Arcane Signet that also draws — not a real card, but hypothetically) would be counted as ramp here and separately as card draw elsewhere. For the castability calculation specifically, this is fine — the card is counted once as a ramp piece.

**Recommended:** No fix needed.

---

## Summary: Error Magnitude Estimates

For **Shilgengar** (mono-B, CMC 5, 38 lands, 12 tapped, 8 ramp):
- Color independence: negligible (1 color, P(≥1 B) = 98.6%)
- ETB tapped: **~5-8% overestimate on T4-T5** (12/38 tapped is significant; land-only P(≥5) = 51.9%, P(≥4) = 75.4%, expected lands = 4.6)
- Ramp values: likely accurate (Sol Ring, signets have clean mana patterns)
- Net: current 72% at T5 is probably 65-70% real → **~5% optimistic** (dominated by tapped land error)

For **Tom Bombadil** (WUBRG, CMC 5, 37 lands, 7 tapped, 12 ramp):
- Color independence: **~8-13% underestimate** (verified: independent = 75.5%, true ≈ 83-88%, ~10% gap)
- ETB tapped: ~2-3% overestimate (only 7/37 tapped)
- Ramp values: **~5-10% underestimate** (Bloom Tender=1 should be ~3-4, Faeburrow Elder=1 should be ~3-4, Sanctum Weaver=2 should be ~4-5)
- Net: current 39% at T5 might be 43-52% real → **~7-12% pessimistic** (color underestimate and ramp undervalue compound)

---

## Implementation Status

All fixes implemented in `js/ui/calculate-tab.js`:

1. **Inclusion-exclusion for color** — DONE. `pAllColors()` replaces the independence product. Exact for any number of colors (31 terms for 5c). Verified: 14.4pp improvement in 5-color test case. Mono-color matches `hypgeomAtLeast` exactly.

2. **ETB tapped as separate land pool** — DONE. Two-loop enumeration (untapped, tapped). `effectiveLandMana(u, t, T)` models optimal play: tapped lands early, untapped on curve turn. ~7x more land iterations but still <100 total.

3. **Variable mana producer detection** — DONE. New patterns in `getManaValue`:
   - "for each color among permanents" → `min(3, commanderColorCount)`
   - "where X is the number of" → 3
   - "{C} for each [type]" → 3
   - "add an amount of mana" → 3

4. **Ramp castability mana check** — DONE. For CMC ≥ 3 ramp, castability multiplied by `hypgeomAtLeast(cmc, N, landCount, 7+cmc)`.

5. **Layered ramp model** — NOT IMPLEMENTED. Second-order effect, complex. See analysis above for proposed approach.

6. **UI updates** — Joint "All N colors" probability line for multi-color commanders. Tapped land note updated. Land count shows "X+Y tapped" split.

---

## Adding New Variables in the Future

The current architecture makes it straightforward to add new ramp categories:

1. **New otag mapping** in `tagger.js` OTAG_TO_CATEGORY → maps to an existing or new category
2. **Category check** in `isRamp()` in calculate-tab.js → include the new category
3. **Value detection** in `getManaValue()` → add regex for the card's mana text pattern
4. **Bucket behavior** in `effectiveValue()` → control when the card can produce mana

For example, treasure producers (one-shot tokens):
- Already tagged: `treasure-producer` → `Ramp`
- Value: 1 (one treasure = one mana)
- Timing: similar to rituals — one-time benefit. Could set `effectiveValue` to return `value` only on T = cmc (the turn you get the treasure) and 0 after

For MDFCs with land backs counted as ramp — they'd need special handling since they're lands sometimes and spells sometimes.

---

## Extensibility Notes

The multivariate enumeration loop is the bottleneck for both complexity and accuracy. It currently has O(landCount × Π bucketCount) iterations. Each new "pool" of cards (e.g., tapped lands, treasure producers) adds a loop level. With ~5-8 groups total, iteration count is manageable for the typical case (most groups have ≤5 cards, so inner loops are short).

If performance becomes an issue (many ramp buckets × tapped/untapped split = 10+ groups), consider:
- Pruning: skip compositions where we've already determined enough mana
- Monte Carlo fallback for complex decks
- Memoization of logBinom values (already fast, but could precompute)
