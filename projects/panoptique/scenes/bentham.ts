// The plan drafted line by line on dark paper, as in an engineer's drawing.
import * as THREE from 'three';
import { circleSegments, defineScene, drawLines, makePoints, smooth, textSprite } from '@studio/runtime';
import { font } from './shared.js';

const PAPER = 0x1a140d;

export default defineScene('bentham', ({ group, camera, bloom, fog, background }) => {
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PAPER }),
  );
  paper.position.y = -0.02;
  group.add(paper);
  const grid: number[] = [];
  for (let i = -20; i <= 20; i++) grid.push(i, 0, -14, i, 0, 14);
  for (let j = -14; j <= 14; j++) grid.push(-20, 0, j, 20, 0, j);
  drawLines(group, grid, 0x3a2c1c, 0.5)(1);

  const R = 9;
  const n = 28;
  const depth = 1.8;
  const s: number[] = [];
  circleSegments(s, R, 0);
  circleSegments(s, R - depth, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s.push(Math.cos(a) * (R - depth), 0, Math.sin(a) * (R - depth), Math.cos(a) * R, 0, Math.sin(a) * R);
  }
  circleSegments(s, 1.6, 0, 48);
  circleSegments(s, 1.2, 0, 48);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.push(
      Math.cos(a) * 1.6,
      0,
      Math.sin(a) * 1.6,
      Math.cos(a) * (R - depth - 0.2),
      0,
      Math.sin(a) * (R - depth - 0.2),
    );
  }
  const draw = drawLines(group, s, 0xe8c48a);
  const pen = makePoints(new Float32Array(3), 0xffe0a0, 0.6);
  group.add(pen);
  const label = textSprite('INSPECTION-HOUSE', { color: '#d9b98a', font: font(56, 400), scale: 0.9 });
  label.position.set(0, 0.1, R + 1.6);
  group.add(label);

  return ({ u, len }) => {
    const k = smooth(0.6, len - 1.5, u);
    const lines = draw(k);
    const arr = lines.geometry.attributes.position?.array ?? [];
    const idx = Math.max(0, lines.geometry.drawRange.count - 1);
    const penPos = pen.geometry.attributes.position as THREE.BufferAttribute;
    penPos.setXYZ(0, arr[idx * 3] ?? 0, 0.05, arr[idx * 3 + 2] ?? 0);
    penPos.needsUpdate = true;
    pen.material.opacity = k < 0.999 ? 1 : 0;
    label.material.opacity = smooth(len - 3, len - 1.5, u);
    camera.position.set(-7 + u * 0.15, 17 - u * 0.2, 14);
    camera.lookAt(-5.5, 0, 0);
    background.setHex(PAPER);
    fog.color.setHex(PAPER);
    fog.density = 0.01;
    bloom.strength = 0.5;
  };
});
