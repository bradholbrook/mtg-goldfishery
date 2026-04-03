/**
 * MTG Goldfish Simulator - Core Data Structures
 * 
 * These structures define the shape of all data in the app.
 * Designed to grow incrementally — future fields are noted in comments.
 */

/**
 * A single card in the deck.
 * @typedef {Object} Card
 * @property {string}       name
 * @property {number}       quantity
 * @property {string[]}     types          - All face types combined; MDFCs include 'MDFC'
 * @property {boolean}      isCommander
 * @property {string|null}  oracleText     - Front face oracle text from Scryfall
 * @property {number|null}  cmc            - Front (spell) face CMC; use for casting cost
 * @property {string|null}  manaCost       - e.g. "{2}{B}{B}"
 * @property {string[]|null} keywords      - e.g. ["Flying", "Deathtouch"]
 * @property {string[]|null} producedMana  - e.g. ["B", "G"]
 * @property {string[]}     [colorIdentity] - Scryfall color identity e.g. ["W","U","G"]
 * @property {string|null}  scryfallId     - Printing-specific UUID from Scryfall
 * @property {string|null}  oracleId       - Oracle-level UUID (same across all printings)
 * @property {string|null}  set            - Scryfall set code, e.g. 'eld'
 * @property {string|null}  collectorNumber - Collector number within set, e.g. '10'
 * @property {boolean}      enriched       - true after Scryfall enrichment
 * @property {string[]}     otags          - Raw Scryfall Tagger oracle-tag slugs
 * @property {string[]}     categories     - Canonical categories derived from otags (e.g. 'Ramp', 'Mana Rock')
 * @property {EffectTag[]}  effectTags     - Detected/user-overridden effect tags (all faces merged)
 * @property {boolean}      [isMDFC]       - true for modal double-faced cards
 * @property {CardFace[]|null} [faces]     - Per-face data for MDFCs; null for single-faced cards
 * @property {string|null}  [imageUrl]     - Scryfall 'normal' image URL for the front face
 * @property {string|null}  [backImageUrl] - Scryfall 'normal' image URL for the back face (MDFCs only)
 * @property {string|null}  [power]        - Creature power (string e.g. "3", "*")
 * @property {string|null}  [toughness]    - Creature toughness
 * @property {string[]}     [supertypes]   - Scryfall supertypes: e.g. ['Basic'] | ['Legendary'] | []
 * @property {string[]}     [subtypes]     - Scryfall subtypes: e.g. ['Forest'] | ['Human','Wizard'] | []
 * @property {string[]}     [moxTags]      - Moxfield plain-text tags from import (e.g. #ramp, #!staple)
 */

/**
 * Filter describing which spell or event fires a triggered ability.
 * Used on cast-timing tags to restrict when the trigger fires.
 * null means "any spell / no filter".
 *
 * @typedef {Object} TriggerFilter
 * @property {string[]|null}              spellTypes    - Cast: CARD_TYPES values that must match (null = any spell)
 * @property {string[]|null}              [excludeTypes] - Cast: CARD_TYPES values that disqualify (e.g. noncreature)
 * @property {boolean}                    [isCommander] - Cast: only fire when your commander is cast
 * @property {'self'|'any_creature'|null} [deathSubject] - Death: what must die (null = no filter; track_only, not evaluated in sim)
 * @property {string[]|null}              [deathTypes]  - Death: creature subtype filter (future use)
 * @property {number|null}                [minCmc]      - Cast/ETB: minimum CMC of the spell/creature
 * @property {number|null}                [maxCmc]      - Cast/ETB: maximum CMC of the spell/creature
 * @property {number|null}                [maxPower]    - ETB: maximum power of the entering creature
 * @property {boolean}                    [nontoken]    - ETB: only non-token creatures trigger
 */

/**
 * Describes what a tutor is allowed to search for. All fields are ANDed.
 * @typedef {Object} FetchConstraint
 * @property {boolean}     any        - true = any card in the library
 * @property {boolean}     nonland    - true = any nonland card
 * @property {string|null}   supertype  - e.g. 'Basic' | 'Legendary' | null
 * @property {string|null}   type       - e.g. 'Creature' | 'Land' | 'InstantOrSorcery' | 'ArtifactOrEnchantment' | 'Permanent' | null
 * @property {string[]|null} subtypes   - land subtypes or creature subtypes (OR semantics); e.g. ['Plains','Island'] or ['Wizard']
 */

/**
 * A rule that tells the simulator what to fetch when a tutor resolves.
 * Rules are evaluated top-to-bottom; first matching rule with a valid library target wins.
 * @typedef {Object} TutorPriorityRule
 * @property {string} id
 * @property {'named'|'type'|'subtype'|'effect_category'} target
 * @property {string}  [cardName]       - target === 'named': exact card name to fetch
 * @property {string}  [cardType]       - target === 'type': fetch any card of this main type
 * @property {string}  [cardSubtype]    - target === 'subtype': fetch any card with this subtype
 * @property {string}  [effectCategory] - target === 'effect_category': fetch any card with this category
 * @property {boolean} [requireNotInHand] - if true, skip rule when any matching card is already in hand
 */

