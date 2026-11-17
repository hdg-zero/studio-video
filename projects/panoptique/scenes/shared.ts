/**
 * Palette and models shared by the panoptique scenes: the ring of cells, the inspection
 * tower and the sweeping gaze cone (`buildPanopticon`).
 */
import * as THREE from 'three';
import { clamp, makePoints, randomTable, smooth } from '@studio/runtime';

export const AMBER = 0xffb35c;
export const BLUE = 0x6fa8ff;
export const RED = 0xff5040;

/** Stable per-instance variation shared by every scene. */
export const vary = randomTable(20_000, 'panoptique');

/** CSS font shorthand in the capsule's typeface. */
export const font = (px: number, weight = 600): string => `${weight} ${px}px "Space Grotesk"`;

/** A standing silhouette (body + head), origin at the feet, about 1 unit tall. */
export const silhouetteGeometry = ((): THREE.ShapeGeometry => {
  const body = new THREE.Shape();
  body.moveTo(-0.17, 0);
  body.lineTo(0.17, 0);
  body.lineTo(0.21, 0.5);
  body.quadraticCurveTo(0, 0.6, -0.21, 0.5);
  body.closePath();
  const head = new THREE.Shape();
  head.absarc(0, 0.7, 0.12, 0, Math.PI * 2, false);
  return new THREE.ShapeGeometry([body, head], 6);
})();

