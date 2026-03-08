# Cast Priority Rules & Tutor Simulation — Design

## Overview

Two related features that together let the simulator make smarter casting decisions:

1. **Cast Priority Rules** — a ranked list of rules (named card, type, effect category, with optional conditions) that override the default category-based cast ordering.
2. **Tutor Simulation** — detect tutor cards from oracle text, let users configure what to search for and when, and simulate the fetch at resolution time.

Both are deck-level config (like `discardPriorities`) and stored in the save file as additive fields — no save version bump needed.

---

## Prerequisite: Full Type Parsing

### Why This Is Needed

The current `card.types` is a simplified list derived by parsing the `type_line` string with `typeLineToTypes()`. It captures main types (`['Creature', 'Artifact']`) but not **supertypes** (Basic, Legendary, Snow) or **subtypes** (Forest, Wizard, Equipment). Both features need all three tiers, and Scryfall already provides them as structured arrays — there's no reason to keep the parsing layer.

### Scryfall Type Arrays

Scryfall provides three pre-computed arrays on every card and card face:

```
supertypes: ['Basic'] | ['Legendary'] | ['Snow'] | []
types:      ['Land'] | ['Creature', 'Artifact'] | ...
subtypes:   ['Forest'] | ['Human','Wizard'] | ['Equipment'] | []
```

These replace the output of `typeLineToTypes()`. Using Scryfall's arrays directly:
- Eliminates the risk of `type_line` parsing drift
- Gives subtypes for free (Forest, Island, Human, Wizard, Equipment, etc.)
- Keeps all three tiers consistent with Scryfall's authoritative data

Typed land subtypes matter for tutor constraints:
- "Search for a Forest" → any card with `subtypes.includes('Forest')` (covers basic Forest, Tropical Island, Taiga, Sheltered Thicket, etc.)
- "Search for a basic Forest" → supertype `Basic` + subtype `Forest`
- Dual lands carry multiple land subtypes (Tropical Island: `['Forest','Island']`)

### New Card Schema Fields

Replace the `typeLineToTypes()`-derived `card.types` with Scryfall's arrays on `Card` and `CardFace`:

```js
types:      string[],  // Scryfall types[]:      ['Land'] | ['Creature','Artifact'] | ...
supertypes: string[],  // Scryfall supertypes[]: ['Basic'] | ['Legendary'] | []
subtypes:   string[],  // Scryfall subtypes[]:   ['Forest'] | ['Human','Wizard'] | []
```

