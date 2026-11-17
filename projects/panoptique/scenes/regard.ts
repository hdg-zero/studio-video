// From a cell, looking at the lodge: the gaze passes over us.
import { clamp, defineScene, lerp, smooth } from '@studio/runtime';
import { buildPanopticon } from './shared.js';

export default defineScene('regard', ({ group, camera, bloom, fog }) => {
  const pan = buildPanopticon(group);
  return ({ u, len, t }) => {
    const phi = -1.15 + u * 0.42;
    pan.pose({ phi, cone: 1.4, band: 1.1, light: 1.4 });
    // camera on the third-floor gallery, near the cells, looking at the tower
    const a = Math.PI * 0.5 + 0.02 * Math.sin(t * 0.4);
    const r = lerp(6.6, 5.4, smooth(0, len, u));
    camera.position.set(Math.cos(a) * r, 4.4, Math.sin(a) * r);
    camera.lookAt(-1.5, 4.8, 0);
    // a soft flash when the cone points toward us
    const toward = Math.cos(phi - Math.atan2(Math.cos(a), Math.sin(a)));
    bloom.strength = 0.7 + 0.9 * Math.pow(clamp((toward - 0.9) / 0.1), 2);
    fog.density = 0.02;
  };
});
