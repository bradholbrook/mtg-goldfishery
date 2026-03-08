fetch lands search multiple land types
there are lots of other tutor rules and ways to say the same effect (scryfall otag:tutor) - searching only for named cards, limiting search for creatures or MV <= devotion to a color - lets capture what we can easily and note the rest in a files in /docs
tutor rules should always skip if a named card is in your hand - dont need the checkbox there

we need work on the effect categories. theyre hard to understand
need a cards tutored section. by what -> for what
we need sacrifice priorities too - crop rotation has an extra cost and tutor to battlefield

lowhanging fruit:
break types into type, subtype, supertype objects and populate using scryfall's precalculated lists per card
grab keywords from card data from scryfall, then lets design what each keyword will do in simulation

deeply consider scryfall's tagger database and understanding tagger tags per card using the API.




allow play priority changes by category and other similar selections as for discard priority. some decks want artifacts first, ramp creatures first, certain creatures then spells, their commander on turn X or when the board has X etc.

implement tutor cards incl tutor priorities, could include definitions for battlefield states, "if X is in play tutor for Y", "if i have 3 mana left after casting the tutor, find Z"




this is  aiming at evaluating swaps in a decklist but could be generic for simply comparing two decks. i think we design something simple and flexible to only implement one thing well vs two separate methods for comparison. allow comparing two decks' simulation results side by side with new summary results like X% more likely to find good hands and similar comparisons.
allow duplicating a deck including all overrides and enrichment.
allow copying card enrichments and overrides, and config decisions from deck A onto the current deck. user should pick categories of what transfers over.
allow user on config screen to define "doing the thing" describing the game state they want their deck to end up in e.g. X cards in hand, X mana available, N of [card type] in the [battlefield, graveyard, hand], [a list of cards] in hand, X [power, toughness] creatures in play. and each of those things could be in [what phase of your turn] and/or by turn X. We're trying to answer questions like "did i ramp on turn 2", "do i have cards XY in play with 10 mana available by the start of turn 6". We should capture the board state at these times for the user to review as well as stats like how often it happened, what was the opening hand (could even have stats on the opening hands for each "did the thing" definition like what cards were most common and what other "did the thing" definitions happen together)

lets build a mana analysis tab that uses hyperbolics to calculate the likelihood of casting cards on turns with the right colors. it can have summary assessments of the deck, cards grouped by mana value, and for individual cards. it can show how many lands will or may come in tapped, the distribution of colors produced. hyperbolics may not be the best - but this seems harder to simulate???
