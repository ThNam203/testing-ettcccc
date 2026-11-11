import { describe, expect, test } from 'vitest';
import { isAllowedHost, parseGiftCreate, parseGiftPatch, parseGiftStatus, parseLimit, parseSince, routeOf } from '../src/stats/http';

describe('routeOf', () => {
  test('maps every endpoint', () => {
    expect(routeOf('GET', '/health')).toEqual({ kind: 'health' });
    expect(routeOf('GET', '/events')).toEqual({ kind: 'sse' });
    expect(routeOf('POST', '/history/events')).toEqual({ kind: 'ingest' });
    expect(routeOf('GET', '/stats/overview')).toEqual({ kind: 'overview' });
    expect(routeOf('GET', '/stats/questions')).toEqual({ kind: 'questions' });
    expect(routeOf('GET', '/stats/groups')).toEqual({ kind: 'groups' });
    expect(routeOf('GET', '/stats/players')).toEqual({ kind: 'players' });
    expect(routeOf('GET', '/stats/sessions')).toEqual({ kind: 'sessions' });
    expect(routeOf('GET', '/stats/hours')).toEqual({ kind: 'hours' });
    expect(routeOf('GET', '/stats/export/answers.csv')).toEqual({ kind: 'export', table: 'answers' });
    expect(routeOf('DELETE', '/stats/viewers/tiktok%3A123')).toEqual({ kind: 'deleteViewer', viewerId: 'tiktok:123' });
    expect(routeOf('OPTIONS', '/stats/viewers/x')).toEqual({ kind: 'preflight' });
    expect(routeOf('GET', '/stats/winners')).toEqual({ kind: 'winners' });
    expect(routeOf('GET', '/stats/gifts')).toEqual({ kind: 'gifts' });
    expect(routeOf('POST', '/stats/gifts')).toEqual({ kind: 'giftCreate' });
    expect(routeOf('POST', '/stats/gifts/12')).toEqual({ kind: 'giftUpdate', giftId: 12 });
    expect(routeOf('DELETE', '/stats/gifts/12')).toEqual({ kind: 'giftDelete', giftId: 12 });
    expect(routeOf('GET', '/stats/export/gifts.csv')).toEqual({ kind: 'export', table: 'gifts' });
    expect(routeOf('GET', '/stats/export/race_results.csv')).toEqual({ kind: 'export', table: 'race_results' });
  });

  test('gift ids must be positive whole numbers', () => {
    expect(routeOf('POST', '/stats/gifts/0')).toBeNull();
    expect(routeOf('POST', '/stats/gifts/abc')).toBeNull();
    expect(routeOf('DELETE', '/stats/gifts/1.5')).toBeNull();
    expect(routeOf('DELETE', '/stats/gifts/')).toBeNull();
  });

  test('rejects unknown paths, wrong methods and unknown export tables', () => {
    expect(routeOf('GET', '/nope')).toBeNull();
    expect(routeOf('GET', '/history/events')).toBeNull();
    expect(routeOf('POST', '/stats/overview')).toBeNull();
    expect(routeOf('GET', '/stats/export/secrets.csv')).toBeNull();
    expect(routeOf('DELETE', '/stats/viewers/')).toBeNull();
    expect(routeOf('DELETE', '/stats/viewers/%E0%A4%A')).toBeNull(); // malformed escape
  });
});

describe('query parsing', () => {
  test('since: epoch ms or null', () => {
    expect(parseSince(null)).toBeNull();
    expect(parseSince('1700000000000')).toBe(1_700_000_000_000);
    expect(parseSince('-5')).toBeNull();
    expect(parseSince('abc')).toBeNull();
  });

  test('limit: clamped with a default', () => {
    expect(parseLimit(null, 50, 500)).toBe(50);
    expect(parseLimit('10', 50, 500)).toBe(10);
    expect(parseLimit('9999', 50, 500)).toBe(500);
    expect(parseLimit('0', 50, 500)).toBe(50);
    expect(parseLimit('x', 50, 500)).toBe(50);
  });
});

describe('gift input (untrusted request bodies)', () => {
  const ok = { viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 2, prize: ' 50k voucher ', note: ' DM ', status: 'owed' };

  test('create: trims text; race needs a session; status owed or sent', () => {
    expect(parseGiftCreate(ok)).toEqual({ ...ok, prize: '50k voucher', note: 'DM' });
    expect(parseGiftCreate({ ...ok, raceSeq: null })).toEqual({ ...ok, raceSeq: null, prize: '50k voucher', note: 'DM' });
    expect(parseGiftCreate({ ...ok, note: undefined })?.note).toBe('');
    for (const bad of [
      null, { ...ok, prize: '   ' }, { ...ok, prize: 'x'.repeat(121) }, { ...ok, note: 'x'.repeat(501) }, { ...ok, status: 'skipped' },
      { ...ok, viewerId: '' }, { ...ok, sessionId: null }, { ...ok, raceSeq: 0 }, { ...ok, raceSeq: '2' },
    ]) expect(parseGiftCreate(bad)).toBeNull();
    expect(parseGiftCreate({ ...ok, sessionId: null, raceSeq: null })).toMatchObject({ sessionId: null, raceSeq: null });
  });

  test('patch: any of status / prize / note, at least one', () => {
    expect(parseGiftPatch({ status: 'skipped' })).toEqual({ status: 'skipped' });
    expect(parseGiftPatch({ note: '', prize: 'x' })).toEqual({ note: '', prize: 'x' });
    expect(parseGiftPatch({})).toBeNull();
    expect(parseGiftPatch({ status: 'lost' })).toBeNull();
    expect(parseGiftPatch({ prize: '' })).toBeNull();
  });

  test('status query', () => {
    expect(parseGiftStatus('sent')).toBe('sent');
    expect(parseGiftStatus(null)).toBeNull();
    expect(parseGiftStatus('all')).toBeNull();
  });
});

describe('isAllowedHost (DNS-rebinding guard)', () => {
  test('only this machine on the server port', () => {
    expect(isAllowedHost('127.0.0.1:5180', 5180)).toBe(true);
    expect(isAllowedHost('localhost:5180', 5180)).toBe(true);
    expect(isAllowedHost('evil.example:5180', 5180)).toBe(false);
    expect(isAllowedHost('127.0.0.1:9999', 5180)).toBe(false);
    expect(isAllowedHost(undefined, 5180)).toBe(false);
  });
});
