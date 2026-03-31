## feature - switch to moxfield deck tags
- moxfield tags will completely replace our otag and category setup, and those components should be archived across all tabs. we may come back later. we can use the git history
    - overview, the category breakdown should show the moxfield tags instead
    - cards tab, no editor, no inline card editor, just the pills per card for what tags it has
- dont show the # or #! in tag names
- group any tags with the same name
- tags will not be editable
- the cards tab should have a toggle to show categories as card types (same accordion we have today), and to have the top level sections be the tags (alphabetical, cards alphabetical)

- discover the tags marked # or #! in the moxfield import usually on same line as card - multiple per card potentially. those tags become the categories for the deck and show up in dropdowns like good hand def

## feature - switching to full calculation and no simulation (lets discuss after switching to mox tags)
Calculating your commander's "cast turn" probability without a full Monte Carlo simulation is possible, but it requires a multivariate hypergeometric approach rather than a simple one.In a standard hypergeometric calculation, you only look at "Success vs. Failure" (e.g., Land vs. Non-land). To find your commander's turn, you must calculate the intersection of multiple "Success" conditions: drawing enough lands AND drawing the right ramp AND having the correct colors.The "No-Simulation" Formula StrategyTo calculate the probability of casting a Commander with Mana Value $C$ on Turn $T$, you need to sum the probabilities of all "Winning Hands." A hand is a "win" if:Land Drops: You have at least $L$ lands by turn $T$.Ramp Access: You have $R$ ramp spells that are castable using your available lands on the turns before $T$.Color Requirements: The combination of your lands and ramp produces the specific colored pips in your Commander's cost.Step 1: Define Your Success CategoriesDivide your 99-card deck into distinct "Buckets":$S_L$: Untapped Lands$S_T$: Tapped Lands (these delay your "turn count" by 1)$S_{R1}$: 1-Mana Ramp (Elves, Sol Ring)$S_{R2}$: 2-Mana Ramp (Arcane Signet, Farseek)$S_F$: Filler/Spells (Everything else)Step 2: Use a Multivariate Hypergeometric CalculatorUnlike a basic calculator, a multivariate calculator allows you to ask: "What is the chance I draw exactly 3 lands AND 1 mana rock in my top 9 cards?"The formula for drawing a specific combination $(k_1, k_2, ...)$ from categories $(M_1, M_2, ...)$ in a sample $n$ is:$$P(X_1=k_1, ..., X_c=k_c) = \frac{\binom{M_1}{k_1} \binom{M_2}{k_2} ... \binom{M_c}{k_c}}{\binom{N}{n}}$$Step 3: Account for Sequencing (The "Math Trap")The biggest reason people use simulations is sequencing. A hypergeometric calculator doesn't know that you can't use a Turn 2 ramp spell to help cast a Turn 2 spell. To fix this without a simulation, you must use Conditional Probability:Calculate the probability of drawing a 2-CMC ramp spell in your top 8 cards (Opening 7 + Turn 1 draw).Multiply that by the probability of having 2 lands in those same 8 cards.If both are true, your "Available Mana" on Turn 3 is now 4 instead of 3.Example Calculation: 4-Drop Commander on Turn 3To cast a 4-CMC commander on Turn 3, you generally need 3 lands and one 2-mana ramp spell (like Arcane Signet).Success CriteriaProbability (approx)3+ Lands by Turn 3 (Sample: 10)~82%1+ 2-CMC Ramp by Turn 2 (Sample: 9)~65% (assuming 12 rocks)Combined Probability~53% ($0.82 \times 0.65$)Note: This "multiplication" method is a slight simplification. For 100% accuracy, you should use the multivariate formula to ensure you aren't "double-counting" the same card slots.Quick Rules of ThumbThe 90% Rule: To hit a land drop on turn $N$ with 90% certainty, you need roughly $10 \times N$ land sources (e.g., 40 lands for turn 4).Color Fixing: If your commander is $1URB$, you need at least 18-20 sources of each color to have a >90% chance of having that specific color available by turn 4.Would you like me to calculate the specific turn-by-turn probabilities for a specific decklist or Commander cost?

## more tweaks (wait on these)

- general

- overview tab
    
- card tags tab

- mull tab
    - x should be centered in row and in a small col by itself
    - required cards pill and sample button should left align
    - remove man rocks from dropdown, its a category now
    - n of card types multiselect needs to follow our new popup/callout style and be a multiselect list
    - n of type can collapse with n of types - just select 1. name it Card type(s)
    - rename to Card(s)
    - rename to Categor(ies) - do the same multiselect for categories
    - change layout of entry form to be like a sentence. static words "Has at least" then the number entry box then "of" the dropdown for "card(s) etc".
    - the dropdown box values should show as "<selected>" or "<selected> or <selected>..."
    - bottom selection priority should be same multiselect
