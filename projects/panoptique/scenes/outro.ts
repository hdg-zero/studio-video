// The lights go out, the tower is empty, the ring becomes an eye seen from above.
// Also replayed under the credits (the camera keeps rising).
import { defineScene, lerp, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('outro', ({ group, camera, bloom, fog }) => {
  const pan = buildPanopticon(group);
  return ({ u, len, t, voiceAt }) => {
    const off = smooth(voiceAt, voiceAt + 5, u);
    pan.pose({ phi: t * 0.45, cone: 1 - off, band: 1 - off, win: lerp(1, 0.45, off), eyes: 0 });
    const k = smooth(0, len + 6, u);
    const ang = 2 + u * 0.05;
    camera.position.set(Math.sin(ang) * lerp(22, 3, k), lerp(8, 42, k), Math.cos(ang) * lerp(22, 3, k));
    camera.lookAt(0, 2, 0);
    bloom.strength = 0.8;
    fog.density = 0.012;
  };
});
