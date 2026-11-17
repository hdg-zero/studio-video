// No walls anymore: screens everywhere feed a single eye.
import * as THREE from 'three';
import { defineScene, makePoints, smooth } from '@studio/runtime';
import { RED, vary } from './shared.js';

const SCREENS = 220;
const IRIS = 5000;
const FLOW = 4000;

export default defineScene('numerique', ({ group, camera, bloom, fog }) => {
  const d = new THREE.Object3D();
  const screenPos: THREE.Vector3[] = [];
  const screens = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.45, 0.8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    SCREENS,
  );
  for (let i = 0; i < SCREENS; i++) {
    const a = vary(i) * Math.PI * 2;
    const b = Math.acos(2 * vary(i + SCREENS) - 1);
    const r = 12 + vary(i + 2 * SCREENS) * 8;
    const p = new THREE.Vector3(r * Math.sin(b) * Math.cos(a), r * Math.cos(b) * 0.6, r * Math.sin(b) * Math.sin(a));
    screenPos.push(p);
    d.position.copy(p);
    d.lookAt(0, 0, 0);
    d.updateMatrix();
    screens.setMatrixAt(i, d.matrix);
    screens.setColorAt(i, new THREE.Color(0.16, 0.28, 0.5));
  }
  group.add(screens);

  // the eye: an iris of radial streaks around a dark pupil, and its rim
  const iris = new Float32Array(IRIS * 3);
  for (let i = 0; i < IRIS; i++) {
    const a = vary(i + 1000) * Math.PI * 2;
    const r = 1.1 + Math.pow(vary(i + 7000), 0.7) * 1.9;
    iris.set([Math.cos(a) * r, Math.sin(a) * r, (vary(i + 9000) - 0.5) * 0.2], i * 3);
  }
  const eye = makePoints(iris, RED, 0.07);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.0, 3.12, 96),
    new THREE.MeshBasicMaterial({ color: 0xffb0a0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  group.add(eye, ring);

  // data flowing from the screens into the eye
  const flow = makePoints(new Float32Array(FLOW * 3), 0x6f9fd0, 0.05, 0.6);
  group.add(flow);
  const flowAttr = flow.geometry.attributes.position as THREE.BufferAttribute;
  const fa = flowAttr.array as Float32Array;

  return ({ u, t, voiceAt }) => {
    const on = smooth(voiceAt + 1.5, voiceAt + 4, u);
    for (let i = 0; i < FLOW; i++) {
      const p = screenPos[i % SCREENS] as THREE.Vector3;
      const f = (vary(i + 11000) + t * (0.18 + vary(i + 13000) * 0.1)) % 1;
      const e = f * f;
      fa[i * 3] = p.x * (1 - e);
      fa[i * 3 + 1] = p.y * (1 - e) + Math.sin(f * 6 + i) * 0.15 * (1 - f);
      fa[i * 3 + 2] = p.z * (1 - e);
    }
    flowAttr.needsUpdate = true;
    flow.material.opacity = 0.55 * on;
    screens.scale.setScalar(0.2 + 0.8 * smooth(0, voiceAt + 3, u));
    eye.rotation.z = t * 0.05;
    const blink = 1 - Math.pow(Math.max(0, Math.sin(t * 0.9 - 1)), 60);
    eye.scale.set(1, blink, 1);
    ring.scale.set(1, blink, 1);
    const ang = u * 0.06;
    camera.position.set(Math.sin(ang) * 12, 1.5, Math.cos(ang) * 12);
    camera.lookAt(-4, 0.5, 0);
    eye.lookAt(camera.position);
    ring.lookAt(camera.position);
    bloom.strength = 0.55;
    fog.density = 0.02;
  };
});
