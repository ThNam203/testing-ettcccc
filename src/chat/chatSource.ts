import type { ChatMessage } from '../engine/types';
import { LOCAL_CHANNEL, parseChatEnvelope, type StatusEnvelope } from './protocol';
import { firstCharAnswer, parseBridgeStatus, type BridgeStatus } from './tiktokBridge';

export type Unsubscribe = () => void;

/** `shownText`: what the on-screen chat should show when it differs from what the engine gets. */
export type ChatHandler = (message: ChatMessage, shownText?: string) => void;

/**
 * Where chat comes from. The engine only sees ChatMessage, so swapping the local
 * simulator for TikTok LIVE (phase 2) does not touch game logic.
 */
export interface ChatSource {
  readonly label: string;
  start(onMessage: ChatHandler): Unsubscribe;
  /** Optional: push game status to the source (local simulator shows the current question). */
  publishStatus?(status: StatusEnvelope): void;
}

export class ChatSourceUnavailableError extends Error {}

/** Chat typed into player.html tabs on this machine, delivered over BroadcastChannel. */
export class LocalChatSource implements ChatSource {
  readonly label = 'Local chat simulator';
  private readonly channel: BroadcastChannel;

  constructor() {
    if (typeof BroadcastChannel === 'undefined') {
      throw new ChatSourceUnavailableError('This browser does not support BroadcastChannel, so local chat cannot work.');
    }
    this.channel = new BroadcastChannel(LOCAL_CHANNEL);
  }

  start(onMessage: ChatHandler): Unsubscribe {
    const handler = (event: MessageEvent<unknown>): void => {
      const message = parseChatEnvelope(event.data);
      if (message !== null) onMessage(message);
    };
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }

  publishStatus(status: StatusEnvelope): void {
    this.channel.postMessage(status);
  }
}

export interface TikTokSourceOptions {
  /** Bridge endpoint, e.g. http://127.0.0.1:5180/events (scripts/tiktok-bridge.mjs). */
  readonly url: string;
  /** Test mode: every comment becomes an answer letter from its first character. */
  readonly firstCharAnswers: boolean;
  readonly onStatus: (status: BridgeStatus) => void;
  /** The bridge is not reachable (not started, or stopped). EventSource keeps retrying by itself. */
  readonly onBridgeDown: () => void;
}

/** Comments from a TikTok LIVE, relayed by the local bridge over Server-Sent Events. */
export class TikTokChatSource implements ChatSource {
  readonly label = 'TikTok LIVE';
  private readonly options: TikTokSourceOptions;

  constructor(options: TikTokSourceOptions) {
    if (typeof EventSource === 'undefined') {
      throw new ChatSourceUnavailableError('This browser does not support EventSource, so it cannot read the TikTok bridge.');
    }
    this.options = options;
  }

  start(onMessage: ChatHandler): Unsubscribe {
    const { url, firstCharAnswers, onStatus, onBridgeDown } = this.options;
    const events = new EventSource(url);
    events.addEventListener('message', (event: MessageEvent<unknown>) => {
      let data: unknown;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      } catch {
        return; // Not JSON: ignore, the bridge only sends JSON.
      }
      const status = parseBridgeStatus(data);
      if (status !== null) {
        onStatus(status);
        return;
      }
      const message = parseChatEnvelope(data);
      if (message === null) return;
      if (!firstCharAnswers) {
        onMessage(message);
        return;
      }
      const letter = firstCharAnswer(message.text);
      if (letter !== null) onMessage({ ...message, text: letter }, `${message.text} → ${letter.toUpperCase()}`);
    });
    events.addEventListener('error', () => {
      if (events.readyState !== EventSource.OPEN) onBridgeDown();
    });
    return () => events.close();
  }
}
