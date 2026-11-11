import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** Coat colours, picked by lane so every horse looks different. */
const COATS: readonly string[] = ['#7b4a2a', '#3b2a20', '#c49a6c', '#1c1c1c', '#a0522d', '#d9d4cc', '#8b5a2b', '#5a3a22', '#e0c08a', '#6b4226', '#2e2420', '#b07040'];
const MANE_DARK = '#1a120c';
const HOOF = '#222222';
const SKIN = '#f1c9a5';

/** Gallop: per-leg phase offsets (rotary gallop) and swing amplitude. */
const LEG_PHASES = { fl: 0, fr: 0.35, hl: Math.PI, hr: Math.PI + 0.35 } as const;
const SWING = 0.75;
const STRIDE_PER_METRE = 1.1;

interface Leg {
  readonly hip: THREE.Group;
  readonly knee: THREE.Group;
  readonly phase: number;
}

export interface HorseView {
  readonly root: THREE.Group;
  readonly label: HorseLabel;
  /** Advance animation. speed in m/s; 0 = idle. */
  animate(dt: number, speed: number, time: number): void;
  dispose(): void;
}

export interface HorseLabel {
  readonly element: HTMLDivElement;
  setName(name: string): void;
  setBadge(text: string | null): void;
  setPlace(place: number | null): void;
}

function mat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function buildLeg(coat: THREE.Material, hoof: THREE.Material, x: number, z: number, phase: number): Leg {
  const hip = new THREE.Group();
  hip.position.set(x, 1.25, z);
  hip.add(mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.6, 6), coat, 0, -0.3, 0));
  const knee = new THREE.Group();
  knee.position.set(0, -0.6, 0);
  knee.add(mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), coat, 0, -0.27, 0));
  knee.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), hoof, 0, -0.58, 0));
  hip.add(knee);
  return { hip, knee, phase };
}

function buildBody(coat: THREE.Material, dark: THREE.Material): THREE.Group {
  const body = new THREE.Group();
  const torso = mesh(new THREE.CapsuleGeometry(0.4, 1.25, 4, 8), coat, 0, 1.5, 0);
  torso.rotation.z = Math.PI / 2;
  body.add(torso);

  const neck = mesh(new THREE.BoxGeometry(0.34, 0.95, 0.3), coat, 0.9, 1.95, 0);
  neck.rotation.z = -0.55;
  body.add(neck);
  const mane = mesh(new THREE.BoxGeometry(0.1, 0.9, 0.08), dark, 0.78, 2.05, 0);
  mane.rotation.z = -0.55;
  body.add(mane);

  const head = mesh(new THREE.BoxGeometry(0.7, 0.3, 0.28), coat, 1.35, 2.3, 0);
  head.rotation.z = -0.35;
  body.add(head);
  for (const z of [-0.08, 0.08]) {
    body.add(mesh(new THREE.ConeGeometry(0.05, 0.16, 4), coat, 1.12, 2.55, z));
  }

  const tail = mesh(new THREE.ConeGeometry(0.12, 0.9, 5), dark, -1.05, 1.35, 0);
  tail.rotation.z = -0.5;
  tail.name = 'tail';
  body.add(tail);
  return body;
}

function buildJockey(silk: THREE.Material, skin: THREE.Material): THREE.Group {
  const jockey = new THREE.Group();
  const cloth = mesh(new THREE.BoxGeometry(0.75, 0.04, 0.9), silk, 0.05, 1.9, 0);
  jockey.add(cloth);
  const torso = mesh(new THREE.BoxGeometry(0.32, 0.5, 0.36), silk, 0.3, 2.2, 0);
  torso.rotation.z = -0.9;
  jockey.add(torso);
  jockey.add(mesh(new THREE.SphereGeometry(0.15, 8, 6), skin, 0.55, 2.42, 0));
  const helmet = mesh(new THREE.SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), silk, 0.55, 2.45, 0);
  jockey.add(helmet);
  for (const z of [-0.2, 0.2]) {
    const leg = mesh(new THREE.BoxGeometry(0.4, 0.12, 0.12), silk, 0.05, 1.85, z);
    leg.rotation.z = 0.6;
    jockey.add(leg);
  }
  return jockey;
}

function createLabel(color: string, lane: number): HorseLabel {
  const element = document.createElement('div');
  element.className = 'horse-label';
  element.style.setProperty('--silk', color);
  const place = document.createElement('span');
  place.className = 'horse-label__place';
  const laneTag = document.createElement('span');
  laneTag.className = 'horse-label__lane';
  laneTag.textContent = String(lane + 1);
  const name = document.createElement('span');
  name.className = 'horse-label__name';
  const badge = document.createElement('span');
  badge.className = 'horse-label__badge';
  element.append(place, laneTag, name, badge);

  return {
    element,
    // textContent only: names come from chat and must never be parsed as HTML.
    setName: (text) => { name.textContent = text; },
    setBadge: (text) => {
      badge.textContent = text ?? '';
      badge.hidden = text === null;
    },
    setPlace: (p) => {
      place.textContent = p === null ? '' : String(p);
      place.hidden = p === null;
    },
  };
}

export function createHorse(lane: number, silkColor: string): HorseView {
  const coat = mat(COATS[lane % COATS.length]!);
  const dark = mat(MANE_DARK);
  const hoof = mat(HOOF);
  const silk = mat(silkColor);
  const skin = mat(SKIN);

  const root = new THREE.Group();
  const bodyRig = new THREE.Group();
  root.add(bodyRig);
  const body = buildBody(coat, dark);
  bodyRig.add(body, buildJockey(silk, skin));

  const legs: Leg[] = [
    buildLeg(coat, hoof, 0.62, 0.2, LEG_PHASES.fl),
    buildLeg(coat, hoof, 0.62, -0.2, LEG_PHASES.fr),
    buildLeg(coat, hoof, -0.62, 0.2, LEG_PHASES.hl),
    buildLeg(coat, hoof, -0.62, -0.2, LEG_PHASES.hr),
  ];
  for (const leg of legs) bodyRig.add(leg.hip);

  const label = createLabel(silkColor, lane);
  const labelObject = new CSS2DObject(label.element);
  // Alternate heights so tags of neighbouring lanes don't sit on top of each other.
  labelObject.position.set(0.3, 3.3 + (lane % 2) * 0.9, 0);
  root.add(labelObject);

  const tail = body.getObjectByName('tail');
  let stride = lane * 0.7;

  return {
    root,
    label,
    animate(dt, speed, time) {
      const running = speed > 0.5;
      stride += running ? speed * dt * STRIDE_PER_METRE : 0;
      const effort = Math.min(1, speed / 12);
      for (const leg of legs) {
        const s = Math.sin(stride + leg.phase);
        leg.hip.rotation.z = running ? s * SWING * effort : Math.sin(time * 1.5 + leg.phase) * 0.03;
        leg.knee.rotation.z = running ? Math.max(0, -Math.cos(stride + leg.phase)) * 1.1 * effort : 0;
      }
      bodyRig.position.y = running ? Math.abs(Math.sin(stride)) * 0.12 * effort : Math.sin(time * 2 + lane) * 0.015;
      bodyRig.rotation.z = running ? Math.sin(stride) * 0.04 * effort : 0;
      if (tail) tail.rotation.z = -0.5 - (running ? 0.5 * effort : 0) + Math.sin(time * 3 + lane) * 0.1;
    },
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      for (const m of [coat, dark, hoof, silk, skin]) m.dispose();
      labelObject.element.remove();
    },
  };
}
