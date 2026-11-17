// A slow pull-back on a glowing sphere; replayed under the credits.
import * as THREE from 'three';
import { defineScene, lerp, smooth } from '@studio/runtime';

export default defineScene('outro', ({ group, camera }) => {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x223044, emissive: 0x7fe3ff, emissiveIntensity: 0.2 }),
  );
  group.add(sphere);
  return ({ u, len }) => {
    const k = smooth(0, len + 6, u);
    camera.position.set(0, lerp(1, 6, k), lerp(8, 24, k));
    camera.lookAt(0, 0, 0);
  };
});