/**
 * A structured description of one effect on a card.
 * Built by detectEffectTags() at enrichment time.
 *
 * @typedef {Object} EffectTag
 * @property {'ramp'|'draw'|'tutor'} category
 * @property {'mana_rock'|'draw_n'|'tutor'} subtype
 * @property {number|null} value         - mana produced, cards drawn, etc.
 * @property {FetchConstraint|null} [fetchType]  - tutor: what the card searches for
 * @property {'hand'|'battlefield'|'top_of_library'} [putWhere]  - tutor: destination
 * @property {'auto'|'user'} source      - 'auto' = enrichment; 'user' = effect editor
 */

/**
 * One face of a Modal Double-Faced Card (MDFC).
 * Each face can be played independently — the player chooses at cast time.
 * @typedef {Object} CardFace
 * @property {string}      name
 * @property {string[]}    types       - e.g. ['Sorcery'] or ['Land']
 * @property {string|null} oracleText
 * @property {number|null} cmc
 * @property {string|null} manaCost
 * @property {string|null} power
 * @property {string|null} toughness
 * @property {string[]}    supertypes  - e.g. ['Basic'] | ['Legendary'] | []
 * @property {string[]}    subtypes    - e.g. ['Forest'] | ['Human','Wizard'] | []
 * @property {EffectTag[]} effectTags
 */

/**
 * A card on the battlefield with its current state.
 * @typedef {Object} BattlefieldCard
 * @property {Card}    card
 * @property {boolean} tapped
 * @property {number}  turnEntered
 * @property {Object}  counters       - per-card counter tracking, e.g. { burden: 2 }
 */

/**
 * Full game state for one simulated game.
 * @typedef {Object} GameState
 * @property {Card[]}            library            - top = index 0
 * @property {Card[]}            hand
 * @property {BattlefieldCard[]} battlefield
 * @property {Card[]}            graveyard
 * @property {Card[]}            commandZone
 * @property {number}            turn
 * @property {boolean}           landPlayedThisTurn
 * @property {number}            landDropsAvailable
 * @property {number}            manaAvailable      - total CMC-level mana (Phase 1)
 * @property {number}            commanderCastCount
 * @property {TurnRecord}        currentTurnRecord
 * @property {TurnRecord[]}      turnHistory
 * @property {boolean}           deckedOut
 */

/**
 * Log of events in a single turn.
 * @typedef {Object} TurnRecord
 * @property {number}   turn
 * @property {Card[]}   cardsDrawn
 * @property {Card[]}   landsPlayed
 * @property {Card[]}   spellsCast
 * @property {number}   manaSpent
 * @property {number}   manaAvailable  - total mana available at cast phase
 * @property {number}   manaFromRocks  - mana contributed by non-land sources
 * @property {string[]} effectsFired   - e.g. ['Phyrexian Arena:upkeep:draw']
 */

/**
 * User-configured simulation strategy.
 * @typedef {Object} StrategyConfig
 * @property {string[]} castPriority        - ordered category list, highest priority first
 * @property {'any'|'basic_first'|'dual_first'} landPriority
 * @property {number}   maxTurns            - default: 10
 * @property {boolean}  preferLowCMC        - tiebreaker within same priority category
 * @property {boolean}  castCommanderWhenAble
 */

/**
 * The full deck configuration — this is what gets saved/loaded as JSON.
 * @typedef {Object} DeckConfig
 * @property {string}         id              - UUID, generated on import
 * @property {string}         name            - Deck name from Moxfield or user-set
 * @property {string}         commander       - Commander card name
 * @property {string}         format          - 'commander' for now
 * @property {Card[]}         cards           - All 100 cards including commander
 * @property {string}         importedAt      - ISO timestamp
 * @property {string}         moxfieldUrl     - Original URL if pasted
 * @property {boolean}        enriched        - true if cards have Scryfall data
 * @property {GoodHandDef[]}      goodHandDefs        - User-defined hand quality checks
 * @property {DiscardPriority[]}  discardPriorities   - Ordered loot discard rules (additive; defaults to [])
 * @property {CastPriorityRule[]} [castPriorityRules]  - Ordered cast priority overrides (default: [])
 * @property {TutorPriorityRule[]} [tutorPriorityRules] - Ordered tutor fetch rules (default: [])
 * @property {Object}             [xCosts]            - { [cardName]: number } user-set X values for X-cost spells
 * @property {StrategyConfig}     strategyConfig      - Simulation strategy (merged with defaults)
 */

