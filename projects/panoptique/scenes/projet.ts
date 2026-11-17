// A model on a warm table; the idea extends to other institutions.
import * as THREE from 'three';
import { defineScene, smooth, textSprite } from '@studio/runtime';
import { buildPanopticon, font } from './shared.js';

const WARM_BG = 0x120b06;

export default defineScene('projet', ({ group, camera, bloom, fog, background }) => {
  const model = new THREE.Group();
  model.scale.setScalar(0.4);
  group.add(model);
  const pan = buildPanopticon(model, { ground: false });
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.3, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 0.7 }),
  );
  table.position.y = -0.17;
  group.add(table);
  const warm = new THREE.PointLight(0xffc890, 40, 30, 1.5);
  warm.position.set(3, 6, 4);
  group.add(warm);
  const words = ['PRISON', 'USINE', 'HÔPITAL', 'ÉCOLE'].map((w) => {
    const s = textSprite(w, { color: '#ffd9a0', font: font(64, 600), scale: 0.55 });
    group.add(s);
    return s;
  });

  return ({ u, t, seg, voiceAt }) => {
    pan.pose({ phi: t * 0.6, cone: 1, band: 0.9 });
    model.rotation.y = t * 0.08;
    const voiceEnd = voiceAt + seg.dur;
    words.forEach((s, i) => {
      const a = (i / 4) * Math.PI * 2 + t * 0.15;
      // "prison" with the first words, the others as the voice lists them at the end
      const appear = i === 0 ? voiceAt + 1 : voiceEnd - 3.2 + (i - 1) * 0.9;
      s.position.set(Math.cos(a) * 4.6, 2.2 + 0.25 * Math.sin(t + i), Math.sin(a) * 4.6);
      s.material.opacity = smooth(appear, appear + 0.5, u);
    });
    camera.position.set(9 - u * 0.1, 6, 6);
    camera.lookAt(-2.4, 1, 0);
    background.setHex(WARM_BG);
    fog.color.setHex(WARM_BG);
    fog.density = 0.02;
    bloom.strength = 0.6;
  };
});
