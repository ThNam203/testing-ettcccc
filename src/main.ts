import './ui/styles.css';
import { createAnalytics, type Analytics } from './history/client';
import { runAdminCommand } from './admin/commands';
import { createHostBridge, type HostBridge } from './admin/hostBridge';
import type { AdminCommand } from './admin/protocol';
import { ChatSourceUnavailableError, LocalChatSource, TikTokChatSource, type ChatSource } from './chat/chatSource';
import type { StatusEnvelope } from './chat/protocol';
import { BRIDGE_PATH, BRIDGE_PORT, type BridgeStatus } from './chat/tiktokBridge';
import { QUESTION_BANK } from './content/questions';
import { CONFIG_LIMITS } from './engine/configRules';
import { createGame, isLockedAnswer, reduce } from './engine/game';
import { RACE } from './engine/race';
import type { ChatMessage, GameAction, GameState, Level } from './engine/types';
import { createStage, type Stage } from './render/stage';
import { settingsFromState, type DisplaySettings } from './settings/schema';
import { loadSettings, saveSettings } from './settings/storage';
import { createHud, type Hud } from './ui/hud';

/** Game logic keeps ticking even when the tab is in the background (rAF pauses there). */
const LOGIC_TICK_MS = 200;
const STATUS_HEARTBEAT_MS = 2_000;
const MAX_FRAME_DT = 0.1;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
}

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing #${id} in index.html`);
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function toStatus(state: GameState): StatusEnvelope {
  const q = state.phase === 'question' || state.phase === 'reveal' ? state.questions[state.round] : undefined;
  return {
    kind: 'status',
    phase: state.phase,
    raceNumber: state.raceNumber,
    round: state.round,
    rounds: state.questions.length,
    prompt: q?.prompt ?? null,
    choices: q?.choices ?? [],
    stat: q?.stat ?? null,
    racerIds: state.racers.map((r) => r.id),
    queuedIds: state.queue.map((p) => p.id),
  };
}

/** What the on-screen chat shows: blocked users are hidden; answers can be masked so others can't copy. */
function chatForDisplay(state: GameState, display: DisplaySettings, message: ChatMessage, shownText?: string): ChatMessage | null {
  if (state.blocked.some((b) => b.id === message.userId.trim())) return null;
  if (display.maskAnswers && isLockedAnswer(state, message)) return { ...message, text: 'answered ✓' };
  return shownText === undefined ? message : { ...message, text: shownText };
}

interface Host {
  readonly getState: () => GameState;
  readonly getDisplay: () => DisplaySettings;
  readonly dispatch: (action: GameAction) => void;
  readonly analytics: Analytics;
}

/** ?source=tiktok uses the local TikTok bridge; &mode=firstchar turns every comment into an answer (testing). */
function createSource(hud: Hud, analytics: Analytics): ChatSource {
  const params = new URLSearchParams(window.location.search);
  if (params.get('source') !== 'tiktok') return new LocalChatSource();
  const firstChar = params.get('mode') === 'firstchar';
  const suffix = firstChar ? ' · test: first letter = answer' : '';
  let reportedHost: string | null = null;
  return new TikTokChatSource({
    url: `http://127.0.0.1:${BRIDGE_PORT}${BRIDGE_PATH}`,
    firstCharAnswers: firstChar,
    onStatus: (status: BridgeStatus) => {
      hud.setSourceLabel(`TikTok @${status.host} · ${status.state}${suffix}`);
      if (status.state === 'live' && reportedHost !== status.host) {
        reportedHost = status.host;
        analytics.source('tiktok', status.host);
      }
      if (status.state === 'error' || status.state === 'ended') hud.showError(status.message);
      else hud.clearError();
    },
    onBridgeDown: () => {
      hud.setSourceLabel('TikTok · bridge offline');
      hud.showError(`TikTok bridge not reachable on port ${BRIDGE_PORT}. Start it with: npm run tiktok -- <username>. Retrying…`);
    },
  });
}

function connectChat(hud: Hud, host: Host): ChatSource | null {
  try {
    const source = createSource(hud, host.analytics);
    hud.setSourceLabel(`💬 ${source.label}`);
    source.start((message, shownText) => {
      const shown = chatForDisplay(host.getState(), host.getDisplay(), message, shownText);
      if (shown !== null) hud.pushChat(shown);
      // Count chat for stats (never the text); blocked users are not tracked.
      if (!host.getState().blocked.some((b) => b.id === message.userId.trim())) host.analytics.chat(message);
      host.dispatch({ type: 'chat', message, now: performance.now() });
    });
    return source;
  } catch (error: unknown) {
    const reason = error instanceof ChatSourceUnavailableError ? error.message : `Chat failed to start: ${errorMessage(error)}`;
    hud.showError(reason, () => window.location.reload());
    return null;
  }
}

