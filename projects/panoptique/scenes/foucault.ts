// From one panopticon to a whole society of them: a lit grid spreading to the horizon.
import * as THREE from 'three';
import { defineScene, lerp, makePoints, smooth } from '@studio/runtime';
import { AMBER, vary } from './shared.js';

export default defineScene('foucault', ({ group, camera, bloom, fog }) => {
  const M = 25;
  const count = M * M;
  const spacing = 5;
  const rings = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1.6, 0.35, 8, 40).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5a606a, roughness: 0.9 }),
    count,
  );
  const towers = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.3, 0.35, 1.6, 12),
    new THREE.MeshStandardMaterial({ color: 0x2c3038 }),
    count,
  );
  const d = new THREE.Object3D();
  const lights = new Float32Array(count * 3);
  const dist = new Float32Array(count);
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const id = i * M + j;
      const x = (i - (M - 1) / 2) * spacing;
      const z = (j - (M - 1) / 2) * spacing;
      d.position.set(x, 0.35, z);
      d.updateMatrix();
      rings.setMatrixAt(id, d.matrix);
      d.position.set(x, 0.8, z);
      d.updateMatrix();
      towers.setMatrixAt(id, d.matrix);
      lights.set([x, 1.75, z], id * 3);
      dist[id] = Math.hypot(x, z);
    }
  }
  const lamps = makePoints(lights, AMBER, 0.9, 1);
  const colors = new Float32Array(count * 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  lamps.geometry.setAttribute('color', colorAttr);
  lamps.material.vertexColors = true;
  lamps.material.color.setHex(0xffffff);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0c0e13 }),
  );
  group.add(rings, towers, lamps, ground);

  return ({ u, len, t }) => {
    const k = smooth(0.5, len - 1, u);
    const front = lerp(2, 75, k);
    for (let i = 0; i < count; i++) {
      const v = smooth(front, front - 6, dist[i] ?? 0) * (0.75 + 0.25 * Math.sin(t * 2 + vary(i) * 30));
      colors[i * 3] = v;
      colors[i * 3 + 1] = v * 0.7;
      colors[i * 3 + 2] = v * 0.36;
    }
    colorAttr.needsUpdate = true;
    const h = lerp(4, 55, k * k);
    const r = lerp(7, 30, k);
    camera.position.set(r * 0.6, h, r);
    camera.lookAt(-lerp(1.5, 14, k), 0, 0);
    fog.density = 0.008;
    bloom.strength = 0.8;
  };
});