`card.types` retains its role in type-count breakdowns, UI type bars, and simulator type checks — same field, better source. The `'MDFC'` sentinel is still appended to `card.types` for MDFCs (not a Scryfall type, it's our internal tag).

For MDFCs, each face gets its own `supertypes`/`subtypes`/`types` from Scryfall's `card_faces[]`. The card-level `types` continues to be the union of all face types + `'MDFC'`; `supertypes` and `subtypes` are face-level only.

### Migration in `enrichment.js`

In both the MDFC and single-face branches, replace `typeLineToTypes(typeLine)` calls with:

```js
types:      scryfallCard.types      ?? face.types      ?? [],
supertypes: scryfallCard.supertypes ?? face.supertypes ?? [],
subtypes:   scryfallCard.subtypes   ?? face.subtypes   ?? [],
```

`typeLineToTypes()` and `typeLineToType()` can be removed once all callers are updated. Old saves that lack `supertypes`/`subtypes` default to `[]` — no migration needed. The type-count breakdown logic and UI are unaffected (they read `card.types`, which is now sourced from Scryfall instead of parsed).

---

## Feature 1: Cast Priority Rules

### Goal

Let users express casting intent beyond the flat category order:
- "Always cast Sol Ring first"
- "Cast ramp artifacts before other artifacts"
- "Hold commander until turn 5"
- "Cast draw engines only if a mana rock is already in play"

### Commander Note

Commander is a special case and is handled separately in a later phase. It does not live in the library — it is always accessible from the command zone — and carries commander tax (cumulative +2 per prior cast). The current `effectiveCost()` already models the tax. A future `CastPriorityRule` with `match: 'commander'` would need to check `card.isCommander` rather than a name, and conditions like `minTurn` are especially relevant here. For now, mark as out of scope and note it in the UI.

### Data Model

```js
/**
 * @typedef {Object} CastPriorityRule
 * @property {string}   id
 * @property {'named'|'type'|'subtype'|'effect_category'} match
 * @property {string}   [cardName]       - match === 'named': exact card name
 * @property {string}   [cardType]       - match === 'type': 'Creature','Artifact',...
 * @property {string}   [cardSubtype]    - match === 'subtype': 'Elf','Equipment',...
 * @property {string}   [effectCategory] - match === 'effect_category': 'draw','ramp'
 * // Conditions — all must pass for the rule to apply:
 * @property {number}   [minTurn]
 * @property {number}   [maxTurn]
 * @property {string[]} [requireInPlay]     // card names that must be on battlefield
 * @property {string[]} [requireNotInPlay]
 */
```

Stored as `deck.castPriorityRules: CastPriorityRule[]`. Default: `[]`.

### `castScore` Integration

Rules are evaluated before the existing category array. First matching rule (where match is true AND all conditions pass) assigns a strongly negative score so any rule always beats any category:

```
Rule at index i of N total rules → score = (i - N) * 10000
```

- Rule 0: score = `-N * 10000` (highest priority)
- Rule N-1: score = `-1 * 10000`
- No matching rule: `categoryIndex * 1000 + cmcTiebreak` (existing behavior, unchanged)

A card whose rule condition doesn't pass (e.g. `minTurn: 6` on turn 3) falls through to category scoring as if no rule existed — so it remains castable at normal priority.

### UI (Config Tab, above Discard Priorities)

```
Cast Priority Rules                                  [+ Add Rule]

  ⠿  Sol Ring                                               [✕]
  ⠿  Effect: Ramp   if Sol Ring in play                     [✕]
  ⠿  Type: Artifact   turn 2+                               [✕]
  ⠿  [Commander — configured separately, see below]

  (drag to reorder)
```

Add rule inline-expands a small form:
- **Match** dropdown: Named Card / Card Type / Card Subtype / Effect Category
- **Condition** section (optional, collapsed by default): Min Turn / Max Turn / Require In Play (comma-separated names) / Require Not In Play

The existing category ordering drag-list (the `castPriority` array) stays unchanged — cast priority rules are layered on top as named/conditional overrides.

---

## Feature 2: Tutor Simulation

### Tutor Detection (`effects.js`)

New effect subtype `tutor`, category `tutor`.

```js
{
  subtype: 'tutor',
  category: 'tutor',
  timing: 'on_resolution' | 'etb',   // ETB for Recruiter of the Guard etc.
  fetchType: FetchConstraint,         // see below
  putWhere: 'hand' | 'battlefield' | 'top_of_library',
  fetchCount: 1,                      // future: "up to 2" tutors
}
```

#### FetchConstraint

```js
/**
 * Describes what a tutor is allowed to search for.
 * All fields are ANDed together.
 * @typedef {Object} FetchConstraint
 * @property {string|null} supertype    // 'Basic' | null
 * @property {string|null} type         // 'Creature' | 'Land' | 'Artifact' | null (null = any)
 * @property {string|null} subtype      // 'Forest' | 'Wizard' | null
 * @property {boolean}     nonland      // true = any nonland card (e.g. Demonic Tutor)
 * @property {boolean}     any          // true = truly any card
 */
```

Examples:
| Oracle text | FetchConstraint |
|---|---|
| "search for a card" | `{ any: true }` |
| "search for a nonland card" | `{ nonland: true }` |
| "search for a basic land card" | `{ supertype:'Basic', type:'Land' }` |
| "search for a land card" | `{ type:'Land' }` |
| "search for a Forest card" | `{ type:'Land', subtype:'Forest' }` |
| "search for a basic Forest card" | `{ supertype:'Basic', type:'Land', subtype:'Forest' }` |
| "search for a creature card" | `{ type:'Creature' }` |
| "search for an artifact card" | `{ type:'Artifact' }` |
| "search for an instant or sorcery" | `{ type:'InstantOrSorcery' }` (special case) |
| "search for a permanent card" | `{ type:'Permanent' }` (special case) |

**Typed land subtypes** (Forest, Island, Mountain, Plains, Swamp, and duals like Tropical Island carrying `Forest` + `Island` subtypes) are matched via `card.subtypes.includes(subtype)`. This covers fetchtype-restricted basics searches and Farseek-style fetches that find any Forest regardless of it being basic.

**Destination detection** from oracle text:
- "put it onto the battlefield" → `putWhere: 'battlefield'`
- "put it on top of your library" → `putWhere: 'top_of_library'`
- Default (hand, shuffle) → `putWhere: 'hand'`

#### Tier Assignment

Tutors are `tier: 'simulatable'` only when a `TutorPriorityRule` can resolve what to fetch. Without rules, the tutor fires but does nothing — see No-Match Behavior below. Detecting the presence of rules happens at simulation time, not at tag-assignment time, so the tier stays `simulatable` and the UI shows a note.

---

### Tutor Priority Rules

```js
/**
 * @typedef {Object} TutorPriorityRule
 * @property {string}   id
 * @property {'named'|'type'|'subtype'|'effect_category'} target
 * @property {string}   [cardName]       // specific card to fetch
 * @property {string}   [cardType]       // fetch any card of this type
 * @property {string}   [cardSubtype]    // fetch any card with this subtype
 * @property {string}   [effectCategory] // fetch any card with this effect category
 * // Conditions:
 * @property {string[]} [requireInPlay]     // these cards must be on the battlefield
 * @property {string[]} [requireNotInPlay]  // these cards must NOT be on the battlefield
 * @property {string[]} [requireNotInHand]  // don't fetch if already in hand
 * @property {number}   [minManaAfterCast]  // gs.manaAvailable after paying tutor cost must be >= N
 */
```

Stored as `deck.tutorPriorityRules: TutorPriorityRule[]`. Default: `[]`.

---

### No-Match Behavior

If `tutorPriorityRules` is empty, or every rule fails its conditions, or no matching card exists in the library for any passing rule: **the tutor is not cast this turn**. It stays in hand.

This is intentional: a tutor without a configured target is indeterminate — casting it and fetching an arbitrary card would produce misleading simulation results.

**Rules are re-evaluated every turn.** The tutor stays in hand and is reconsidered each main-phase pass. Conditions that were unmet on turn 3 (e.g. `requireInPlay: ['Sol Ring']` before Sol Ring was cast) may be satisfied on turn 4. The tutor will fire as soon as a rule matches and its target exists in the library.

The Config UI surfaces a warning when no rules exist:

```
Tutor Priorities
  Tutors in deck: Demonic Tutor, Vampiric Tutor, Enlightened Tutor
  [!] No tutor priority rules defined — tutors will not be cast during simulation.

  [+ Add Rule]
```

When rules are defined but all fail on a given turn, no specific warning is shown — the tutor simply waits in hand. A future simulation results view could surface "tutors that never fired" for debugging.

---

### Simulation Logic

Called when a tutor card resolves (after `resolveDrawEffects`/`resolveLootEffects` hooks, in the cast loop):

```
function resolveTutor(gs, tutorCard, tutorTag, turn):

  manaRemaining = gs.manaAvailable  // already decremented by tutor cost
  constraint = tutorTag.fetchType

  for rule in deck.tutorPriorityRules:
    // 1. Check conditions
    if rule.requireInPlay and not all in gs.battlefield → skip
    if rule.requireNotInPlay and any in gs.battlefield → skip
    if rule.minManaAfterCast and manaRemaining < N → skip

    // 2. Find target in library
    target = findInLibrary(gs.library, rule, constraint)
    if not target → skip   // card doesn't exist in library

    // 3. Match found
    if tutorTag.putWhere === 'hand':
      remove from library, add to gs.hand
      shuffle library
    elif tutorTag.putWhere === 'battlefield':
      remove from library
      bfEntry = { card: target, tapped: target.etbTapped ?? false, turnEntered: turn, counters: {} }
      gs.battlefield.push(bfEntry)
      // Fire ETB effects — the card entered the battlefield, not cast.
      // ETB is not a cast trigger; other battlefield permanents' ETB watchers fire.
      resolveDrawEffects(gs, 'etb', [bfEntry])
      resolveLootEffects(gs, 'etb', [bfEntry])
      if target is a creature:
        watcherSubset = gs.battlefield.filter(bf => bf.card !== target)
        resolveDrawEffects(gs, 'creature_etb', watcherSubset, target)
        resolveLootEffects(gs, 'creature_etb', watcherSubset, target)
      if target is a land:
        resolveDrawEffects(gs, 'land_etb')
        resolveLootEffects(gs, 'land_etb')
      shuffle library
    elif tutorTag.putWhere === 'top_of_library':
      remove from library, unshift to front of library
      // No shuffle — the card is on top. It will be drawn next draw step.
      // No mana or ETB effects this turn. Main-phase loop does not restart.

    return  // done

  // No rule matched — tutor stays in hand (caller must not remove it from hand)
  return NO_MATCH
```

`findInLibrary(library, rule, constraint)` checks each library card against:
1. The tutor's `FetchConstraint` (type/subtype/supertype must match)
2. The rule's target (name, type, subtype, or effectCategory)
3. For `requireNotInHand`: card name must not be in `gs.hand`

The main-phase cast loop checks the return value: if `NO_MATCH`, the tutor is treated as un-castable this turn (removed from the `castable` set for this pass). The loop continues without it.

### ETB Note

When a card is tutored directly onto the battlefield (`putWhere: 'battlefield'`), it entered but was not cast. This means:
- **ETB triggers fire** — `resolveDrawEffects(gs, 'etb', [bfEntry])` runs, as does `creature_etb` / `land_etb` as appropriate
- **Cast triggers do NOT fire** — `resolveDrawEffects(gs, 'cast', ...)` is skipped (the tutor card itself was cast, not the tutored card)
- Other battlefield permanents that watch for ETBs (Soul of the Harvest, Tatyova) respond normally
- The tutored permanent also fires its own ETB effect tags (e.g. a draw-on-ETB creature entering via Chord of Calling will draw)

### Top-of-Library Tutors

Vampiric Tutor, Mystical Tutor, and similar `top_of_library` tutors:
- The tutored card is placed at index 0 of `gs.library` (front of the draw pile)
- The library is **not shuffled** after — the card is known to be on top
- No cards are added to hand this turn; the main-phase loop does not restart from this
- The tutored card is drawn at the next draw step, or immediately if an additional draw fires this turn (e.g. a Rhystic Study trigger or end-step draw)

These tutors have lower same-turn simulation value than `hand` tutors — the benefit is deferred. If an additional draw fires later in the same turn (end step, tap ability), the tutored card becomes available within the same game turn. This is modeled correctly without special-casing, since `gs.library[0]` is simply the next card drawn.

---

### UI (Config Tab)

```
Tutor Priorities
  Tutors in deck: Demonic Tutor, Vampiric Tutor
  [!] Define rules below — tutors will not be cast if no rule matches.

  ⠿  Sol Ring   if not in hand, not in play                [✕]
  ⠿  Effect: Draw   if ≥2 mana after cast                  [✕]
  ⠿  Effect: Ramp                                           [✕]

  [+ Add Rule]
```

Deck's tutor cards listed as non-editable context chips at top. Warning banner when list is empty. Each rule chip shows target + active conditions inline.

Add rule form: target dropdown (Named Card / Card Type / Card Subtype / Effect Category), then condition toggles (Require Not In Hand checkbox, Require In Play name input, Require Not In Play name input, Min Mana After Cast number).

---

## Phasing

### Phase 1 — Type System Migration + Cast Priority Rules (no conditions)
- Replace `typeLineToTypes()` with Scryfall's `types[]`/`supertypes[]`/`subtypes[]` arrays in `enrichment.js`
- Remove `typeLineToTypes()` and `typeLineToType()` once all call sites are updated
- `CastPriorityRule` with `match`, `cardName`, `cardType`, `effectCategory` only
- `castScore` integration
- Config tab UI + drag-to-reorder

### Phase 2 — Tutor Detection + Simple Tutor Priorities
- `FetchConstraint` + oracle text patterns in `effects.js`
- `TutorPriorityRule` with named/type/effect_category target + `requireNotInHand`
- `resolveTutor()` in `simulator.js`
- No-match behavior (tutor stays in hand)
- Config tab UI
- ETB effects when tutored to battlefield

### Phase 3 — Conditions
- Cast priority: `minTurn`, `maxTurn`, `requireInPlay`, `requireNotInPlay`
- Tutor priority: `requireInPlay`, `requireNotInPlay`, `minManaAfterCast`
- Condition display in UI chips

### Phase 4 — Commander Rules
- `match: 'commander'` in `CastPriorityRule` (checks `card.isCommander`)
- Commander tax already modeled in `effectiveCost()` — no sim change needed
- Conditions (`minTurn`, `requireInPlay`) especially useful for stax/timing decisions
- Commander lives in command zone, not library; never a tutor target in standard goldfishing