- results tab calc tab overhaul
    - lets split results into two. the mulligan based results go into the mulligan tab. the effect based results go into the new calculate tab.
    - we will build out calculate tab but we dont need to sim mulligan to show those.
    - this will combine the hand def results with the hand def edit field. 
    - the fields should start shown/stubbed with blank values not hidden
    - mull depth chart. no % value in key. make % under bars bigger and the under-bar title can be <handsize> and larger font too.
    - needs sim button/section at top, one row to save space
    - bottom priority edits should be in a collapse section like the category editor under the good hand defs add button

## feature - mill (wait)
- supporting mill is the same as draw, no? its a effect of <N> cards off the top of the deck?
- not sure why this notes a different calculation, maybe it was thinking about calculating using the leftover cards after milling, but thats not what we want.
| **Mill threshold calculator** | "How many cards do I mill for 95% chance of hitting a creature?" Inverse negative hypergeometric. |

## feature - the calc tab (wait)
- maybe the effect based analysis needs to go on the calc tab - we're calculating per effect anyway, those are just precalculated based on cards in the deck
- user should be able to select <draw> <n> cards on turn <n> to see the effect and analysis based on probability thresholds
- what about for 'draw' effects if we had an actual graph showing the change in percentage of drawing <x> type as the draw <N> increases. x axis cards drawn. y axis percentage to draw <X> card type. card type should be selectable.
- what if we thought of the analysis differently - we know whether the deck has draw 1-n cards flagged. those are all the same, what if we group them together. its a per unique effect analysis that can list the applicable cards below the expanded graph.
| **Manual Effect Lab tab** | Standalone calculator with effect-based inputs. E.g. "Draw/Mill N" mode: user sets N (draw count), turn number (shifts effective library size: 99 − 7 hand − (turn−1) draws), and which categories to track. Generates the same probability curves as the auto-analysis, but for any hypothetical. Turn-awareness is important: drawing 3 on turn 6 sees a meaningfully different library than drawing 3 from a fresh 99. |

## feature - inverse hypo assessments (wait)
- these threshold assessments can go in the calc tab alongside e.g. the draw <N> analysis by threshold
- how many creatures do i need to run for a draw <N> to hit <threshold>
- some of this can go in the dashboard too (or maybe we should do this analysis by hand definition) - how many more <type> do i need to run to see <X> in my opening hands on average, or to have a <threshold> percent of hitting this opening hand configuration.
| **Inverse hypergeometric** | "How many copies of X do I need for 90% confidence of seeing it by turn 3?" |

## Future Wishes (wait)

These are acknowledged but out of scope until the core is solid.

| Feature | Description |
|---------|-------------|
| **"You need X more ramp"** | Recommendation: "To cast your 5-CMC commander by turn 4 in 80% of games, you need 2 more ramp sources." Accounts for castability of those ramp cards themselves, CMC overlap with existing curve, and commander's color requirements. display could show ramp cost curve. user could input targeted turns to play X cards and could analyze what sources of colors/ramp to add to achieve at threshold. |
| **"You need X more color sources"** | "Add 2 more {G} sources to hit 90% chance of casting commander by turn 3." Derived from the color-aware mana model. |
| **Cascade/Discover analysis** | Negative hypergeometric distribution. "Cascade 6: expected reveals, P(hit creature vs removal vs ramp)." |
| **Cards on curve** | P(having a castable card at CMC N by turn N) for each card as color identity changes |
| **Scry/Surveil modeling** | Add scry/surveil effects to mana model and probability calculations |
| **Compare two decklists** | Side-by-side probability analysis. Per-card delta view across deck versions. |
| **Archidekt import** | Import directly from Archidekt - tags should probably stick to otag categories instead of mappint direct |
| **Shareable deck links** | URL hash (pako-compressed) deck state for sharing - this will have to include configuration data but is a great way for sharing. all we really need to hash is the deck link(s) and the category/otag mapping config. |
| **PWA / offline** | Caching for offline use once decks are imported. |
| **moxfield update** | Form bulk update export for category(tag) values for moxfield - should map to deck local tags that match categories incl user assigned, simple card 1-n categories map |
| **moxfield playtest** | is there a way to start the moxfield playtest simulator with a chosen set of 7 cards e.g. from example hands |