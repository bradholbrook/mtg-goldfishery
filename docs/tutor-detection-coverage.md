# Tutor Detection Coverage

Detection lives in `effects.js` → `detectTutorTag()` + `parseFetchConstraint()`.

The trigger: **"Search your library for (.+?) card(s)"**

---

## What Is Detected (auto-tagged as `tutor · simulatable`)

### Destination (`putWhere`)
| Oracle text | putWhere |
|---|---|
| "put it onto the battlefield" | `battlefield` |
| "on top of your library" | `top_of_library` |
| anything else (into your hand, etc.) | `hand` |

### Fetch Constraint (`fetchType`)

| What oracle text says | FetchConstraint result |
|---|---|
| "any card" / "a card" / "cards" | `{ any: true }` |
| "a basic land card" | `{ supertype:'Basic', type:'Land' }` |
| "a basic Forest card" | `{ supertype:'Basic', type:'Land', subtypes:['Forest'] }` |
| "a Plains or Island card" (fetch lands) | `{ type:'Land', subtypes:['Plains','Island'] }` |
| "a land card" | `{ type:'Land' }` |
| "a creature card" | `{ type:'Creature' }` |
| "an artifact card" | `{ type:'Artifact' }` |
| "an enchantment card" | `{ type:'Enchantment' }` |
| "an artifact or enchantment card" | `{ type:'ArtifactOrEnchantment' }` |
| "a planeswalker card" | `{ type:'Planeswalker' }` |
| "an instant or sorcery card" | `{ type:'InstantOrSorcery' }` |
| "a sorcery card" | `{ type:'Sorcery' }` |
| "an instant card" | `{ type:'Instant' }` |
| "a permanent card" | `{ type:'Permanent' }` |
| "a nonland card" | `{ nonland:true }` |
| "a legendary creature card" | `{ supertype:'Legendary', type:'Creature' }` |
| "a snow land card" | `{ supertype:'Snow', type:'Land' }` |

### Timing
Timing is determined by the surrounding ability block (same as draw/loot detection):
- ETB permanent → `etb`
- Sorcery/instant → `on_resolution`
- Upkeep trigger → `upkeep`
- Cast trigger → `cast`

### Examples of cards that auto-detect correctly
- **Demonic Tutor** (sorcery, any → hand) ✓
- **Vampiric Tutor** (instant, any → top) ✓
- **Enlightened Tutor** (instant, artifact or enchantment → top) ✓
- **Mystical Tutor** (instant, instant or sorcery → top) ✓
- **Worldly Tutor** (instant, creature → top) ✓
- **Fetch lands** (Flooded Strand etc., Plains or Island → battlefield) ✓
- **Green Sun's Zenith** (sorcery, basic Forest → battlefield) ✓
- **Cultivate / Kodama's Reach** — these are land ramp, not tutor tag — detected separately as `land_ramp` (track_only)
- **Solemn Simulacrum** (ETB, basic land → hand) ✓

---

## Known Gaps / Not Yet Detected

### MV / CMC restrictions
Tutors that limit search by mana value are detected as `any` or their base type only —
the CMC filter is silently dropped.

Examples:
- **Eldritch Evolution**: "Search your library for a creature card with mana value X or less" — detected as `{ type:'Creature' }`, ignores the X+2 CMC cap
- **Finale of Devastation** (X ≤ X): similar
- **Prime Speaker Vannifar**: ETB tutor with CMC = 1 + sacrificed creature's CMC — not modeled

**Future**: Add `maxCmc: number|null` and `minCmc: number|null` to `FetchConstraint`. Detect patterns like `mana value (\d+) or less`.

### Named card search ("a card named X")
The pattern "search your library for a card named ___" is not detected — the capture
group becomes "a card named Emrakul, the Aeons Torn" which falls through to `{ any: true }`.

**Future**: detect `/a card named (.+)/i` → `{ namedCard: 'Emrakul, the Aeons Torn' }`. Would need `namedCard: string|null` field on `FetchConstraint`.

### Color / devotion restrictions
- **Gray Merchant of Asphodel**: searches for a creature with devotion to black — not modeled
- Color identity filters (e.g. "black creature card") — color words aren't in the detection table

### "Up to N" / any number of (quantity)
Quantity qualifiers ("up to two creature cards", "any number of basic lands") are stripped —
only the type is captured. The simulator always fetches exactly one card per tutor cast.

**Future**: add `count: number` to model multi-target tutors like Diabolic Revelation.

### Conditional tutors
Tutors with a condition in the trigger ("if you control a swamp, search…") are tagged with
`timing` from the trigger, but no conditional flag is set. They'll be cast unconditionally.

### Specific non-standard search phrasing
Scryfall `otag:tutor` contains many cards. Phrases like:
- "look at the top N cards, put one into your hand" — currently detected as draw (conditional)
- "exile the top N cards, you may cast one" — not detected as tutor
- "you may search your library" — the "you may" is stripped by the effect text; detection still works

### Land ramp vs. land tutor
Cards that search for lands AND put them directly onto the battlefield (Cultivate, Farseek, etc.)
are tagged as `land_ramp` (`track_only`) by a separate pattern in the land ramp section —
they won't also produce a tutor tag. This is intentional: Phase 2 land ramp simulation is
a separate feature.
