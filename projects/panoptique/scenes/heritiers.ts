// Three round prisons along a road; the camera travels past them.
import * as THREE from 'three';
import { defineScene, lerp, smooth, textSprite } from '@studio/runtime';
import { buildPanopticon, font, type PanopticonOptions } from './shared.js';

const PLACES: readonly (readonly [string, number, PanopticonOptions])[] = [
  ['Arnhem · Pays-Bas', 0, { R: 6, floors: 3, n: 22 }],
  ['Stateville · Illinois', 22, { R: 7.5, floors: 4, n: 30 }],
  ['Presidio Modelo · Cuba', 44, { R: 6.5, floors: 5, n: 26 }],
];

export default defineScene('heritiers', ({ group, camera, bloom, fog }) => {
  const prisons = PLACES.map(([name, x, options], i) => {
    const sub = new THREE.Group();
    sub.position.x = x;
    group.add(sub);
    const pan = buildPanopticon(sub, { ...options, ground: i === 0 });
    const label = textSprite(name, { color: '#ffd9a0', font: font(60, 500), scale: 1.1 });
    label.position.set(0, pan.TH + 2.6, 0);
    sub.add(label);
    return { pan, label };
  });

  return ({ u, len, t, voiceAt }) => {
    prisons.forEach(({ pan, label }, i) => {
      pan.pose({ phi: t * 0.5 + i * 2, cone: 1, band: 0.9 });
      const appear = voiceAt + 4.6 + i * 1.1; // as the voice names the countries
      label.material.opacity = smooth(appear, appear + 0.5, u);
    });
    const x = lerp(-6, 50, smooth(0, len, u));
    camera.position.set(x, 17, 24);
    camera.lookAt(x + 3, 2, 0);
    bloom.strength = 0.75;
    fog.density = 0.01;
  };
});
