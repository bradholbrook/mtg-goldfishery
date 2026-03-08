sources
https://hudecekpetr.cz/a-formal-grammar-for-magic-the-gathering/
https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough
https://lutris.net/games/mtg-forge/
https://github.com/Zannick/demystify


# Parsing Magic: The Gathering with AI agents and regex

**MTG oracle text is one of the most regex-friendly natural languages in existence, and a hybrid regex-plus-AI approach can classify 95%+ of all Commander-legal cards for under $3 in total API costs.** The key insight is that Wizards of the Coast maintains a rigidly templated controlled natural language across 30+ years and 27,000+ unique cards — with retroactive errata ensuring uniform syntax. This means a layered regex system can handle the vast majority of cards, while AI agents mop up the 5–10% long tail. Multiple open-source projects (Forge, Demystify, MTG Arena's own parser) have validated this general architecture, and modern LLM batch processing with prompt caching makes the AI layer remarkably cheap.

---

## Why MTG oracle text is uniquely parseable

MTG oracle text operates as a **controlled natural language** — a constrained subset of English with rigid syntactic rules enforced by Wizards of the Coast's templating team. Per Comprehensive Rule 113.2c, each paragraph break in a card's text marks a separate ability, making `\n` a reliable delimiter. The colon `:` is the definitive structural marker for activated abilities, appearing nowhere else in functional rules text. Triggered abilities always begin with exactly one of three words: `When`, `Whenever`, or `At`. Replacement effects follow the `"if X would Y, Z instead"` frame. Mana symbols use a closed curly-brace encoding (`{W}`, `{U}`, `{T}`, `{2/B}`, `{W/P}`). Reminder text always sits inside parentheses.

Critically, WotC retroactively updates all 27,000+ cards' oracle text whenever templates change. When "mill" became a keyword, every card that previously said "put the top N cards of your library into your graveyard" was reworded. When "dies" replaced "is put into a graveyard from the battlefield," thousands of cards updated simultaneously. **You never need to handle legacy wordings** — one regex pattern works across three decades of cards.

The structural consistency is quantifiable. Each ability type has a distinct syntactic signature:

| Ability type | Syntactic pattern | Regex anchor |
|---|---|---|
| Activated | `[Cost]: [Effect]` | `:` colon separator |
| Triggered | `When/Whenever/At [condition], [effect]` | `^(When\|Whenever\|At)` |
| Static | Declarative statements (no colon, no trigger word) | Identified by exclusion |
| Replacement | `If [event] would [happen], [alternative] instead` | `would … instead` |
| Keyword | Single word/short phrase from finite list | Dictionary match against ~100 terms |
| Mana ability | `{T}: Add {color}` | `{T}: Add` pattern |
| Loyalty | `[+N]/[-N]/[0]: [effect]` | `^[+−]?\d+:` |
| Modal | `Choose one —` followed by `•` bullets | `Choose (one\|two\|…) —` |
| Saga chapter | `I, II — [effect]` | Roman numeral + em dash |

Multiple independent projects have built formal grammars (ANTLR4, PEG, Nearley) for MTG text, confirming its grammar-like regularity. Petr Hudeček's ANTLR4 grammar successfully parsed all 273 cards in Guilds of Ravnica into syntax trees. The Demystify project parsed all 14,715 cards' cost and type lines with zero errors. These projects demonstrate that **MTG text sits in a sweet spot** — structured enough for pattern matching, but with enough natural-language complexity to require layered approaches for full coverage.

---

## What existing projects reveal about the parsing problem

No project has achieved fully automated oracle-text-to-executable-logic for all MTG cards — not even WotC themselves. Understanding what's been tried, and where each approach plateaus, is essential for designing a viable system.

**Forge** (github.com/Card-Forge/forge) is the gold standard for coverage at **99%+ of all printed cards**. It uses a custom domain-specific language where each card is manually translated into a pipe-delimited script file. Forge proves that a well-designed intermediate representation can handle virtually every MTG card — but it requires human scripting for each one. The ForgeScribe project attempted neural machine translation from oracle text to Forge's DSL using 18,000 card-script training pairs, targeting roughly 60% accuracy. A GPT-4-based variant (ForgeScribeGPT4) also exists.

**XMage** (github.com/magefree/mage) takes the hardcoded approach — each of its 28,000+ implemented cards is a Java class composing abilities from a rich framework of reusable objects. Coverage is excellent but the labor cost is enormous: over 1 million lines of code.

**MTG Arena's Game Rules Parser (GRP)**, documented by WotC developer Alex Werner, is the most relevant precedent. The GRP is a Python-based NLP parser that converts raw English oracle text into CLIPS production rules (a LISP variant), which then execute on the Game Rules Engine (C++). **The GRP handles approximately 80% of newly designed cards automatically.** The remaining 20% requires manual rules engineering ranging from hours to months per card. The Beamsplitter Mage incident — where the parser incorrectly resolved an anaphoric "those creatures" reference — illustrates that semantic ambiguity, not syntactic parsing, is the real bottleneck.

**Demystify** (github.com/Zannick/demystify) is the most mature open-source parser, using ANTLR to produce structured parse trees. It achieves zero errors on cost/type-line parsing across all cards, but trigger parsing still shows 181 errors across 3,702 trigger-containing cards. **CubeArtisan's magic-card-parser** uses a Nearley grammar (JavaScript) targeting 80% parse success, outputting structured JSON.

The pattern across all projects is consistent: **keyword abilities and simple activated/triggered abilities are easy; compound conditionals, ability-granting, and unique card designs are hard.** The Laterna Magica project quantified this: of 19,710 total ability paragraphs, 4,282 (22%) were keyword abilities — low-hanging fruit. Simple activated and triggered abilities bring easy coverage to roughly 60–70%. The remaining 30–40% follows a classic long-tail distribution where each additional percentage point of coverage requires disproportionately more work.

---

## A layered regex architecture for 95% coverage

The optimal regex strategy is hierarchical — a preprocessing pipeline followed by classification in strict priority order. This mirrors how every successful MTG parser works, from Arena's GRP to Demystify.

**Preprocessing** (run on every card before classification): First, replace the card's name with `~` for uniform self-reference. Strip reminder text via `\([^)]*\)`. Normalize whitespace. Split oracle text on `\n` to isolate individual abilities. If the card has multiple faces (check the `layout` field: `split`, `transform`, `modal_dfc`, `adventure`, `flip`, `meld`), process each face's `oracle_text` independently using Scryfall's `card_faces` array.

**Classification order matters.** Process each ability paragraph through these checks sequentially, stopping at the first match:

1. **Keywords** (~22% of abilities): Match against the authoritative keyword list from Scryfall's `/catalog/keyword-abilities` endpoint. Handle comma-separated keywords on a single line (`flying, vigilance`). Parameterized keywords follow patterns like `equip {cost}`, `ward {N}`, `protection from [quality]`.

2. **Loyalty abilities** (planeswalkers only): `^[+−-]?\d+:\s+` — note Scryfall uses the Unicode minus sign `−` (U+2212), not ASCII hyphen.

3. **Saga chapters**: `^[IVX]+(,\s*[IVX]+)*\s*[—-]\s*` — Roman numerals followed by em dash.

4. **Modal headers**: `Choose (one|two|three|one or more|one or both|any number|X)\s*[—-]` followed by `^•\s+` bullet lines.

5. **Activated abilities**: `^(.+?):\s+(.+)$` — the colon delimiter. By this point, loyalty abilities and reminder text are already handled, so colon-confusion is minimal.

6. **Triggered abilities**: `^(When(ever)?|At)\s+` at line start. Sub-classify into ETB triggers (`When ~ enters`), death triggers (`When ~ dies`), combat triggers (`Whenever ~ attacks`), temporal triggers (`At the beginning of`).

7. **Replacement effects**: `If .* would .*, .* instead` or `As ~ enters` (entry replacement effects).

8. **Static abilities**: Everything remaining. Common patterns include `creatures you control get/have/gain`, `can't`, `as long as`, and cost modification (`costs {N} less`).

**Key insight: use Scryfall's `keywords` field.** Scryfall already provides a pre-parsed array of keyword abilities on each card object. Don't re-detect keywords from text when the API gives them to you for free. This lets your regex focus on the harder non-keyword abilities.

For special card types, the `layout` field is your routing key. Adventures, split cards, and MDFCs all appear as separate face objects in `card_faces` — parse each face independently. Level-up cards have `LEVEL N1-N2` markers. Class enchantments use `Level N` with activated costs. Battles have defense counters and standard triggered/static abilities.

**Estimated coverage**: Following this hierarchy, regex should correctly classify **90–95% of all ability paragraphs**. The remaining 5–10% includes abilities with complex conditional scoping, abilities that grant other abilities (requiring recursive parsing), compound type references with ambiguous grouping, and truly unique card designs.

---

## Multi-agent AI architecture for the long tail

The hybrid approach — regex as first pass, AI for the remainder — is the most cost-effective architecture. A four-agent system handles the full pipeline from pattern generation through iterative refinement.

**Agent 1 (Regex Generator)** takes categorized example card texts and generates regex patterns using an LLM. This approach was validated by mySociety's "RuleBox" experiment in August 2025, which used OpenAI to bootstrap 1,500 regular expressions across 8 text categories from labeled examples. The LLM generates initial patterns, then iteratively adjusts rules that produce incorrect matches. For MTG, feed the agent groups of cards known to contain each ability type, and it produces candidate regex patterns.

**Agent 2 (Validator)** tests generated patterns against the full Scryfall bulk dataset. It reports precision and recall for each pattern — correct classifications, missed cards, and false positives. The mySociety experiment achieved 230 correct / 73 missing / 41 incorrect on a 1,000-item validation set, illustrating that LLM-generated regex often starts too broad and needs narrowing.

**Agent 3 (Edge Case Classifier)** directly classifies the 5–10% of cards that fail regex matching. Using Claude Haiku for cost efficiency, it receives the card's oracle text, type line, keywords, and layout, then returns a structured JSON classification. **Structured output mode** (JSON schema) guarantees valid, parseable responses and eliminates verbose explanations.

**Agent 4 (Refiner)** analyzes patterns in Agent 3's classifications to generate new regex rules. When the AI repeatedly classifies the same pattern — say, "Whenever you cast a spell" triggers — the Refiner creates a regex to capture that pattern, reducing future AI dependency. This creates a **feedback loop** where AI results continuously improve the regex layer.

For implementation, use Pydantic models to define the classification schema:
```python
class AbilityClassification(BaseModel):
    ability_text: str
    primary_type: Literal["activated", "triggered", "static", "replacement", "keyword", "mana", "loyalty", "modal", "spell"]
    sub_type: Optional[str]  # "etb_trigger", "death_trigger", "upkeep_trigger", etc.
    has_targets: bool
    creates_tokens: bool
    grants_abilities: bool
    confidence: float
```

---

## Token efficiency makes this remarkably cheap

The cost difference between naive and optimized approaches is **two orders of magnitude**. Processing all ~30,000 Commander-legal cards naively through Claude Sonnet costs roughly $162. The hybrid approach brings this under $3.

**The biggest savings come from regex pre-filtering.** If regex handles 92% of cards, only 2,400 need AI processing — an immediate **92% reduction** in API calls.

**Anthropic's Batch API** provides a 50% discount on both input and output tokens, processes up to 10,000 requests per batch (most completing in under an hour), and supports prompt caching. **Prompt caching** is the second-largest efficiency gain: a shared system prompt containing classification instructions, category definitions, and few-shot examples (roughly 1,500 tokens) gets cached after the first request. Cached reads cost **0.1× the base input price** — a 90% savings on the system prompt for every subsequent card.

**Batching multiple cards per request** amortizes system prompt overhead further. Instead of one card per API call, send 20 cards in a single message with structured output requesting a JSON array. This cuts per-request overhead by 20×.

**Model tiering** routes simple classifications to Claude Haiku ($1/$5 per million tokens) and only escalates genuinely ambiguous cards to Sonnet ($3/$15). A 70/20/10 Haiku/Sonnet/Opus split cuts costs by roughly 60% compared to using a single model.

Additional optimizations include stripping reminder and flavor text before sending (10–30% token savings per card), compressing mana symbols (`{2}{W}{U}` → `2WU`), clustering similar card texts via embeddings to process only representative examples, and CSV serialization instead of JSON for card data (40–50% more token-efficient for tabular data).

**Realistic cost estimates**: With regex handling 92% of cards, batched Haiku processing for the standard cases, Sonnet escalation for 400 true edge cases, prompt caching, and the 50% Batch API discount, the total cost for classifying all Commander-legal cards is **approximately $2.81**. Ongoing costs per new set release (~300 cards, ~24 needing AI) drop below $0.05. These numbers make the approach viable even for individual developers.

---

## Scryfall is the right primary data source

For this use case, **Scryfall should be your primary data source, supplemented by MTGJSON for specific metadata advantages.**

Scryfall is the upstream source — MTGJSON actually aggregates from Scryfall among other sources. Oracle text updates (including errata) appear in Scryfall within hours, while MTGJSON rebuilds daily. The "Oracle Cards" bulk file (~130MB) provides exactly one entry per unique game object, updated every 12 hours, with no rate limits on bulk downloads.

Scryfall provides several fields critical for parsing: `oracle_text` (the canonical rules text), `keywords` (pre-parsed keyword ability array), `card_faces` (clean separation of multi-faced cards), `layout` (card structure type), and `legalities` (Commander legality filtering). The catalog endpoints (`/catalog/keyword-abilities`, `/catalog/keyword-actions`, `/catalog/ability-words`) provide authoritative reference lists updated immediately during spoiler season.

MTGJSON's key advantage is **pre-parsed type decomposition**: `types[]`, `subtypes[]`, and `supertypes[]` arrays versus Scryfall's single `type_line` string that you'd need to parse yourself. MTGJSON also provides `leadershipSkills` (explicit boolean for commander eligibility), embedded rulings in the card object, `edhrecSaltiness` scores, and exports in SQL/SQLite/Parquet/CSV formats for database integration.

**The practical workflow**: Download Scryfall's Oracle Cards bulk file for oracle text, keywords, and card faces. Optionally download MTGJSON's AtomicCards for type decomposition and leadership skills. Cross-reference using `scryfallOracleId` available in both systems. Filter for Commander legality via `legalities.commander === "legal"` — roughly **30,654 cards** in the Commander card pool.

---

## The hardest cards and how to handle them

Certain categories of cards resist pattern matching in well-documented ways. Understanding these failure modes shapes both the regex layer's design and the AI escalation criteria.

**Conditional scoping ambiguity** is the most common failure mode. Aurelia, Exemplar of Justice reads "gets +2/+0, gains trample if it's red, and gains vigilance if it's white" — the "+2/+0" is unconditional, but the comma-separated list makes it structurally ambiguous whether the conditional applies to all clauses or just the adjacent one. Hudeček's formal grammar misparsed this.

**Compound type references** create grouping ambiguity. "Basic Forest or Plains card" should parse as "basic (Forest or Plains) card" but naturally reads as "(basic Forest) or (Plains card)." This tripped up both formal grammars and regex approaches.

**Abilities that grant abilities** require recursive parsing — the granted ability text is itself a parseable ability embedded within a static or triggered ability. "Creatures you control have 'When this creature dies, draw a card'" nests a triggered ability inside a static ability.

**Self-referential and cross-referential cards** need special handling. Self-reference is solved by the `~` substitution. Cross-references to other specific card names ("Search your library for a card named Urza's Tower") require maintaining a card name dictionary.

**Notoriously difficult individual cards** include Panglacial Wurm (allows casting during library search, breaking fundamental game assumptions), Humility + Opalescence interactions (layer system nightmare requiring timestamp-dependent resolution), and cards like Ice Cauldron and Illusionary Mask with mechanically unique text. Alex Werner specifically cited **Splice onto Arcane** as "among the hardest abilities to add to MTG Arena."

**Un-set and acorn cards** contain intentionally non-standard text ("Each player hides at least one object...") and can generally be excluded via Scryfall's `is_funny` flag or by filtering to tournament-legal cards only.

**The recommended strategy for edge cases**: Accept that roughly 3–5% of cards (~900–1,500 in Commander) will need individual attention. Flag these during validation (Agent 2), classify them via AI (Agent 3), and store the results in a persistent cache. Many of these cards share patterns that can be formalized after initial AI classification — the Refiner agent (Agent 4) exists specifically to mine these patterns and reduce the irreducible set over time.

---

## Conclusion

The architecture that emerges from this research is clear: a **preprocessing pipeline → hierarchical regex classifier → AI escalation layer → iterative refinement loop**, consuming Scryfall bulk data as the primary source. Regex handles 90–95% of cards at zero marginal cost. AI handles the remainder for under $3 total. New set releases add roughly 300 cards every few months, with ongoing AI costs below $0.05 per set.

Three non-obvious insights stand out. First, MTG Arena's own parser — the most sophisticated implementation in existence — only achieves 80% automation on new cards, yet this is with full semantic parsing to executable game logic. Classification alone (your use case) is considerably easier than execution, so 95%+ is achievable. Second, the `keywords` field in Scryfall data already solves the largest single category of abilities (22% of all ability paragraphs) with zero parsing effort. Third, the mySociety RuleBox experiment validates the specific pattern of using LLMs to generate regex rules from labeled examples — the exact multi-agent loop proposed here has been proven in production on a different domain.

The bottleneck you identified — the parsing/classification layer — is genuinely solvable with this approach. The formal structure of MTG text makes it an unusually tractable NLP problem, and the economics of modern LLM batch processing make the AI layer viable even for solo developers.