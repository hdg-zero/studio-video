// The tower empties; each prisoner now carries the gaze.
import { defineScene, lerp, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('interieur', ({ group, camera, bloom }) => {
  const pan = buildPanopticon(group);
  return ({ u, len, t, voiceAt }) => {
    const empty = smooth(voiceAt + 2.5, voiceAt + 5.5, u);
    pan.pose({
      phi: t * 0.5,
      cone: 1 - empty,
      band: 1 - empty * 0.95,
      tower: 1 - empty * 0.85,
      eyes: smooth(voiceAt + 6, voiceAt + 8, u),
    });
    const ang = 1.2 + u * 0.05;
    const k = smooth(2, len, u);
    const r = lerp(7, 17, k);
    camera.position.set(Math.sin(ang) * r, lerp(5, 15, k), Math.cos(ang) * r);
    camera.lookAt(-2.5, 3, 0);
    bloom.strength = 0.8;
  };
});
