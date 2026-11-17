// Particles spiralling into a glowing core while the title card is shown.
import { defineScene, lerp, makePoints, smooth } from '@studio/runtime';

const N = 5000;

export default defineScene('intro', ({ group, camera, rng }) => {
  const radius = Float32Array.from({ length: N }, () => 4 + rng() * 14);
  const angle = Float32Array.from({ length: N }, () => rng() * Math.PI * 2);
  const height = Float32Array.from({ length: N }, () => (rng() - 0.5) * 2);
  const cloud = makePoints(new Float32Array(N * 3), 0x7fe3ff, 0.08);
  const core = makePoints(new Float32Array(3), 0xffc861, 3);
  group.add(cloud, core);
  const pos = cloud.geometry.getAttribute('position');

  return ({ u, len, t }) => {
    const f = smooth(0, len, u);
    for (let i = 0; i < N; i++) {
      const r = (radius[i] ?? 0) * Math.pow(1 - f * 0.85, 2.2);
      const a = (angle[i] ?? 0) + t * (0.6 / Math.max(r, 0.3));
      pos.setXYZ(i, Math.cos(a) * r, (height[i] ?? 0) * r * 0.15, Math.sin(a) * r);
    }
    pos.needsUpdate = true;
    core.material.size = 3 + Math.sin(t * 3) * 0.4;
    camera.position.set(0, lerp(14, 6, f), lerp(22, 12, f));
    camera.lookAt(0, 0, 0);
  };
});
