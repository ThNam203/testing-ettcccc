import { describe, expect, test } from 'vitest';
import { MAX_TEXT_LENGTH, parseChatEnvelope, parseStatusEnvelope } from '../src/chat/protocol';

describe('parseChatEnvelope (untrusted channel data)', () => {
  test('accepts a well-formed chat message and trims fields', () => {
    expect(parseChatEnvelope({ kind: 'chat', userId: ' u1 ', nickname: 'Mai ', text: ' b ' }))
      .toEqual({ userId: 'u1', nickname: 'Mai', text: 'b' });
  });

  test('keeps a valid TikTok @handle; drops a malformed one but keeps the message', () => {
    expect(parseChatEnvelope({ kind: 'chat', userId: 'tiktok:1', nickname: 'Mai', text: 'a', handle: 'mai.123_x' }))
      .toEqual({ userId: 'tiktok:1', nickname: 'Mai', text: 'a', handle: 'mai.123_x' });
    for (const handle of ['', 'has space', 'x'.repeat(25), 'evil<script>', 42]) {
      expect(parseChatEnvelope({ kind: 'chat', userId: 'u', nickname: 'n', text: 't', handle }))
        .toEqual({ userId: 'u', nickname: 'n', text: 't' });
    }
  });

  test('rejects wrong kind, missing or non-string fields, blanks, oversize text', () => {
    expect(parseChatEnvelope(null)).toBeNull();
    expect(parseChatEnvelope('chat')).toBeNull();
    expect(parseChatEnvelope({ kind: 'status', userId: 'u', nickname: 'n', text: 't' })).toBeNull();
    expect(parseChatEnvelope({ kind: 'chat', userId: 1, nickname: 'n', text: 't' })).toBeNull();
    expect(parseChatEnvelope({ kind: 'chat', userId: 'u', nickname: '  ', text: 't' })).toBeNull();
    expect(parseChatEnvelope({ kind: 'chat', userId: 'u', nickname: 'n', text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })).toBeNull();
  });
});

describe('parseStatusEnvelope', () => {
  const valid = {
    kind: 'status', phase: 'question', raceNumber: 1, round: 2, rounds: 6,
    prompt: 'Q?', choices: ['a', 'b', 'c', 'd'], stat: 'speed', racerIds: ['u1'], queuedIds: [],
  };

  test('accepts a valid status', () => {
    expect(parseStatusEnvelope(valid)).toEqual(valid);
  });

  test('accepts null prompt/stat outside question phases', () => {
    expect(parseStatusEnvelope({ ...valid, phase: 'lobby', prompt: null, stat: null, choices: [] })).not.toBeNull();
  });

  test('rejects unknown phase, unknown stat, bad arrays', () => {
    expect(parseStatusEnvelope({ ...valid, phase: 'party' })).toBeNull();
    expect(parseStatusEnvelope({ ...valid, stat: 'luck' })).toBeNull();
    expect(parseStatusEnvelope({ ...valid, choices: [1, 2] })).toBeNull();
    expect(parseStatusEnvelope({ ...valid, round: '2' })).toBeNull();
    expect(parseStatusEnvelope({ ...valid, prompt: 5 })).toBeNull();
    expect(parseStatusEnvelope(undefined)).toBeNull();
  });
});
