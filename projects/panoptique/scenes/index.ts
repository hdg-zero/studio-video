/**
 * Le panoptique: world setup (lights, starfield) and the ordered list of scenes.
 * One scene per narration segment, in `scenes/<segment id>.ts`.
 */
import * as THREE from 'three';
import { createRng, defineCapsule, makePoints, starfield } from '@studio/runtime';
import bentham from './bentham.js';
import discipline from './discipline.js';
import echec from './echec.js';
import foucault from './foucault.js';
import heritiers from './heritiers.js';
import interieur from './interieur.js';
import intro from './intro.js';
import numerique from './numerique.js';
import outro from './outro.js';
import plan from './plan.js';
import projet from './projet.js';
import regard from './regard.js';

let stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined;

export default defineCapsule({
  fonts: ['400 64px "Space Grotesk"', '500 64px "Space Grotesk"', '600 64px "Space Grotesk"'],
  setup({ scene }) {
    stars = makePoints(starfield(3000, createRng('stars')), 0x9fb8ff, 0.5, 0.7);
    stars.material.fog = false;
    scene.add(stars);
    scene.add(new THREE.AmbientLight(0x8090b0, 0.35));
    scene.add(new THREE.HemisphereLight(0x8090b0, 0x101218, 0.5));
    const moon = new THREE.DirectionalLight(0xb0c0e0, 1.5);
    moon.position.set(-20, 30, 15);
    scene.add(moon);
  },
  everyFrame(t) {
    if (stars) stars.rotation.y = t * 0.004;
  },
  scenes: [intro, bentham, plan, regard, interieur, projet, echec, heritiers, foucault, discipline, numerique, outro],
});