/** Vertical slits for the lit blinds of the inspection lodge. */
function slitTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 16; i++) ctx.fillRect(i * 16 + 6, 8, 4, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

export interface PanopticonOptions {
  /** Outer radius of the ring. */
  R?: number;
  floors?: number;
  /** Cells per floor. */
  n?: number;
  /** Floor height. */
  fh?: number;
  /** Cell depth. */
  depth?: number;
  ground?: boolean;
  /** Fraction of occupied cells. */
  fill?: number;
}

export interface PanopticonPose {
  /** Gaze direction: the cone points to (sin φ, cos φ). */
  phi?: number;
  cone?: number;
  win?: number;
  band?: number;
  light?: number;
  /** Opacity of the amber "internalised gaze" eyes in every head. */
  eyes?: number;
  /** Construction progress 0..1 (floors rise one after another). */
  grow?: number;
  tower?: number;
}

export interface Panopticon {
  /** Height of the tower. */
  readonly TH: number;
  pose(p?: PanopticonPose): void;
}

export function buildPanopticon(
  g: THREE.Object3D,
  { R = 9, floors = 4, n = 28, fh = 1.6, depth = 1.8, ground = true, fill = 0.8 }: PanopticonOptions = {},
): Panopticon {
  const stone = new THREE.MeshStandardMaterial({ color: 0x50555e, roughness: 0.9 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 1, side: THREE.DoubleSide });
  const d = new THREE.Object3D();
  const headPts: number[] = [];
  const angles = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * Math.PI * 2);
  const floorGroups: THREE.Group[] = [];
  const windows: THREE.InstancedMesh[] = [];
  const silhouettes: THREE.InstancedMesh[] = [];

  for (let f = 0; f < floors; f++) {
    const fg = new THREE.Group();
    fg.position.y = f * fh;
    g.add(fg);
    floorGroups.push(fg);
    const slab = new THREE.Mesh(new THREE.RingGeometry(R - depth - 0.35, R + 0.15, 96, 1).rotateX(-Math.PI / 2), stone);
    slab.position.y = 0.01;
    fg.add(slab);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.15, fh, 96, 1, true), wallM);
    wall.position.y = fh / 2;
    fg.add(wall);
    const div = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, fh, depth), stone, n);
    const win = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.5, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      n,
    );
    const sil = new THREE.InstancedMesh(
      silhouetteGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      n,
    );
    const bars: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = angles[i] as number;
      const a2 = (i / n) * Math.PI * 2;
      d.position.set(Math.cos(a2) * (R - depth / 2), fh / 2, Math.sin(a2) * (R - depth / 2));
      d.lookAt(0, fh / 2, 0);
      d.updateMatrix();
      div.setMatrixAt(i, d.matrix);
      d.position.set(Math.cos(a) * (R - 0.06), fh * 0.55, Math.sin(a) * (R - 0.06));
      d.lookAt(0, fh * 0.55, 0);
      d.updateMatrix();
      win.setMatrixAt(i, d.matrix);
      win.setColorAt(i, new THREE.Color(1.3, 0.9, 0.5));
      const occupied = vary(f * 97 + i) < fill;
      const rr = R - 0.5 - vary(f * 131 + i) * 0.5;
      const s = occupied ? 0.9 + vary(f * 53 + i) * 0.25 : 0.0001;
      d.position.set(Math.cos(a) * rr, 0.02, Math.sin(a) * rr);
      d.lookAt(0, 0.02, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      sil.setMatrixAt(i, d.matrix);
      d.scale.setScalar(1);
      sil.setColorAt(i, new THREE.Color(0.012, 0.012, 0.016));
      if (occupied) headPts.push(Math.cos(a) * (rr - 0.05), f * fh + 0.7 * s, Math.sin(a) * (rr - 0.05));
      for (let b = 0; b < 5; b++) {
        const ab = a2 + ((b + 1) / 6) * ((Math.PI * 2) / n);
        const rb = R - depth;
        bars.push(Math.cos(ab) * rb, 0, Math.sin(ab) * rb, Math.cos(ab) * rb, fh, Math.sin(ab) * rb);
      }
    }
    fg.add(div, win, sil);
    windows.push(win);
    silhouettes.push(sil);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bars, 3));
    fg.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x6a7078 })));
  }

  const roof = new THREE.Mesh(new THREE.RingGeometry(R - depth - 0.35, R + 0.3, 96, 1).rotateX(-Math.PI / 2), stone);
  roof.position.y = floors * fh;
  g.add(roof);

  // the tower, its lit band of blinds and its cap
  const TH = floors * fh + 1.6;
  const tower = new THREE.Group();
  g.add(tower);
  const towerM = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.8, transparent: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, TH, 40), towerM);
  body.position.y = TH / 2;
  tower.add(body);
  const bandM = new THREE.MeshBasicMaterial({
    map: slitTexture(),
    color: AMBER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.47, 1.5, fh * 1.6, 40, 1, true), bandM);
  band.position.y = TH * 0.62;
  tower.add(band);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.3, 40), towerM);
  cap.position.y = TH + 0.65;
  tower.add(cap);

  // gaze cone: apex in the lodge, opening toward the cells
  const coneGeo = new THREE.ConeGeometry(1, 1, 40, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateX(-Math.PI / 2);
  const cone = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffc070,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  cone.position.y = TH * 0.62;
  cone.scale.set(2.2, 1.6, R - 1);
  g.add(cone);

  // internalised gaze: a small amber eye in every head
  const eyes = makePoints(new Float32Array(headPts), AMBER, 0.22, 0);
  g.add(eyes);

  if (ground) {
    const gr = new THREE.Mesh(
      new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 1 }),
    );
    gr.position.y = -0.02;
    g.add(gr);
  }

  const c = new THREE.Color();
  const pose = ({
    phi = 0,
    cone: coneK = 1,
    win = 1,
    band: bandK = 1,
    light = 1,
    eyes: eyesK = 0,
    grow = 1,
    tower: towerK = 1,
  }: PanopticonPose = {}): void => {
    const dx = Math.sin(phi);
    const dz = Math.cos(phi);
    cone.rotation.y = phi;
    cone.material.opacity = 0.1 * coneK;
    cone.visible = coneK > 0.01;
    bandM.opacity = bandK;
    towerM.opacity = towerK;
    towerM.depthWrite = towerK > 0.95;
    eyes.material.opacity = eyesK;
    for (let f = 0; f < floors; f++) {
      const fg = floorGroups[f] as THREE.Group;
      const winMesh = windows[f] as THREE.InstancedMesh;
      const silMesh = silhouettes[f] as THREE.InstancedMesh;
      const k = smooth(f / floors, (f + 1) / floors, grow);
      fg.scale.y = Math.max(k, 0.001);
      fg.visible = k > 0.01;
      for (let i = 0; i < n; i++) {
        const a = angles[i] as number;
        const dd = Math.cos(a) * dx + Math.sin(a) * dz;
        const lit = light * Math.pow(clamp((dd - 0.86) / 0.14), 2) * coneK;
        const flick = 0.85 + 0.15 * Math.sin(vary(f * 40 + i) * 50 + phi * 3);
        c.setRGB((1.2 * flick + lit * 1.2) * win, (0.8 * flick + lit * 1.0) * win, (0.42 * flick + lit * 0.7) * win);
        winMesh.setColorAt(i, c);
        c.setRGB(0.012 + lit * 0.5, 0.012 + lit * 0.38, 0.016 + lit * 0.25);
        silMesh.setColorAt(i, c);
      }
      if (winMesh.instanceColor) winMesh.instanceColor.needsUpdate = true;
      if (silMesh.instanceColor) silMesh.instanceColor.needsUpdate = true;
    }
    roof.visible = grow > 0.98;
    tower.scale.y = Math.max(smooth(0.15, 1, grow), 0.001);
    cone.position.y = TH * 0.62 * tower.scale.y;
  };

  return { TH, pose };
}
