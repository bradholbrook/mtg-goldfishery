# tweaks - overview tab
- can we make the hover card image, commander image, and the card lists when using images all have rounded corners? some magic card images are square with white corners and it looks bad
- it would be cool if clicking a MV bar on the MV chart or type pie/name on the type chart would filter the shown cards to that value/type. you could clik multiple of each to add results to the filter. the values not selected would gray out. each chart would have a 'clear filter' button maybe in its top right - clicking each value again would also remove that value from the filter. each graph could show an (I) icon in the header that explained how the filter works. The cards list would auto sort as criteria are selected/cleared.
- the graph shows 3% to cast commander by turn 2. is there a way to tell what cards contributed to that or what the "perfect hand" would be?

# tweaks - calculate tab for "off the top"
- on the match criteia, the "sample" button should really say show, thats what it does
- under the effect form, under # hits looking for - lets add a sample button that shows an N card sample of a valid hit
- for the results graphs, lets just show them right away. we have a default N, and the default hits is anything so all the content can work. We can even add the first criterion entry by default for new effects


 # 10. Test
curl -s -w "deck1: HTTP %{http_code} in %{time_total}s\n" -o /dev/null "https://us-central1-mull-stat.cloudfunctions.net/enqueueMoxfieldDeck?deckId=b1sRpXVzekqryjsTIZ_gnA" & curl -s -w "deck2: HTTP %{http_code} in %{time_total}s\n" -o /dev/null "https://us-central1-mull-stat.cloudfunctions.net/enqueueMoxfieldDeck?deckId=slS71rFcDUKEVGNqoHsOIA" & curl -s -w "deck3: HTTP %{http_code} in %{time_total}s\n" -o /dev/null "https://us-central1-mull-stat.cloudfunctions.net/enqueueMoxfieldDeck?deckId=b1sRpXVzekqryjsTIZ_gnA" & curl -s -w "deck4: HTTP %{http_code} in %{time_total}s\n" -o /dev/null "https://us-central1-mull-stat.cloudfunctions.net/enqueueMoxfieldDeck?deckId=slS71rFcDUKEVGNqoHsOIA" & wait 

<ignore the below for now>

## Future Wishes (wait)
| **Compare two decklists** | Side-by-side probability analysis. Per-card delta view across deck versions. |
| **Shareable deck links** | URL hash (pako-compressed) deck state for sharing. need the deck url and the user entered things - good hand defs, bottom priorities and effects simulations. app would load the deck and the various bits.


# feature - queue line
 hypothetically, we could track how many tasks are in queue globally in firebase, then each 
 user app client could read and know how long it had to wait? that could use a lot of writes 
 but we wouldn't need to care as much about timeouts if we saw the statuses changing as      
things were flowing                                                                          
                                                                                             
⏺ Yes, that's a better approach. One Firestore doc as a global queue counter — the worker    
  decrements it after each task, the client watches it to show position. Firestore onSnapshot
   gives real-time updates without polling.                                                  
   
  But we don't even need a separate counter doc. We already have one doc per request in      
  moxfield-requests/. The enqueue function can:
                                                                                             
  1. Count existing pending/processing docs to get queue position                            
  2. Write queuePosition to the request's own doc
  3. The worker updates each remaining doc's queuePosition as it processes (expensive), OR   
  simpler — the client just watches its own doc's status field and we add a queuePosition at 
  creation time based on a global atomic counter                                             
                                                                                             
  Simplest version:

  - One Firestore doc moxfield-queue/counter with a pending count                            
  - Enqueue function: atomic increment, write position to request doc
  - Worker: atomic decrement after completing each task                                      
  - Client polls its own doc and sees { status: 'pending', queuePosition: 3 } → { status:    
  'processing' } → { status: 'done' }                                                        
                                                                                             
  That's 2 extra writes per request (increment + decrement on the counter doc). Negligible   
  cost.           
                                                                                             
  Want me to implement this? The client-side could show "Queue position: 3..." → "Queue      
  position: 2..." → "Fetching your deck..." instead of just "Fetching...".


 