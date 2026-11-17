/**
 * The engine: owns the renderer, the post-processing chain and the overlays,
 * and exposes `window.studio.renderAt(t)` so the recorder can draw any frame in any order.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { makePoints, starfield } from './helpers.js';
import { createRng, smooth } from './math.js';
import { Overlays } from './overlays.js';
import { OPAQUE, OWN_HEADLINE, Visuals } from './visuals.js';
import type {
  BootConfig,
  CapsuleDefinition,
  FrameInfo,
  Segment,
  SceneUpdate,
  StudioApi,
  WorldContext,
} from './types.js';

interface MountedScene {
  readonly group: THREE.Group;
  readonly update: SceneUpdate;
}

const CREDITS_ID = 'credits';

/** Identity helper giving type inference to a capsule's `scenes/index.ts`. */
export const defineCapsule = (capsule: CapsuleDefinition): CapsuleDefinition => capsule;

export async function boot(capsule: CapsuleDefinition, config: BootConfig): Promise<StudioApi> {
  const { timeline, layout, look } = config;
  const stage = document.getElementById('stage');
  const visualRoot = document.getElementById('visual');
  const ui = document.getElementById('ui');
  const fadeEl = document.getElementById('fade');
  if (!stage || !ui || !fadeEl || !visualRoot) throw new Error('page is missing #stage, #visual, #ui or #fade');

  await document.fonts.ready;
  await Promise.all((capsule.fonts ?? []).map((f) => document.fonts.load(f)));

  const pixelRatio = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    // anti-aliasing happens on the composer target (see below), not on the canvas
    antialias: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(layout.width, layout.height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const background = new THREE.Color(look.background);
  const fog = new THREE.FogExp2(look.background, look.fogDensity);
  scene.background = background;
  scene.fog = fog;
  // portrait: keep a 45° horizontal field of view (the 16:9 frame's vertical one), so a scene
  // framed for 16:9 shows its centre with room above and below instead of a narrow slice
  const aspect = layout.width / layout.height;
  const portrait = aspect < 1;
  const fov = portrait ? (2 * Math.atan(Math.tan((45 * Math.PI) / 360) / aspect) * 180) / Math.PI : 45;
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 500);
  stage.classList.toggle('portrait', portrait);

  // MSAA on the composer's target: the canvas' own antialias flag does not apply when post-processing
  const target = new THREE.WebGLRenderTarget(layout.width * pixelRatio, layout.height * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: look.msaa,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(layout.width, layout.height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(layout.width, layout.height), look.bloom, 0.6, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const byId = new Map(timeline.segments.map((s) => [s.id, s]));
  const world: WorldContext = {
    scene,
    camera,
    renderer,
    bloom,
    fog,
    background,
    timeline,
    layout,
    portrait,
    segment(id) {
      const s = byId.get(id);
      if (!s) throw new Error(`unknown segment "${id}"`);
      return s;
    },
  };
  await capsule.setup?.(world);

  const mounted = new Map<string, MountedScene>();
  for (const def of capsule.scenes) {
    if (mounted.has(def.id)) throw new Error(`scene "${def.id}" is defined twice`);
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    mounted.set(def.id, { group, update: def.build({ ...world, group, rng: createRng(def.id) }) });
  }
  const visualDefs = config.visuals ?? {};
  const visuals = new Visuals(visualRoot, visualDefs, timeline);
  await visuals.ready();
  // behind a ready-made shot without its own scene: a slow drift through dust in the accent colour
  const needsBackdrop = timeline.segments.some((s) => {
    const v = visualDefs[s.id];
    return v && !OPAQUE(v) && !mounted.has(s.id);
  });
  const backdrop = needsBackdrop ? buildBackdrop(scene, camera, look.accent) : undefined;
  for (const s of timeline.segments) {
    if (s.id !== CREDITS_ID && !mounted.has(s.id) && !visuals.has(s.id))
      console.warn(`segment "${s.id}" has no scene: fallback camera drift`);
  }

  // default: the last segment, when it has a scene or a ready-made shot (the order of scenes/index.ts
  // may differ from the narration's: a short made from a capsule keeps every scene file)
  const lastSpoken = timeline.segments.findLast((s) => s.id !== CREDITS_ID);
  const creditsSceneId =
    capsule.creditsScene ??
    (lastSpoken && (mounted.has(lastSpoken.id) || visuals.has(lastSpoken.id))
      ? lastSpoken.id
      : capsule.scenes.findLast((d) => byId.has(d.id))?.id);
  const creditsSource = creditsSceneId ? byId.get(creditsSceneId) : undefined;
  const ownHeadline = new Set(
    Object.entries(visualDefs)
      .filter(([, v]) => OWN_HEADLINE.has(v.type))
      .map(([id]) => id),
  );
  const overlays = new Overlays(ui, fadeEl, timeline, config.meta, ownHeadline, config.subtitles);
  const lastSegment = timeline.segments.at(-1);
  if (!lastSegment) throw new Error('timeline has no segment');

  // segments are sorted and contiguous: remember the previous hit, frames are mostly sequential
  let cursor = 0;
  const findSegment = (t: number): Segment => {
    const segs = timeline.segments;
    const current = segs[cursor];
    if (current && t >= current.t0 && t < current.t1) return current;
    const i = segs.findIndex((s) => t >= s.t0 && t < s.t1);
    if (i < 0) return lastSegment;
    cursor = i;
    return segs[i] ?? lastSegment;
  };

  let visible: MountedScene | undefined;
  let shotOpacity = '1';
  const renderAt = (t: number): Promise<void> | undefined => {
    const seg = findSegment(t);
    const isCredits = seg.id === CREDITS_ID;
    const sceneId = isCredits ? creditsSceneId : seg.id;
    const active = sceneId ? mounted.get(sceneId) : undefined;
    if (active !== visible) {
      if (visible) visible.group.visible = false;
      if (active) active.group.visible = true;
      visible = active;
    }

    // restore the capsule's look: a scene may change any of it for its own frames
    bloom.strength = look.bloom;
    fog.density = look.fogDensity;
    fog.color.setHex(look.background);
    background.setHex(look.background);
    capsule.everyFrame?.(t);

    let u = t - seg.t0;
    let len = seg.t1 - seg.t0;
    let frameSeg = seg;
    if (isCredits && creditsSource) {
      // the credits continue the source scene where it stopped, as if its segment went on
      len = creditsSource.t1 - creditsSource.t0;
      u += len;
      frameSeg = creditsSource;
    }
    const frame: FrameInfo = {
      u,
      len,
      t,
      seg: frameSeg,
      voiceAt: frameSeg.voice === null ? 0 : frameSeg.voice - frameSeg.t0,
    };
    if (backdrop) backdrop.group.visible = !active && visuals.has(frameSeg.id);
    if (active) active.update(frame);
    else if (backdrop?.group.visible) backdrop.update(frame);
    else {
      camera.position.set(Math.sin(t * 0.05) * 3, 0, 12 - u * 0.3);
      camera.lookAt(0, 0, 0);
    }

    const pictures = visuals.update(frame);
    if (portrait) {
      // vertical credits fill the frame's width: the last segment's ready-made shot fades out under them
      const k = isCredits ? (1 - smooth(0, 0.6, t - seg.t0)).toFixed(3) : '1';
      if (k !== shotOpacity) visualRoot.style.opacity = shotOpacity = k;
    }
    overlays.update(t, seg);
    composer.render();
    return pictures;
  };

  const gpu = (): string => {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  };

  const api: StudioApi = { ready: true, duration: timeline.duration, renderAt, gpu };
  window.studio = api;

  const params = new URLSearchParams(location.search);
  if (!params.has('record')) {
    // previews: scale the fixed-size stage to fit the window (the recorder uses the exact size)
    const fit = (): void => {
      const s = Math.min(innerWidth / layout.width, innerHeight / layout.height);
      stage.style.transformOrigin = '0 0';
      stage.style.transform = `translate(${(innerWidth - layout.width * s) / 2}px, ${(innerHeight - layout.height * s) / 2}px) scale(${s})`;
    };
    window.addEventListener('resize', fit);
    fit();
  }
  if (params.has('embed')) {
    // embedded in the studio UI: the parent page owns the clock (it follows the soundtrack)
    // and posts the time to draw; the latest request wins, one draw per display frame
    let pending: number | null = 0;
    window.addEventListener('message', (e: MessageEvent<unknown>) => {
      const d = e.data as { studio?: unknown; t?: unknown } | null;
      if (e.origin === location.origin && d?.studio === 'seek' && typeof d.t === 'number') pending = d.t;
    });
    const loop = (): void => {
      if (pending !== null) void renderAt(Math.min(Math.max(pending, 0), timeline.duration))?.catch(console.error);
      pending = null;
      requestAnimationFrame(loop);
    };
    loop();
    window.parent.postMessage({ studio: 'ready', duration: timeline.duration, gpu: gpu() }, location.origin);
  } else if (!params.has('record')) {
    // standalone preview: play in real time, loop
    const start = performance.now();
    const loop = (): void => {
      void renderAt(((performance.now() - start) / 1000) % timeline.duration)?.catch(console.error);
      requestAnimationFrame(loop);
    };
    loop();
  }
  return api;
}

/** Dust drifting slowly in the accent colour: the default backdrop of ready-made shots. */
function buildBackdrop(scene: THREE.Scene, camera: THREE.PerspectiveCamera, accent: number): MountedScene {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const rng = createRng('studio:backdrop');
  group.add(makePoints(starfield(900, rng, 8, 40), accent, 0.12, 0.55));
  group.add(makePoints(starfield(1400, rng, 50, 140), 0xffffff, 0.35, 0.35));
  return {
    group,
    update: ({ u, len, seg }) => {
      // each segment drifts its own way (seeded by its id): the camera never stands still
      const a = createRng(seg.id)() * Math.PI * 2;
      const k = smooth(0, len + 6, u);
      group.rotation.set(0.15 * Math.sin(a), a + k * 0.35, 0);
      camera.position.set(0, 0, 12 - 6 * k);
      camera.lookAt(0, 0, 0);
    },
  };
}
