// The blueprint, never built, dissolves into dust.
import type * as THREE from 'three';
import { circleSegments, clamp, defineScene, drawLines, lerp, makePoints, smooth } from '@studio/runtime';
import { BLUE, vary } from './shared.js';

export default defineScene('echec', ({ group, camera, bloom }) => {
  const R = 9;
  const depth = 1.8;
  const s: number[] = [];
  for (let f = 0; f <= 4; f++) {
    circleSegments(s, R, f * 1.6);
    circleSegments(s, R - depth, f * 1.6);
  }
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    for (const r of [R, R - depth]) s.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * r, 6.4, Math.sin(a) * r);
  }
  circleSegments(s, 1.5, 0, 40);
  circleSegments(s, 1.5, 8, 40);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.push(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5, Math.cos(a) * 1.5, 8, Math.sin(a) * 1.5);
  }
  const lines = drawLines(group, s, BLUE, 0.8)(1);

  // dust particles start on the blueprint lines, then fall and scatter
  const N = 6000;
  const segCount = s.length / 6;
  const base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const j = Math.floor(vary(i) * segCount) * 6;
    const k = vary(i + N);
    base.set(
      [lerp(s[j] ?? 0, s[j + 3] ?? 0, k), lerp(s[j + 1] ?? 0, s[j + 4] ?? 0, k), lerp(s[j + 2] ?? 0, s[j + 5] ?? 0, k)],
      i * 3,
    );
  }
  const dust = makePoints(base.slice(), BLUE, 0.07, 0);
  group.add(dust);
  const pos = dust.geometry.attributes.position as THREE.BufferAttribute;
  const a = pos.array as Float32Array;

  return ({ u, len, voiceAt }) => {
    const k = smooth(voiceAt + 4, len - 0.5, u);
    lines.material.opacity = 0.8 * (1 - smooth(0, 0.6, k));
    dust.material.opacity = smooth(0, 0.15, k) * (1 - smooth(0.8, 1, k) * 0.6);
    for (let i = 0; i < N; i++) {
      const kk = clamp(k * 1.6 - vary(i + 2 * N) * 0.6);
      const e = kk * kk;
      const bx = base[i * 3] ?? 0;
      const by = base[i * 3 + 1] ?? 0;
      const bz = base[i * 3 + 2] ?? 0;
      a[i * 3] = bx + e * (vary(i + 3 * N) - 0.5) * 6;
      a[i * 3 + 1] = by - e * (by + 1 + vary(i + 4 * N) * 3);
      a[i * 3 + 2] = bz + e * (vary(i + 5 * N) - 0.5) * 6;
    }
    pos.needsUpdate = true;
    const ang = 0.3 + u * 0.04;
    camera.position.set(Math.sin(ang) * 22, 10, Math.cos(ang) * 22);
    camera.lookAt(-4, 2.5, 0);
    bloom.strength = 0.7;
  };
});
