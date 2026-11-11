// Local derby server: stats database + optional TikTok LIVE bridge.
//
//   npm run server                    stats only (simulator mode)
//   npm run tiktok -- <username>      stats + relay that live's comments to the game (?source=tiktok)
//
// Listens on 127.0.0.1:5180 only. Logic lives in tested modules (src/stats/*, src/history/events.ts,
// src/chat/tiktokBridge.ts); this file is glue. Logs counts, never names or comment text.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnalyticsEvent } from '../src/history/events.ts';
import { BRIDGE_PORT, isLocalOrigin, toChatEnvelope } from '../src/chat/tiktokBridge.ts';
import {
  isAllowedHost, parseGiftCreate, parseGiftPatch, parseGiftStatus, parseLimit, parseSince, routeOf,
} from '../src/stats/http.ts';
import { openStatsStore } from '../src/stats/store.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY_BYTES = 1_000_000;
const MAX_GIFT_BODY_BYTES = 10_000;
const MAX_SESSION_ID = 64;
const MAX_EVENTS_PER_BATCH = 2_000;
const HEARTBEAT_MS = 15_000;
const STATS_LOG_MS = 30_000;

// ---------------------------------------------------------------- args
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? '');
}
const tiktokArg = argValue('--tiktok');
const tiktokHost = tiktokArg === null ? null : tiktokArg.replace(/^@/, '').trim();
if (tiktokArg !== null && tiktokHost === '') {
  console.error('Usage: npm run tiktok -- <tiktok username of a live stream>');
  process.exit(1);
}
const dbPath = resolve(ROOT, argValue('--db') ?? 'data/derby.db');
mkdirSync(dirname(dbPath), { recursive: true });
const store = openStatsStore(dbPath);
console.log(`[server] stats database: ${dbPath}`);

