# Queue Position UI — Implementation Plan

## Goal
Show users their place in line during Moxfield import when the queue is busy. Non-blocking — data delivery stays as fast as current.

## Architecture

### Firebase Functions (3 functions)

**1. `enqueueMoxfieldDeck` (existing, modified)**
- Creates request doc with `createdAt: serverTimestamp()` added
- Enqueues Cloud Task
- Returns `{ requestId }` immediately (no long-poll, no queue counting)
- Timeout: 30s (down from 120s since no polling)

**2. `checkMoxfieldStatus` (new)**
- Input: `requestId`
- Reads the request doc
- If `done`: returns `{ status: 'done', data }`, deletes doc
- If `error`: returns `{ status: 'error', error }`, deletes doc
- If `pending`/`processing`: computes place in line via Firestore `count()` query:
  ```js
  db.collection('moxfield-requests')
    .where('status', 'in', ['pending', 'processing'])
    .where('createdAt', '<', myCreatedAt)
    .count().get()  // → ahead count; placeInLine = ahead + 1
  ```
- Returns `{ status, placeInLine }`
- Timeout: 10s

**3. `moxfieldWorker` (existing, unchanged)**
- No changes. Fetches from Moxfield, writes result to Firestore doc.
- Doc cleanup still handled by: checkMoxfieldStatus (on done/error read) + Firestore TTL (5 min orphan safety net).

### Client (app.js)

Two parallel requests during Moxfield import:

**Data path (blocking):**
1. `POST enqueueMoxfieldDeck?deckId=...` → get `{ requestId }`
2. Poll `checkMoxfieldStatus?requestId=...` every 2s
   - First 3 polls at 2s (covers fast path — empty queue, ~2-3s total)
   - Then every 5s (queue is busy, position updates)
3. When `status: 'done'` → proceed with parsing + Scryfall enrichment as today
4. When `status: 'error'` → show error toast

**Position UI (non-blocking, parallel):**
- Same poll responses drive the spinner text
- `placeInLine === 1` → "Fetching from Moxfield…"
- `placeInLine > 1` → "Place in line: N"
- Once data path resolves → polling stops, spinner transitions to Scryfall enrichment messages as today

### Request Doc Schema
```js
{
  status: 'pending' | 'processing' | 'done' | 'error',
  createdAt: serverTimestamp(),  // NEW — used for FIFO position calc
  expireAt: Date,                // existing — Firestore TTL cleanup
  queuePosition: undefined,      // REMOVED — no longer needed
  data: string,                  // set by worker on success
  error: string,                 // set by worker on failure
}
```

### Why count() on docs instead of a counter
- Ground truth: derived from actual live request docs
- Self-correcting: docs deleted on completion, TTL cleans orphans
- No increment/decrement to drift out of sync
- `createdAt` comparison gives true FIFO position
- Stale TTL docs only inflate if older than yours (they were ahead anyway, gone in ≤5 min)
- Single Firestore read per count query regardless of queue size

## Error / Timeout Handling
- `enqueueMoxfieldDeck` fails → client shows error toast, no requestId to poll
- `checkMoxfieldStatus` returns 404 (doc expired/missing) → client shows timeout error
- Worker crashes → doc stays `pending`/`processing`, TTL cleans up in 5 min, client eventually gets 404
- Client-side timeout: after 120s of polling with no `done`/`error`, give up and show timeout toast
- Network error on individual poll → skip that poll, retry on next interval

## Files to Change
1. `firebase/functions/index.js` — modify enqueueMoxfieldDeck, add checkMoxfieldStatus
2. `js/app.js` — new polling logic in URL import path, update spinner messages
3. `js/ui.js` — no changes needed (setImportLoading already accepts arbitrary message strings)