function boot(): void {
  const hudRoot = requireElement('hud');
  const loaded = loadSettings(QUESTION_BANK);
  let display = loaded.settings.display;
  let state: GameState = createGame({
    bank: QUESTION_BANK,
    seed: randomSeed(),
    now: performance.now(),
    config: loaded.settings.config,
    level: loaded.settings.level,
    blocked: loaded.settings.blocked,
  });
  const isTikTok = new URLSearchParams(window.location.search).get('source') === 'tiktok';
  const hudRef: { current: Hud | null } = { current: null };
  // Settings snapshot for the stats session, without the block list (names stay out of stats).
  const analytics = createAnalytics({
    source: isTikTok ? 'tiktok' : 'local',
    settings: JSON.stringify({ ...loaded.settings, blocked: loaded.settings.blocked.length }),
    onHealth: (ok, pending, dropped) => hudRef.current?.setStatsLabel(
      ok ? 'stats: saving' : `stats: server offline (${pending} waiting${dropped > 0 ? `, ${dropped} lost` : ''}) · npm run server`,
      ok,
    ),
    onRejected: (total) => hudRef.current?.setStatsLabel(`stats: saving · ${total} event(s) rejected by the server (see server log)`, false),
  });
  const dispatch = (action: GameAction): void => {
    const prev = state;
    state = reduce(state, action);
    if (state !== prev) analytics.observe(prev, state, 'now' in action ? action.now : performance.now());
  };

  let bridge: HostBridge | null = null;
  const applyDisplay = (next: DisplaySettings): void => {
    display = next;
    hud.applyDisplay(next);
    document.body.classList.toggle('hide-name-tags', !next.showNameTags);
  };
  const persist = (): string | null => saveSettings(settingsFromState(state, display));

  /** Every settings change (admin page or host bar) goes through here, so it is validated and saved. */
  const handleCommand = (command: AdminCommand): { ok: boolean; message: string } => {
    const outcome = runAdminCommand({ state, display, now: performance.now() }, command, QUESTION_BANK);
    outcome.actions.forEach(dispatch);
    if (outcome.display !== display) applyDisplay(outcome.display);
    if (!outcome.ok || !outcome.persist) return outcome;
    const saveError = persist();
    if (saveError !== null) hud.showError(saveError);
    return saveError === null ? outcome : { ok: true, message: `${outcome.message} ${saveError}` };
  };

  const changeLevel = (level: Level): void => {
    const result = handleCommand({ type: 'applySettings', settings: { ...settingsFromState(state, display), level } });
    if (!result.ok) hud.showError(result.message);
  };

  const hud = createHud(hudRoot, {
    onStart: () => handleCommand({ type: 'start' }),
    onSkip: () => handleCommand({ type: 'skip' }),
    onReset: () => handleCommand({ type: 'reset' }),
    onLevel: changeLevel,
  });
  hudRef.current = hud;
  applyDisplay(display);
  if (loaded.notice !== null) hud.showError(loaded.notice);
  if (loaded.shouldResave) {
    const saveError = persist();
    if (saveError !== null) hud.showError(saveError);
  }

  let stage: Stage | null = null;
  try {
    // Always build every lane: max riders can change from the admin page without a reload.
    stage = createStage(requireElement('stage'), { lanes: CONFIG_LIMITS.maxRacers.max, distance: RACE.distance });
    window.addEventListener('resize', () => stage?.resize());
  } catch (error: unknown) {
    hud.showError(`3D view unavailable (WebGL): ${errorMessage(error)}. The quiz still works.`, () => window.location.reload());
  }

  const host: Host = { getState: () => state, getDisplay: () => display, dispatch, analytics };
  const source = connectChat(hud, host);
  bridge = createHostBridge(QUESTION_BANK, handleCommand, () => ({ state, display }));
  let rendered: GameState | null = null;
  let lastStatusAt = 0;

  const syncUi = (now: number): void => {
    if (state !== rendered) {
      hud.render(state, now);
      source?.publishStatus?.(toStatus(state));
      lastStatusAt = now;
      rendered = state;
    } else if (now - lastStatusAt > STATUS_HEARTBEAT_MS) {
      source?.publishStatus?.(toStatus(state));
      lastStatusAt = now;
    }
    bridge?.sync(state, display, now);
  };

  window.setInterval(() => {
    const now = performance.now();
    dispatch({ type: 'tick', now });
    syncUi(now);
  }, LOGIC_TICK_MS);

  let lastFrame = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(MAX_FRAME_DT, (now - lastFrame) / 1000);
    lastFrame = now;
    dispatch({ type: 'tick', now });
    syncUi(now);
    hud.tick(state, now);
    stage?.frame(state, now, dt);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

try {
  boot();
} catch (error: unknown) {
  const fatal = document.createElement('div');
  fatal.className = 'fatal';
  fatal.textContent = `English Derby could not start: ${errorMessage(error)}`;
  document.body.append(fatal);
}
