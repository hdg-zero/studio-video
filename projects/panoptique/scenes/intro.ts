// The panopticon at night, seen from above like an eye, the gaze sweeping.
import { defineScene, lerp, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('intro', ({ group, camera, bloom, fog }) => {
  const pan = buildPanopticon(group);
  return ({ u, len, t }) => {
    pan.pose({ phi: t * 0.55, cone: 1, band: 0.9 });
    const k = smooth(0, len, u);
    const ang = 0.6 + u * 0.05;
    const r = lerp(4, 20, k);
    camera.position.set(Math.sin(ang) * r, lerp(34, 13, k), Math.cos(ang) * r);
    camera.lookAt(0, lerp(0, 2.5, k), 0);
    fog.density = 0.012;
    bloom.strength = 0.8;
  };
});
