// A slowly turning wireframe form; the subject stays in the right half, away from the headline
// (in a vertical video: centred, in the free space between the headline and the subtitles).
import * as THREE from 'three';
import { defineScene, smooth } from '@studio/runtime';

export default defineScene('idee', ({ group, camera, bloom, portrait }) => {
  const form = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3, 1),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, wireframe: true, transparent: true }),
  );
  if (portrait) form.position.y = 1;
  else form.position.x = 3;
  group.add(form);

  return ({ u, len, t, voiceAt }) => {
    form.rotation.set(t * 0.2, t * 0.3, 0);
    form.material.opacity = smooth(0, 1, u) * (1 - smooth(len - 0.6, len, u));
    form.scale.setScalar(0.8 + 0.2 * smooth(voiceAt, voiceAt + 2, u));
    camera.position.set(Math.sin(u * 0.05) * 14, 2, Math.cos(u * 0.05) * 14);
    camera.lookAt(0, 0, 0);
    bloom.strength = 0.8;
  };
});
