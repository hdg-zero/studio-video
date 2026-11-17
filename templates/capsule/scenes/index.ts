/**
 * World setup and ordered scenes of the capsule.
 * One scene per segment of capsule.json, in `scenes/<segment id>.ts` (the render cache tracks each file).
 */
import * as THREE from 'three';
import { createRng, defineCapsule, makePoints, starfield } from '@studio/runtime';
import idee from './idee.js';
import intro from './intro.js';
import outro from './outro.js';

let stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined;

export default defineCapsule({
  fonts: ['600 64px "Space Grotesk"'],
  setup({ scene }) {
    stars = makePoints(starfield(3000, createRng('stars')), 0x9fb8ff, 0.5, 0.7);
    stars.material.fog = false;
    scene.add(stars, new THREE.AmbientLight(0x8090b0, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-10, 20, 10);
    scene.add(key);
  },
  everyFrame(t) {
    if (stars) stars.rotation.y = t * 0.004;
  },
  scenes: [intro, idee, outro],
});
