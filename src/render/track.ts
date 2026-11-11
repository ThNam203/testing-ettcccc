import * as THREE from 'three';
import { nextRandom } from '../engine/rng';

export const LANE_WIDTH = 2.4;
const RUN_UP = 30;
const RUN_OUT = 90;
const RAIL_GAP = 1.2;
const POST_SPACING = 4;
const CROWD_SEED = 20_251_110;

export interface TrackLayout {
  readonly lanes: number;
  readonly distance: number;
}

export interface TrackView {
  readonly root: THREE.Group;
  /** World Z of a lane centre. */
  laneZ(lane: number): number;
  setGateOpen(open: boolean): void;
}

function flat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
}

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas not available');
  const cell = 32;
  for (let y = 0; y < canvas.height / cell; y += 1) {
    for (let x = 0; x < canvas.width / cell; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

function ground(layout: TrackLayout, width: number): THREE.Group {
  const g = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200), flat('#4d8f3f'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(layout.distance / 2, -0.02, 0);
  grass.receiveShadow = true;
  g.add(grass);

  const length = layout.distance + RUN_UP + RUN_OUT;
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(length, width), flat('#a8774a'));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(length / 2 - RUN_UP, 0, 0);
  dirt.receiveShadow = true;
  g.add(dirt);

  const lineMat = new THREE.MeshBasicMaterial({ color: '#f3e6d0', transparent: true, opacity: 0.45 });
  for (let i = 1; i < layout.lanes; i += 1) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.06), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(length / 2 - RUN_UP, 0.01, (i - layout.lanes / 2) * LANE_WIDTH);
    g.add(line);
  }
  return g;
}

function rails(layout: TrackLayout, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const length = layout.distance + RUN_UP + RUN_OUT;
  const white = flat('#f5f5f5');
  const postCount = Math.ceil(length / POST_SPACING);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), white, postCount * 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < postCount; i += 1) {
    const x = i * POST_SPACING - RUN_UP;
    m.makeTranslation(x, 0.55, halfWidth + RAIL_GAP);
    posts.setMatrixAt(i * 2, m);
    m.makeTranslation(x, 0.55, -(halfWidth + RAIL_GAP));
    posts.setMatrixAt(i * 2 + 1, m);
  }
  posts.castShadow = true;
  g.add(posts);
  for (const z of [halfWidth + RAIL_GAP, -(halfWidth + RAIL_GAP)]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 0.16), white);
    rail.position.set(length / 2 - RUN_UP, 1.1, z);
    g.add(rail);
  }
  return g;
}

function finishLine(layout: TrackLayout, width: number): THREE.Group {
  const g = new THREE.Group();
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, width),
    new THREE.MeshBasicMaterial({ map: checkerTexture() }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(layout.distance, 0.02, 0);
  g.add(line);

  const red = flat('#d62828');
  for (const z of [width / 2 + 1.5, -(width / 2 + 1.5)]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 8), red);
    pole.position.set(layout.distance, 3.5, z);
    g.add(pole);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, width + 3), red);
  banner.position.set(layout.distance, 6.6, 0);
  g.add(banner);
  return g;
}

function distanceMarkers(layout: TrackLayout, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const stripe = flat('#d62828');
  for (let x = 100; x < layout.distance; x += 100) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), stripe);
    pole.position.set(x, 1.5, -(halfWidth + RAIL_GAP + 0.6));
    g.add(pole);
  }
  return g;
}

function startGate(layout: TrackLayout, width: number): { group: THREE.Group; doors: THREE.Group } {
  const group = new THREE.Group();
  const frame = flat('#2a9d8f');
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, width + 1), frame);
  top.position.set(-1.6, 3.4, 0);
  group.add(top);
  for (let i = 0; i <= layout.lanes; i += 1) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.4, 0.08), frame);
    divider.position.set(-1.6, 1.7, (i - layout.lanes / 2) * LANE_WIDTH);
    divider.castShadow = true;
    group.add(divider);
  }
  // See-through front bars, so viewers can see the horses waiting in the stalls.
  const doors = new THREE.Group();
  const doorMat = flat('#e9c46a');
  for (const y of [0.9, 1.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, width - 1), doorMat);
    bar.position.set(-0.75, y, 0);
    doors.add(bar);
  }
  group.add(doors);
  return { group, doors };
}

function grandstand(layout: TrackLayout, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const z0 = -(halfWidth + 14);
  const length = 220;
  const x0 = layout.distance - 150;
  for (let tier = 0; tier < 5; tier += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(length, 1.2 * (tier + 1), 3), flat('#8d99ae'));
    step.position.set(x0 + length / 2, 0.6 * (tier + 1), z0 - tier * 3);
    step.receiveShadow = true;
    g.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.4, 18), flat('#edf2f4'));
  roof.position.set(x0 + length / 2, 10, z0 - 6);
  roof.castShadow = true;
  g.add(roof);

  const perRow = 110;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.9, 0.5), flat('#ffffff'), perRow * 5);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let seed = CROWD_SEED;
  for (let tier = 0; tier < 5; tier += 1) {
    for (let i = 0; i < perRow; i += 1) {
      const r = nextRandom(seed);
      seed = r.seed;
      m.makeTranslation(x0 + 2 + i * 2 + r.value, 1.2 * (tier + 1) + 0.45, z0 - tier * 3);
      crowd.setMatrixAt(tier * perRow + i, m);
      crowd.setColorAt(tier * perRow + i, color.setHSL(r.value, 0.6, 0.55));
    }
  }
  g.add(crowd);
  return g;
}

function trees(layout: TrackLayout, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const count = 70;
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 6, 6), flat('#2d6a4f'), count);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 5), flat('#6f4e37'), count);
  const m = new THREE.Matrix4();
  let seed = CROWD_SEED + 1;
  for (let i = 0; i < count; i += 1) {
    const r1 = nextRandom(seed);
    const r2 = nextRandom(r1.seed);
    seed = r2.seed;
    const x = -60 + (i / count) * (layout.distance + 200) + r1.value * 6;
    const z = -(halfWidth + 40 + r2.value * 35);
    m.makeTranslation(x, 1, z);
    trunks.setMatrixAt(i, m);
    m.makeTranslation(x, 5, z);
    leaves.setMatrixAt(i, m);
  }
  leaves.castShadow = true;
  g.add(leaves, trunks);
  return g;
}

export function createTrack(layout: TrackLayout): TrackView {
  const width = layout.lanes * LANE_WIDTH + 2;
  const halfWidth = width / 2;
  const root = new THREE.Group();
  const gate = startGate(layout, width);
  root.add(
    ground(layout, width),
    rails(layout, halfWidth),
    finishLine(layout, width),
    distanceMarkers(layout, halfWidth),
    gate.group,
    grandstand(layout, halfWidth),
    trees(layout, halfWidth),
  );

  return {
    root,
    laneZ: (lane) => (lane - (layout.lanes - 1) / 2) * LANE_WIDTH,
    setGateOpen: (open) => {
      gate.doors.visible = !open;
    },
  };
}
