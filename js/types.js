/**
 * MTG Goldfish Simulator - Core Data Structures
 * 
 * These structures define the shape of all data in the app.
 * Designed to grow incrementally — future fields are noted in comments.
 */

/**
 * A single card in the deck.
 * @typedef {Object} Card
 * @property {string} name
 * @property {number} quantity
 * @property {string[]} types        - ['Creature'], ['Instant'], ['Land'], etc.
 * @property {boolean} isCommander
 * // Future: manaCost, cmc, tags[], oracleText, scryfallId, priority, isKeyCard
 */

/**
 * The full deck configuration — this is what gets saved/loaded as JSON.
 * @typedef {Object} DeckConfig
 * @property {string} id             - UUID, generated on import
 * @property {string} name           - Deck name from Moxfield or user-set
 * @property {string} commander      - Commander card name
 * @property {string} format         - 'commander' for now
 * @property {Card[]} cards          - All 100 cards including commander
 * @property {string} importedAt     - ISO timestamp
 * @property {string} moxfieldUrl   - Original URL if pasted
 * // Future: strategyConfig{}, keyCards[], winConditions[], notes
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
 * @property {string} simulatedAt   - ISO timestamp
 * @property {OpeningHandResult[]} hands  - Raw hand data for each game
 * @property {Object} summary        - Computed aggregate stats
 * @property {Object} summary.avgTypeCountsInHand   - { Land: 2.8, Creature: 2.1, ... }
 * @property {Object} summary.typeDistribution      - % of deck by type
 * @property {number} summary.avgLandsInHand
 * // Future: avgKillTurn, commanderOnCurvePct, keyCardSeenByTurnN, etc.
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

export const CURRENT_SAVE_VERSION = "1.0";

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
  'Other'
];

/** Generate a simple UUID for deck IDs */
export function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
