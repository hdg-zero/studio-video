// The building assembles floor by floor, then light crosses the cells.
import { defineScene, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('plan', ({ group, camera, bloom }) => {
  const pan = buildPanopticon(group);
  return ({ u, len, voiceAt }) => {
    const grow = smooth(0.3, voiceAt + 4.5, u);
    const lit = smooth(len - 4, len - 2, u);
    pan.pose({ phi: 2.2, cone: lit, grow, band: lit });
    const ang = 2.4 + u * 0.07;
    camera.position.set(Math.sin(ang) * 19, 14 - u * 0.3, Math.cos(ang) * 19);
    camera.lookAt(0, 2, 0);
    camera.rotateY(0.3);
    bloom.strength = 0.75;
  };
});