// ---------------------------------------------------------------- helpers
function corsHeaders(origin) {
  return origin !== undefined && isLocalOrigin(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    : {};
}
function sendJson(res, status, origin, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  res.end(JSON.stringify(payload));
}
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Small JSON body (gift requests) as { value }, or null after a 400 was sent. */
async function readJson(req, res, origin) {
  try {
    return { value: JSON.parse(await readBody(req, MAX_GIFT_BODY_BYTES)) };
  } catch (error) {
    sendJson(res, 400, origin, { error: error instanceof Error ? error.message : 'bad body' });
    return null;
  }
}

// ---------------------------------------------------------------- TikTok SSE clients
const sseClients = new Set();
let bridgeStatus = tiktokHost === null ? null : { kind: 'bridgeStatus', state: 'connecting', host: tiktokHost, message: `Connecting to @${tiktokHost}…` };
let received = 0;
let forwarded = 0;
let ingested = 0;
let rejected = 0;
const broadcast = (payload) => { for (const res of sseClients) res.write(`data: ${JSON.stringify(payload)}\n\n`); };
function setBridgeStatus(state, message) {
  bridgeStatus = { kind: 'bridgeStatus', state, host: tiktokHost, message };
  broadcast(bridgeStatus);
  console.log(`[tiktok] ${state}: ${message}`);
}

// ---------------------------------------------------------------- routes
async function handle(req, res) {
  const origin = req.headers.origin;
  // Requests from other websites (or DNS-rebinding pages) are refused before anything else.
  if (!isAllowedHost(req.headers.host, BRIDGE_PORT) || (origin !== undefined && !isLocalOrigin(origin))) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const route = routeOf(req.method, url.pathname);
  if (route === null) {
    sendJson(res, 404, origin, { error: 'not found' });
    return;
  }
  const filter = { since: parseSince(url.searchParams.get('since')) };
  switch (route.kind) {
    case 'preflight':
      res.writeHead(204, corsHeaders(origin)).end();
      return;
    case 'health':
      sendJson(res, 200, origin, { ok: true, tiktok: tiktokHost });
      return;
    case 'sse':
      if (bridgeStatus === null) {
        sendJson(res, 404, origin, { error: 'TikTok bridge not running; start with npm run tiktok -- <username>' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...corsHeaders(origin) });
      sseClients.add(res);
      res.write(`data: ${JSON.stringify(bridgeStatus)}\n\n`);
      req.on('close', () => sseClients.delete(res));
      return;
    case 'ingest': {
      let data;
      try {
        data = JSON.parse(await readBody(req));
      } catch (error) {
        sendJson(res, 400, origin, { error: error instanceof Error ? error.message : 'bad body' });
        return;
      }
      const list = Array.isArray(data?.events) ? data.events.slice(0, MAX_EVENTS_PER_BATCH) : null;
      if (list === null) {
        sendJson(res, 400, origin, { error: 'expected { events: [...] }' });
        return;
      }
      const events = list.map(parseAnalyticsEvent).filter((e) => e !== null);
      const result = store.ingest(events);
      ingested += result.stored;
      rejected += list.length - events.length;
      sendJson(res, 200, origin, { ...result, rejected: list.length - events.length });
      return;
    }
    case 'overview':
      sendJson(res, 200, origin, { overview: store.overview(filter), funnel: store.funnel(filter) });
      return;
    case 'questions':
      sendJson(res, 200, origin, { questions: store.questions(filter) });
      return;
    case 'groups':
      sendJson(res, 200, origin, { levels: store.levels(filter), categories: store.categories(filter) });
      return;
    case 'players':
      sendJson(res, 200, origin, { players: store.players(filter, parseLimit(url.searchParams.get('limit'), 50, 500)) });
      return;
    case 'sessions':
      sendJson(res, 200, origin, { sessions: store.sessions(parseLimit(url.searchParams.get('limit'), 20, 200)) });
      return;
    case 'hours':
      sendJson(res, 200, origin, { hours: store.hours(filter) });
      return;
    case 'export':
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="derby-${route.table}.csv"`,
        ...corsHeaders(origin),
      });
      res.end(store.exportCsv(route.table, filter));
      return;
    case 'deleteViewer':
      sendJson(res, 200, origin, { deleted: store.deleteViewer(route.viewerId) });
      return;
    case 'winners': {
      const session = url.searchParams.get('session');
      if (session === null || session === '' || session.length > MAX_SESSION_ID) {
        sendJson(res, 400, origin, { error: 'expected ?session=<id>' });
        return;
      }
      sendJson(res, 200, origin, store.winners(session));
      return;
    }
    case 'gifts':
      sendJson(res, 200, origin, { gifts: store.gifts(filter, parseGiftStatus(url.searchParams.get('status'))) });
      return;
    case 'giftCreate': {
      const body = await readJson(req, res, origin);
      if (body === null) return;
      const input = parseGiftCreate(body.value);
      if (input === null) {
        sendJson(res, 400, origin, { error: 'Prize (1–120 characters) and a viewer are required.' });
        return;
      }
      const result = store.addGift(input, Date.now());
      sendJson(res, result.ok ? 200 : 409, origin, result.ok ? { gift: result.gift } : { error: result.error });
      return;
    }
    case 'giftUpdate': {
      const body = await readJson(req, res, origin);
      if (body === null) return;
      const patch = parseGiftPatch(body.value);
      if (patch === null) {
        sendJson(res, 400, origin, { error: 'Nothing valid to change.' });
        return;
      }
      const result = store.updateGift(route.giftId, patch, Date.now());
      if (result.ok) sendJson(res, 200, origin, { gift: result.gift });
      else sendJson(res, result.reason === 'notFound' ? 404 : 409, origin, { error: result.error });
      return;
    }
    case 'giftDelete':
      sendJson(res, 200, origin, { deleted: store.deleteGift(route.giftId) });
      return;
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`[server] ${req.method} ${req.url}: ${error instanceof Error ? error.message : 'error'}`);
    if (!res.headersSent) sendJson(res, 500, req.headers.origin, { error: 'internal error' });
  });
});
server.on('error', (error) => {
  console.error(`[server] cannot listen on 127.0.0.1:${BRIDGE_PORT}: ${error.message}`);
  process.exit(1);
});
server.listen(BRIDGE_PORT, '127.0.0.1', () => console.log(`[server] listening on http://127.0.0.1:${BRIDGE_PORT}`));

setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, HEARTBEAT_MS);
setInterval(() => {
  const tiktok = tiktokHost === null ? '' : ` | tiktok comments received ${received}, forwarded ${forwarded}, pages ${sseClients.size}`;
  console.log(`[server] events stored ${ingested}, rejected ${rejected}${tiktok}`);
}, STATS_LOG_MS);

// ---------------------------------------------------------------- TikTok (optional)
let connection = null;
if (tiktokHost !== null) {
  const { ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent } = await import('tiktok-live-connector');
  // processInitialData: false -> only new comments, not the backlog from before we joined.
  connection = new TikTokLiveConnection(tiktokHost, { processInitialData: false });
  connection.on(WebcastEvent.CHAT, (event) => {
    received += 1;
    const envelope = toChatEnvelope(event);
    if (envelope === null) return;
    forwarded += 1;
    broadcast(envelope);
  });
  connection.on(WebcastEvent.STREAM_END, () => setBridgeStatus('ended', `@${tiktokHost} ended the live.`));
  connection.on(ControlEvent.DISCONNECTED, () => {
    if (bridgeStatus?.state === 'live') setBridgeStatus('error', 'Disconnected from TikTok.');
  });
  connection.on(ControlEvent.ERROR, (error) => console.error(`[tiktok] error: ${error instanceof Error ? error.message : 'unknown'}`));
  try {
    const state = await connection.connect();
    setBridgeStatus('live', `Connected to @${tiktokHost} (room ${state.roomId}).`);
  } catch (error) {
    setBridgeStatus('error', error instanceof UserOfflineError ? `@${tiktokHost} is not live right now.`
      : `Could not connect to @${tiktokHost}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

process.on('SIGINT', async () => {
  await connection?.disconnect();
  server.close();
  store.close();
  process.exit(0);
});
