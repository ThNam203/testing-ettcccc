import { describe, expect, test } from 'vitest';
import { HANDLE_PATTERN, MAX_ID_LENGTH, MAX_TEXT_LENGTH, parseChatEnvelope } from '../src/chat/protocol';
import { HANDLE_PATTERN as EVENT_HANDLE_PATTERN } from '../src/history/events';
import {
  BRIDGE_HANDLE_PATTERN, BRIDGE_LIMITS, firstCharAnswer, isLocalOrigin, parseBridgeStatus, toChatEnvelope,
} from '../src/chat/tiktokBridge';

describe('firstCharAnswer (test mode)', () => {
  test('a comment starting with a–d uses that letter, any case', () => {
    expect(firstCharAnswer('Cool stream')).toBe('c');
    expect(firstCharAnswer('  b')).toBe('b');
    expect(firstCharAnswer('Ahh')).toBe('a');
    expect(firstCharAnswer('do it')).toBe('d');
  });

  test('any other first character maps to a–d by its code point', () => {
    expect(firstCharAnswer('hello')).toBe('a'); // 'h' = 104, 104 % 4 = 0
    expect(firstCharAnswer('xin chào')).toBe('a'); // 'x' = 120 -> 0
    expect(firstCharAnswer('yo')).toBe('b'); // 121 -> 1
    expect(firstCharAnswer('😀 lol')).toBe(['a', 'b', 'c', 'd'][0x1f600 % 4]);
    expect(firstCharAnswer('こんにちは')).toBe(['a', 'b', 'c', 'd'][0x3053 % 4]);
  });

  test('blank comments give no answer', () => {
    expect(firstCharAnswer('   ')).toBeNull();
    expect(firstCharAnswer('')).toBeNull();
  });
});

describe('toChatEnvelope', () => {
  test('maps a TikTok chat event to the same chat envelope the game already validates', () => {
    const env = toChatEnvelope({ user: { uniqueId: 'mai_123', nickname: 'Mai 🌸' }, comment: ' hello! ' });
    expect(env).toEqual({ kind: 'chat', userId: 'tiktok:mai_123', nickname: 'Mai 🌸', text: 'hello!', handle: 'mai_123' });
    expect(parseChatEnvelope(env)).not.toBeNull();
  });

  test('reads the shape tiktok-live-connector 2.5 actually emits (content, user.idStr, user.displayId)', () => {
    const env = toChatEnvelope({ user: { id: '6812', idStr: '6812', displayId: 'mai_123', nickname: 'Mai' }, content: 'Cool!' });
    // Numeric id is stable even if the viewer renames their @handle.
    // The @handle is kept separately so the admin can find the viewer on TikTok (e.g. to send a prize).
    expect(env).toEqual({ kind: 'chat', userId: 'tiktok:6812', nickname: 'Mai', text: 'Cool!', handle: 'mai_123' });
    expect(toChatEnvelope({ user: { idStr: '9', displayId: 'ken', nickname: '' }, content: 'hi' })?.nickname).toBe('ken');
  });

  test('falls back to the unique id when the nickname is blank', () => {
    expect(toChatEnvelope({ user: { uniqueId: 'ken', nickname: '  ' }, comment: 'a' })?.nickname).toBe('ken');
  });

  test('cuts over-long fields so the game never rejects them', () => {
    const env = toChatEnvelope({ user: { uniqueId: 'u'.repeat(100), nickname: 'n'.repeat(100) }, comment: 'c'.repeat(500) });
    expect(env).not.toBeNull();
    expect(parseChatEnvelope(env)).not.toBeNull();
    expect(env!.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(env!.handle).toBeUndefined(); // 100 chars is not a real TikTok handle
  });

  test('no handle when TikTok sends none', () => {
    expect(toChatEnvelope({ user: { idStr: '7', nickname: 'Ann' }, content: 'b' })).toEqual({ kind: 'chat', userId: 'tiktok:7', nickname: 'Ann', text: 'b' });
  });

  test('drops events without a user id or comment', () => {
    expect(toChatEnvelope({ comment: 'hi' })).toBeNull();
    expect(toChatEnvelope({ user: { uniqueId: 'x' }, comment: '   ' })).toBeNull();
    expect(toChatEnvelope({ user: { uniqueId: '' }, comment: 'hi' })).toBeNull();
    expect(toChatEnvelope(null)).toBeNull();
  });

  test('limits match the game protocol', () => {
    expect(BRIDGE_LIMITS).toEqual({ text: MAX_TEXT_LENGTH, id: MAX_ID_LENGTH });
    expect(BRIDGE_HANDLE_PATTERN.source).toBe(HANDLE_PATTERN.source);
    expect(EVENT_HANDLE_PATTERN.source).toBe(HANDLE_PATTERN.source);
  });
});

describe('parseBridgeStatus', () => {
  test('accepts known states only', () => {
    expect(parseBridgeStatus({ kind: 'bridgeStatus', state: 'live', host: 'abc', message: 'Connected' }))
      .toEqual({ kind: 'bridgeStatus', state: 'live', host: 'abc', message: 'Connected' });
    expect(parseBridgeStatus({ kind: 'bridgeStatus', state: 'party', host: 'abc', message: '' })).toBeNull();
    expect(parseBridgeStatus({ kind: 'chat' })).toBeNull();
    expect(parseBridgeStatus('x')).toBeNull();
  });
});

describe('isLocalOrigin', () => {
  test('only pages served from this computer may read the bridge', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:5179')).toBe(true);
    expect(isLocalOrigin('https://evil.example')).toBe(false);
    expect(isLocalOrigin('http://localhost.evil.example:80')).toBe(false);
    expect(isLocalOrigin(undefined)).toBe(false);
  });
});
