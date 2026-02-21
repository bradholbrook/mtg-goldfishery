/**
 * MTG Goldfish Simulator - Moxfield Decklist Parser
 *
 * Parses Moxfield plain-text export format into Card[].
 *
 * Moxfield export format (text):
 *   Commander
 *   1 Atraxa, Praetors' Voice
 *
 *   Deck
 *   1 Sol Ring
 *   1 Arcane Signet
 *   ...
 *
 * Or the simpler "just paste 100 lines" format:
 *   1 Sol Ring
 *   1 Forest
 *   ...
 *
 * We do NOT call Scryfall in this phase.
 * Card types are stubbed as ['Unknown'] until Scryfall enrichment is added.
 * Commander is detected from the "Commander" section header.
 */

import { generateId, CARD_TYPES } from './types.js';

/**
 * Infer a primary card type from the card name heuristically.
 * This is a very rough fallback — Scryfall will replace this in a later phase.
 * For MVP we rely on it only to give *some* type breakdown.
 */
const LAND_KEYWORDS = [
  'plains', 'island', 'swamp', 'mountain', 'forest',
  'gate', 'temple', 'fetch', 'shock', 'tundra', 'scrubland',
  'plateau', 'savannah', 'taiga', 'badlands', 'bayou',
  'command tower', 'evolving wilds', 'terramorphic', 'field of the dead',
  'cavern of souls', 'vault of champions', 'path of ancestry',
  'reflecting pool', 'exotic orchard', 'mana confluence',
];

/**
 * Very naive name-based type guesser for MVP.
 * Returns one of the CARD_TYPES values.
 */
function guessTypeFromName(name) {
  const lower = name.toLowerCase();
  for (const kw of LAND_KEYWORDS) {
    if (lower.includes(kw)) return 'Land';
  }
  return 'Unknown';
}

/**
 * Parse a single line like "1 Sol Ring" or "4 Lightning Bolt".
 * Returns { quantity, name } or null if the line is not a card entry.
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  // Match "N Card Name" — quantity is 1 or 2 digits
  const match = trimmed.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return null;

  const quantity = parseInt(match[1], 10);
  // Strip set/collector info that some exports append: "Sol Ring (C21) 263"
  const name = match[2].replace(/\s*\([^)]+\)\s*\d*\s*$/, '').trim();

  if (!name || quantity < 1) return null;
  return { quantity, name };
}

/**
 * Parse a Moxfield-format decklist string.
 *
 * @param {string} text - Raw pasted decklist text
 * @param {string} [deckName] - Optional override for deck name
 * @returns {{ deck: DeckConfig, errors: string[] }}
 */
export function parseMoxfieldDecklist(text, deckName = 'Unnamed Deck') {
  const errors = [];
  const cardMap = new Map(); // name → Card (to dedupe)

  let commanderName = null;
  let inCommanderSection = false;
  let inDeckSection = false;
  let inSideboardSection = false;

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Section headers
    if (/^commander$/i.test(line)) { inCommanderSection = true; inDeckSection = false; inSideboardSection = false; continue; }
    if (/^deck$/i.test(line)) { inDeckSection = true; inCommanderSection = false; inSideboardSection = false; continue; }
    if (/^sideboard$/i.test(line) || /^maybeboard$/i.test(line)) { inSideboardSection = true; inCommanderSection = false; inDeckSection = false; continue; }
    if (/^companion$/i.test(line)) { inSideboardSection = true; inCommanderSection = false; inDeckSection = false; continue; }

    // Skip sideboard/maybeboard
    if (inSideboardSection) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;

    const { quantity, name } = parsed;
    const isCommander = inCommanderSection;

    if (isCommander && !commanderName) {
      commanderName = name;
    }

    // If no section headers found, treat all lines as deck cards
    // (handles simple paste format)
    const effectivelyInDeck = inDeckSection || inCommanderSection ||
      (!inDeckSection && !inCommanderSection && !inSideboardSection);

    if (!effectivelyInDeck) continue;

    if (cardMap.has(name)) {
      // Accumulate quantity if same card appears multiple times
      cardMap.get(name).quantity += quantity;
    } else {
      cardMap.set(name, {
        name,
        quantity,
        types: [guessTypeFromName(name)], // Placeholder until Scryfall
        isCommander,
        // Future fields: manaCost, cmc, tags, oracleText, scryfallId, priority
      });
    }
  }

  const cards = Array.from(cardMap.values());

  // Validation
  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  if (totalCards === 0) {
    errors.push('No cards found. Make sure you pasted a valid Moxfield decklist.');
  } else if (totalCards < 99 || totalCards > 101) {
    errors.push(`Found ${totalCards} cards — expected 100 for Commander. Proceeding anyway.`);
  }

  if (!commanderName && cards.length > 0) {
    // Try to auto-detect: if no Commander section, user may not have labeled it
    // We'll leave it null and let the user set it later
    errors.push('No Commander section found. You can set your commander manually.');
  }

  // Attempt to extract deck name from comments like "// Atraxa Superfriends" at top
  const firstComment = lines.find(l => l.trim().startsWith('//'));
  const extractedName = firstComment
    ? firstComment.replace('//', '').trim()
    : null;

  const deck = {
    id: generateId(),
    name: extractedName || deckName,
    commander: commanderName,
    format: 'commander',
    cards,
    importedAt: new Date().toISOString(),
    moxfieldUrl: null,
    // Future: strategyConfig, keyCards, winConditions
  };

  return { deck, errors };
}

/**
 * Quick sanity summary of a parsed deck for display.
 */
export function getDeckSummary(deck) {
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);
  const typeCounts = {};
  for (const card of deck.cards) {
    const type = card.types[0] || 'Unknown';
    typeCounts[type] = (typeCounts[type] || 0) + card.quantity;
  }
  return { total, typeCounts, commander: deck.commander };
}
