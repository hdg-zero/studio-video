// Rows of people; a scanning line sorts, measures and grades them.
import * as THREE from 'three';
import { defineScene, drawLines, lerp, smooth, textSprite } from '@studio/runtime';
import { AMBER, font, silhouetteGeometry, vary } from './shared.js';

const COLS = 16;
const ROWS = 9;

export default defineScene('discipline', ({ group, camera, bloom }) => {
  const count = COLS * ROWS;
  const people = new THREE.InstancedMesh(
    silhouetteGeometry,
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    count,
  );
  const bars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 1, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    count,
  );
  const d = new THREE.Object3D();
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const id = i * ROWS + j;
      xs[id] = (i - (COLS - 1) / 2) * 1.6;
      zs[id] = (j - (ROWS - 1) / 2) * 1.9;
      d.position.set(xs[id] ?? 0, 0, zs[id] ?? 0);
      d.scale.setScalar(1.2);
      d.updateMatrix();
      people.setMatrixAt(id, d.matrix);
    }
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0e1015 }),
  );
  group.add(people, bars, floor);
  const gridLines: number[] = [];
  for (let i = 0; i <= COLS; i++) {
    const x = (i - COLS / 2) * 1.6;
    gridLines.push(x, 0.01, -9.5, x, 0.01, 9.5);
  }
  for (let j = 0; j <= ROWS; j++) {
    const z = (j - ROWS / 2) * 1.9;
    gridLines.push(-13, 0.01, z, 13, 0.01, z);
  }
  drawLines(group, gridLines, 0x2a3a50, 0.8)(1);
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 4),
    new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  scan.rotation.y = Math.PI / 2;
  scan.position.y = 2;
  group.add(scan);
  const words = ['CLASSER', 'MESURER', 'NOTER', 'OBSERVER'].map((w) => {
    const s = textSprite(w, { color: '#ffd9a0', font: font(64, 600), scale: 0.8 });
    group.add(s);
    return s;
  });
  const c = new THREE.Color();

  return ({ u, len, t, voiceAt }) => {
    const sx = lerp(-15, 15, smooth(voiceAt - 0.3, len - 0.8, u));
    scan.position.x = sx;
    for (let id = 0; id < count; id++) {
      const x = xs[id] ?? 0;
      const done = smooth(x + 0.3, x - 0.5, sx);
      const hot = Math.exp(-(((x - sx) / 0.9) ** 2));
      c.setRGB(0.05 + hot * 0.8 + done * 0.2, 0.06 + hot * 0.55 + done * 0.15, 0.08 + hot * 0.3 + done * 0.07);
      people.setColorAt(id, c);
      // a grade bar grows above each person once scanned (a quarter of them in red)
      const h = done * (0.3 + vary(id) * 1.6);
      d.position.set(x + 0.45, 1.3 + h / 2, zs[id] ?? 0);
      d.scale.set(0.5, Math.max(h, 0.0001), 1);
      d.updateMatrix();
      bars.setMatrixAt(id, d.matrix);
      const low = vary(id) < 0.25;
      c.setRGB(low ? 0.7 : 0.42, low ? 0.18 : 0.32, low ? 0.12 : 0.16);
      bars.setColorAt(id, c);
    }
    if (people.instanceColor) people.instanceColor.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    bars.instanceMatrix.needsUpdate = true;
    words.forEach((s, i) => {
      const a = voiceAt + 0.2 + i * 0.75; // in rhythm with "classer, mesurer, noter, observer"
      s.position.set(-4 + i * 3.2, 5.2 + 0.1 * Math.sin(t + i), -6);
      s.material.opacity = smooth(a, a + 0.35, u) * (1 - smooth(len - 1.2, len - 0.4, u));
    });
    camera.position.set(lerp(4, 1, smooth(0, len, u)), 9, 15);
    camera.lookAt(-2.5, 1.2, 0);
    bloom.strength = 0.7;
  };
});
