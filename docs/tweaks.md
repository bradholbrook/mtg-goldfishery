## tweaks general
- when i delete all good hand defs and hit simulate, it creates a new hand def and the results graph looks right (54%), but the results chip on the ahnd def itself was wrong (said 98% to keep three lands) so something isnt calculating
- default K for any card and type and value says 104 on calc tab
- toast warns and errors need to be longer
- hit criteria K count doesnt update right away either, still sayd default value
## tweaks to cmdr castability/overview section
- castability graph height/font needs to be larger
- opening hand analysis becomes land analysis
- % values per hand in the graph shuold float to top of bar like mana curve chart
- move the color by turn % up to that section
    - show an analysis for every color in the deck in a list (same style as existing) (some commanders dont have all their colors in their casting cost but its in their color identity)
    - also include an entry for access to "all your colors" by turn
    - lets allow choosing the analysis per turn, let's borrow from the calc page and, like draw, have a row of numbers you can click to see % chance to have access to each color/all your color by that turn
        - this picker row can say colors by turn next to it
        - dont forget to include availability of ramp and likelihood of casting and all the good calculations from the commander caster in this formula too.
    - at the end of each single color's row, show a 'x more sources for 80% by this turn' line if applicable
- commander castability needs to have an info 'i' icon next to the % by turn callout. it can have all the details in it that we decribe there in that section formatted better to save space. also that mana rocks and dorks are calculated by otags and are an estimate, do not account for advanced board states. (do we calculate rituals? otag:ritual - we should. each also has a mana value to pull out and cost and castability and everything we do for the other pieces)
- when i open a accordion of cards and the mouse is on top of a card, i can then only see the floating tags for that card if i leave it and come back, can we fix to check on mouse move or?
- the hover popup on overview tab could show castability on curve for each creature. same calc as commander but only care about turn=mv

## tweaks for mull tab

## feature - recommended breakdown for consistency (overview tab)
- in a collapsible section under commander castability
- what would it take to get to 80% on turn <commander cmc>
- how many sources of ramp/rock/dork would you need to add
- what of those things are contributing the least to your overall plan e.g. a weak ramp spell because its hard to cast, not enough green mana to cast your 1 mana dork, not enough lands, not enough color sources in general - note where the lor probabilities were and recommend some things and an overall # as a general count of things to add for casting commander

## feature - the calc tab
- we're going to create an effect lab that allows users to create an effect e.g. top N cards, cascade, discover. then build criteria for cards to look for for that effect and get a results graph and recommendations. (we're skipping cascade and discover for now as they'll be handled a bit differently)
- i want to have three sections to this tab. "cards off the top", "cascade/discover". they can be sub-tabs shown at the top of a container.
- top N cards off the top first - when i click the tab i do the below
- i want to be able to type in the 'see' amount or click a + - on either side of the input. they should be custom buttons not built in ones.
- per effect, the by-turn setup doesnt seem to change the value much, lets keep it simple and skip that, just assess for a 99 card deck.
- the user can enter sucess criteria just like the keepable hands. we can have each criteria create a "k" value and assess per criteria (showing results in the same way as the mulligan tab). then we build a graph for recommendation analysis
- when we present a graph the Y axis is the % chance to find that set of search criteria. the X axis is how many cards fit in all of this effect's criteria in the deck. in the center of the graph show the current count of cards matching those criteria. then decrement by 1 before and increment by 1 after that value to build the X axis. graph the probability of each of those new values which will show what happens if the user changes their deck for those types of cards. e.g. adding more creatures or ramp sources.
- the graph should display just like our other graphs, simple count underneath the bars, % values float above each column
- this graph needs a x axis legend called 'sources'
- the graph should be colored like the commander calc - yellow red green for LMH % values.
- present analysis under the graph like "add X more sources to have 80% change to see one in the top N cards".
- ok what if we actually had two side by side graphs. so up top we could have the values for the effect e.g. the N off the top with its +/- buttons, and the success criteria, can be in two side by side columns. then under each column is a graph showing how those things could change
- so under the N side we can change N, how does drawing K things matching our criteria change after increasing/reducing N. the recommendation underneath can be 'need to look at N cards to get 80% to hit 1'
- under the criteria column we have the graph as defined above and the recommendation for adding K sources
- when N > 1, show a picker like the one today to allow choosing a number up 1-N, but use it to calaculate how many hits you're looking for. e.g. top 3 off top effect - you see 1, 2, 3. if the criteria is creatures it's effectively asking what is the % to see 1, 2, or, 3 creatures. the graph and recommenadation should adjust each time this success picker is updated. for the recommendation we would have to say "add X sources for 80% change to hit Y cards" where Y is the chosen hit target
- all of these graphs etc would be tied to one effect definition. that definition would have to be wrapped in an expander. users could create multiple effects to analyze
- for the criteria definition widget for an effect, have the per criteria sample button show a sample of the minimum valid hit for that criteria e.g. 1 creature, 1 artifact MV 2. then also have an overall hit list that pops up all valid cards that could be pulled from those criteria (full K print out). these will look like the other sample dropdowns e.g. in columns with type colors by them, hover card image, etc. lets sort these values as the other sample pickers - first by type then alphabetically.

## feature, cascade and discover tabs

## Future Wishes (wait)
| **Cascade/Discover analysis** | Negative hypergeometric distribution. "Cascade 6: expected reveals, P(hit creature vs removal vs ramp)." |
| **Compare two decklists** | Side-by-side probability analysis. Per-card delta view across deck versions. |
| **Shareable deck links** | URL hash (pako-compressed) deck state for sharing. need the deck url and the user entered things - good hand defs, bottom priorities and effects simulations.|