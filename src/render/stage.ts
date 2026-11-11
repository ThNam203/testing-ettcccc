import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { hasAnswered } from '../engine/game';
import { frameAt, runningOrder } from '../engine/playback';
import type { GameState, Racer } from '../engine/types';
import { createHorse, type HorseView } from './horse';
import { createTrack, type TrackView } from './track';

const SKY = '#a7d8ff';
/** Horse origin is mid-body; nose is ~1.4 m ahead, so this puts noses on the start line. */
const GATE_X = -1.4;
const CAMERA_SMOOTHING = 2.5;

/** Riders fill lanes from the middle outwards so a small field stays centred on screen. */
function physicalLane(slot: number, lanes: number): number {
  const mid = Math.floor((lanes - 1) / 2);
  const offset = Math.ceil(slot / 2) * (slot % 2 === 0 ? -1 : 1);
  return Math.min(lanes - 1, Math.max(0, mid + offset));
}

export interface Stage {
  frame(state: GameState, now: number, dt: number): void;
  resize(): void;
  dispose(): void;
}

interface CameraShot {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
}

interface HorseSlot {
  readonly view: HorseView;
  readonly racerId: string;
  readonly lane: number;
  readonly name: string;
}

function createRenderers(container: HTMLElement): { gl: THREE.WebGLRenderer; labels: CSS2DRenderer } {
  const gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(gl.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'label-layer';
  container.appendChild(labels.domElement);
  return { gl, labels };
}

function createLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight('#dff1ff', '#4d6b3a', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 160;
  scene.add(sun, sun.target);
  return sun;
}

/** Slow swing in front of the starting gate, used while the quiz is running. */
function gateShot(time: number, portrait: boolean): CameraShot {
  // Swings in front of the gate (positive x = down the track), facing the horses.
  const angle = 0.55 + Math.sin(time * 0.12) * 0.3;
  const radius = portrait ? 27 : 22;
  return {
    position: new THREE.Vector3(Math.cos(angle) * radius, portrait ? 10 : 7, Math.sin(angle) * radius),
    target: new THREE.Vector3(-1, 1.6, 0),
  };
}

/** Portrait: behind the pack looking down the track. Landscape: side-on chase. */
function chaseShot(focusX: number, portrait: boolean): CameraShot {
  return portrait
    ? { position: new THREE.Vector3(focusX - 20, 17, 0), target: new THREE.Vector3(focusX + 8, 0, 0) }
    : { position: new THREE.Vector3(focusX - 9, 10, 26), target: new THREE.Vector3(focusX + 5, 0.5, -2) };
}

export function createStage(container: HTMLElement, layout: { lanes: number; distance: number }): Stage {
  const { gl, labels } = createRenderers(container);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 140, 460);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1200);
  const sun = createLights(scene);
  const track: TrackView = createTrack(layout);
  scene.add(track.root);

  const horses = new Map<string, HorseSlot>();
  const cameraTarget = new THREE.Vector3(2, 1.5, 0);
  let time = 0;
  let firstFrame = true;

  function syncHorses(racers: readonly Racer[]): void {
    const laneById = new Map(racers.map((r) => [r.id, r.lane]));
    for (const [id, slot] of horses) {
      if (laneById.get(id) !== slot.lane) {
        scene.remove(slot.view.root);
        slot.view.dispose();
        horses.delete(id);
      }
    }
    for (const racer of racers) {
      const existing = horses.get(racer.id);
      if (existing !== undefined) {
        // Same viewer, same lane, new display name: update the tag only.
        if (existing.name !== racer.name) {
          existing.view.label.setName(racer.name);
          horses.set(racer.id, { ...existing, name: racer.name });
        }
        continue;
      }
      const view = createHorse(racer.lane, racer.color);
      view.root.position.set(GATE_X, 0, track.laneZ(physicalLane(racer.lane, layout.lanes)));
      view.label.setName(racer.name);
      scene.add(view.root);
      horses.set(racer.id, { view, racerId: racer.id, lane: racer.lane, name: racer.name });
    }
  }

  function updateLabels(state: GameState, places: ReadonlyMap<string, number>): void {
    const correct = new Set(state.lastReveal?.correctIds ?? []);
    for (const slot of horses.values()) {
      const answered = hasAnswered(state, slot.racerId);
      const badge = state.phase === 'question' ? (answered ? '✓' : null)
        : state.phase === 'reveal' && correct.has(slot.racerId) ? `+${state.lastReveal?.points ?? 0}`
          : null;
      slot.view.label.setBadge(badge);
      slot.view.label.setPlace(places.get(slot.racerId) ?? null);
    }
  }

  /** Moves horses; returns the x the camera should follow (null = gate shot). */
  function placeHorses(state: GameState, now: number, dt: number): number | null {
    const race = state.race;
    const racing = (state.phase === 'race' || state.phase === 'results') && race !== null;
    if (!racing) {
      track.setGateOpen(false);
      for (const slot of horses.values()) {
        slot.view.root.position.x = GATE_X;
        slot.view.animate(dt, 0, time);
      }
      updateLabels(state, new Map());
      return null;
    }

    const elapsed = state.phase === 'results'
      ? Number.POSITIVE_INFINITY
      : now - state.phaseStartedAt - state.config.raceCountdownMs;
    track.setGateOpen(elapsed >= 0);
    const frames = frameAt(race, elapsed);
    const order = runningOrder(race, elapsed);
    const places = new Map(order.map((id, i) => [id, i + 1]));
    let leader = 0;
    let sum = 0;
    for (const f of frames) {
      const slot = horses.get(f.racerId);
      if (slot === undefined) continue;
      slot.view.root.position.x = f.position + GATE_X;
      slot.view.animate(dt, state.phase === 'results' ? 0 : f.speed, time);
      leader = Math.max(leader, f.position);
      sum += f.position;
    }
    updateLabels(state, elapsed >= 0 ? places : new Map());
    const mean = frames.length > 0 ? sum / frames.length : 0;
    return leader * 0.65 + mean * 0.35;
  }

  function moveCamera(focusX: number | null, dt: number): void {
    const portrait = camera.aspect < 1;
    const shot = focusX === null ? gateShot(time, portrait) : chaseShot(focusX, portrait);
    const k = firstFrame ? 1 : 1 - Math.exp(-dt * CAMERA_SMOOTHING);
    camera.position.lerp(shot.position, k);
    cameraTarget.lerp(shot.target, k);
    camera.lookAt(cameraTarget);
    sun.position.set(cameraTarget.x + 25, 50, cameraTarget.z + 20);
    sun.target.position.copy(cameraTarget);
    firstFrame = false;
  }

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.fov = camera.aspect < 1 ? 70 : 50;
    camera.updateProjectionMatrix();
    gl.setSize(w, h);
    labels.setSize(w, h);
  }

  resize();

  return {
    frame(state, now, dt) {
      time += dt;
      syncHorses(state.racers);
      moveCamera(placeHorses(state, now, dt), dt);
      gl.render(scene, camera);
      labels.render(scene, camera);
    },
    resize,
    dispose() {
      for (const slot of horses.values()) slot.view.dispose();
      horses.clear();
      gl.dispose();
      gl.domElement.remove();
      labels.domElement.remove();
    },
  };
}