/**
 * A single simulated game's opening hand result.
 * @typedef {Object} OpeningHandResult
 * @property {Card[]} hand           - The 7 cards kept
 * @property {number} mulligans      - How many mulligans taken (0 for now)
 * @property {Object} typeCounts     - { Land: 2, Creature: 3, ... }
 * // Future: turn-by-turn state, mana available, spells cast, keyCardsFound
 */

/**
 * Aggregate results from N simulated games.
 * @typedef {Object} SimulationResults
 * @property {string} deckId
 * @property {number} gamesSimulated
 * @property {string} simulatedAt    - ISO timestamp
 * @property {OpeningHandResult[]} hands  - Raw hand data for each game
 * @property {Object} summary         - Computed aggregate stats
 * @property {Object} summary.avgTypeCounts          - { Land: 2.8, Creature: 2.1, ... }
 * @property {Object} summary.typeSeenPct            - % of hands containing each type
 * @property {number} summary.goodLandHandPct        - % hands with 3-4 lands
 * @property {Object} summary.deckTypeDistribution   - % of deck by type
 * @property {Object} [summary.avgCardsDrawnByTurn]  - cumulative cards drawn by turn N
 * @property {number} [summary.avgEffectDrawsPerGame] - avg effect-triggered draws per game
 * @property {number} [summary.pctGamesWithDrawEffect] - % games with draw engine in play
 * @property {Object} [summary.drawEffectSourceBreakdown] - avg draws per card per game
 */

/**
 * A single hand-evaluation criterion.
 * @typedef {Object} Criterion
 * @property {string}  type       - Registry key, e.g. 'card_in_hand' | 'at_least_type'
 * @property {string}  [cardName] - card_in_hand: the card that must be present
 * @property {number}  [count]    - at_least_type: minimum count required
 * @property {string}  [cardType] - at_least_type: the CARD_TYPE to count
 */

/**
 * A named set of criteria defining what a "good hand" looks like.
 * A hand qualifies only when ALL criteria pass (AND logic).
 * @typedef {Object} GoodHandDef
 * @property {string}      id       - UUID
 * @property {string}      name     - User label, e.g. "Keepable Ramp Hand"
 * @property {Criterion[]} criteria
 */

/**
 * An Effect Lab definition — one analysis on the Calculate tab.
 * @typedef {Object} EffectDef
 * @property {string}      id         - UUID
 * @property {string}      name       - User label, e.g. "Scry 3"
 * @property {number}      lookAtN    - Cards looked at off the top (1..99)
 * @property {number}      hitTarget  - Desired hits (1..lookAtN)
 * @property {Criterion[]} criteria   - Evaluated per-card (count forced to 1)
 */

/**
 * A rule that overrides the default category-based cast ordering.
 * Rules are evaluated in order; first match wins and assigns a strongly negative
 * priority score that beats any category. A card with no matching rule falls
 * through to the normal category + CMC tiebreak scoring.
 *
 * @typedef {Object} CastPriorityRule
 * @property {string} id
 * @property {'named'|'type'|'subtype'|'effect_category'} match
 * @property {string}  [cardName]       - match === 'named': exact card name
 * @property {string}  [cardType]       - match === 'type': e.g. 'Creature', 'Artifact'
 * @property {string}  [cardSubtype]    - match === 'subtype': e.g. 'Elf', 'Equipment'
 * @property {string}  [effectCategory] - match === 'effect_category': e.g. 'draw', 'ramp'
 */

/**
 * A single discard priority rule for loot effects.
 * Rules are evaluated top-to-bottom; first matching rule wins.
 * @typedef {Object} DiscardPriority
 * @property {string} id
 * @property {'highest_cmc'|'lowest_cmc'|'any'} modifier
 * @property {string} cardType  - CARD_TYPES value, or 'Any' for no filter
 */

/**
 * The full save file structure — everything needed to restore app state.
 * @typedef {Object} SaveFile
 * @property {string} version        - Schema version, e.g. "1.0"
 * @property {string} savedAt        - ISO timestamp
 * @property {DeckConfig[]} decks    - All imported decks
 * @property {SimulationResults[]} results  - All past simulation runs
 * // Future: userPreferences{}, sharedProfiles[]
 */

export const CURRENT_SAVE_VERSION = "3.0";

/** Default StrategyConfig — merged with any deck-level config before simulating. */
export const DEFAULT_STRATEGY_CONFIG = {
  bottomPriorities: [],  // Ordered rules for what to put back when mulliganing
};

/**
 * Canonical functional categories used for mulligan analysis.
 * Aligned with the Archidekt/Command Zone template vocabulary.
 */
export const CANONICAL_CATEGORIES = [
  'Ramp', 'Mana Rock', 'Mana Dork', 'Card Draw', 'Interaction', 'Board Wipe', 'Tutor', 'Mill', 'Cascade', 'Discover',
];

/** Card types we recognize and display (order matters for UI) */
export const CARD_TYPES = [
  'Land',
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Battle',
  'MDFC',
  'Other'
];

/** Generate a simple UUID for deck IDs */
export function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
