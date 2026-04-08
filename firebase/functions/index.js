const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { CloudTasksClient } = require('@google-cloud/tasks');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const tasksClient = new CloudTasksClient();

const moxfieldUserAgent = defineSecret('MOXFIELD_USER_AGENT');

const PROJECT = 'mull-stat';
const LOCATION = 'us-central1';
const QUEUE = 'moxfield-rate-limit';

const ALLOWED_ORIGINS = new Set([
  'https://bradholbrook.github.io',
  'http://localhost:8080',
  'http://localhost:8000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8000',
]);

function isLocalhost(req) {
  const origin = req.headers.origin || '';
  return origin.includes('localhost') || origin.includes('127.0.0.1');
}

function log(req, ...args) {
  if (isLocalhost(req)) console.log('[debug]', ...args);
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://bradholbrook.github.io';
  res.set('Access-Control-Allow-Origin', allowed);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

// ─── Client-facing function ──────────────────────────────────────────────────
// Receives deckId, enqueues a Cloud Task, polls Firestore for the result.

exports.enqueueMoxfieldDeck = onRequest(
  { region: LOCATION, timeoutSeconds: 120 },
  async (req, res) => {
    if (setCors(req, res)) return;

    const deckId = req.query.deckId;
    if (!deckId || !/^[\w-]+$/.test(deckId)) {
      return res.status(400).json({ error: 'Missing or invalid deckId parameter' });
    }

    const requestId = crypto.randomUUID();
    const docRef = db.doc(`moxfield-requests/${requestId}`);
    log(req, `enqueueMoxfieldDeck: deckId=${deckId}, requestId=${requestId}`);

    try {
      // Write pending placeholder (expireAt = 5 min from now, cleaned by Firestore TTL policy)
      const expireAt = new Date(Date.now() + 5 * 60 * 1000);
      await docRef.set({ status: 'pending', expireAt });
      log(req, 'Firestore pending doc written');

      // Enqueue Cloud Task targeting the worker
      const workerUrl = `https://${LOCATION}-${PROJECT}.cloudfunctions.net/moxfieldWorker`;
      const parent = tasksClient.queuePath(PROJECT, LOCATION, QUEUE);
      log(req, `Creating Cloud Task → ${workerUrl}`);

      await tasksClient.createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: workerUrl,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ deckId, requestId, debug: isLocalhost(req) })).toString('base64'),
            oidcToken: {
              serviceAccountEmail: `${PROJECT}@appspot.gserviceaccount.com`,
            },
          },
        },
      });

      log(req, 'Cloud Task created, polling Firestore...');

      // Poll Firestore for the worker's result.
      // 45s initial deadline; extends to 110s once worker reports 'processing'.
      let deadline = Date.now() + 45000;
      const hardLimit = Date.now() + 110000; // must finish before 120s function timeout
      let pollCount = 0;
      let sawProcessing = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        pollCount++;
        const snap = await docRef.get();
        const data = snap.data();

        if (data?.status === 'processing' && !sawProcessing) {
          sawProcessing = true;
          deadline = hardLimit; // worker is alive, give it more time
          log(req, `Worker picked up task (poll ${pollCount}), extending deadline`);
        }
        if (data?.status === 'done') {
          log(req, `Result received after ${pollCount} polls`);
          docRef.delete().catch(() => {});
          return res.json(JSON.parse(data.data));
        }
        if (data?.status === 'error') {
          log(req, `Worker error after ${pollCount} polls: ${data.error}`);
          docRef.delete().catch(() => {});
          return res.status(502).json({ error: data.error });
        }
      }

      // Timeout — clean up
      log(req, `Timed out after ${pollCount} polls (sawProcessing=${sawProcessing})`);
      docRef.delete().catch(() => {});
      return res.status(504).json({ error: 'Moxfield request timed out' });

    } catch (err) {
      docRef.delete().catch(() => {});
      console.error('enqueueMoxfieldDeck error:', err);
      return res.status(500).json({ error: 'Failed to enqueue request' });
    }
  }
);

// ─── Worker function (called by Cloud Tasks) ────────────────────────────────
// Fetches from Moxfield API with the secret user agent, writes result to Firestore.

exports.moxfieldWorker = onRequest(
  { region: LOCATION, timeoutSeconds: 30, secrets: [moxfieldUserAgent] },
  async (req, res) => {
    const { deckId, requestId, debug } = req.body || {};
    const wlog = (...args) => { if (debug) console.log('[worker]', ...args); };

    if (!deckId || !requestId) {
      return res.status(200).json({ ignored: true, reason: 'missing params' });
    }

    const docRef = db.doc(`moxfield-requests/${requestId}`);
    wlog(`moxfieldWorker: deckId=${deckId}, requestId=${requestId}`);

    try {
      const taskStart = Date.now();

      // Mark as processing so the enqueue function knows we're alive
      await docRef.update({ status: 'processing' });
      wlog('Status set to processing');

      const ua = moxfieldUserAgent.value();
      const apiUrl = `https://api2.moxfield.com/v2/decks/all/${encodeURIComponent(deckId)}`;

      const response = await fetch(apiUrl, {
        headers: { 'User-Agent': ua },
      });

      wlog(`Moxfield responded: HTTP ${response.status}`);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        wlog(`Moxfield error body: ${text.slice(0, 200)}`);
        await docRef.set({
          status: 'error',
          error: `Moxfield returned HTTP ${response.status}: ${text.slice(0, 200)}`,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: false });
      }

      const data = await response.json();
      wlog(`Got deck data, writing to Firestore (${JSON.stringify(data).length} bytes)`);
      await docRef.set({
        status: 'done',
        data: JSON.stringify(data),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      wlog('Firestore write complete');

      // Ensure minimum 1.1s per task — with maxConcurrentDispatches=1,
      // this guarantees <1 req/sec to Moxfield regardless of burst tokens.
      const elapsed = Date.now() - taskStart;
      const remaining = 1100 - elapsed;
      if (remaining > 0) {
        wlog(`Padding ${remaining}ms to enforce rate limit`);
        await new Promise(r => setTimeout(r, remaining));
      }

      return res.status(200).json({ ok: true });

    } catch (err) {
      wlog(`Worker error: ${err.message}`);
      console.error('moxfieldWorker error:', err);
      await docRef.set({
        status: 'error',
        error: err.message || 'Worker failed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      const elapsed = Date.now() - taskStart;
      const remaining = 1100 - elapsed;
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      return res.status(200).json({ ok: false });
    }
  }
);
