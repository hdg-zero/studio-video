/**
 * Three.js building blocks reused across capsules.
 * All of them are deterministic: randomness comes from an explicit `Rng`.
 */
import * as THREE from 'three';
import { clamp, type Rng } from './math.js';

let dotTextureCache: THREE.Texture | undefined;

/** Soft round sprite: makes points render as glowing discs instead of squares. */
export function dotTexture(): THREE.Texture {
  if (dotTextureCache) return dotTextureCache;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTextureCache = new THREE.CanvasTexture(canvas);
  return dotTextureCache;
}

/** Additive point material using {@link dotTexture}. */
export function pointsMaterial(color: THREE.ColorRepresentation, size: number, opacity = 1): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    color,
    size,
    map: dotTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Point cloud from a flat `[x, y, z, …]` array. */
export function makePoints(
  positions: Float32Array,
  color: THREE.ColorRepresentation,
  size: number,
  opacity = 1,
): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, pointsMaterial(color, size, opacity));
}

export interface TextSpriteOptions {
  color?: string;
  /** CSS font shorthand; the face must be loaded first (see `CapsuleDefinition.fonts`). */
  font?: string;
  /** World height of the sprite. */
  scale?: number;
}

/** A text label living in 3D space (years, names). Prefer DOM overlays for text the viewer reads. */
export function textSprite(
  text: string,
  { color = '#e8f1ff', font = '600 64px "Space Grotesk"', scale = 1 }: TextSpriteOptions = {},
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const h = 90;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, h / 2);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  sprite.scale.set((w / h) * scale, scale, 1);
  return sprite;
}

export interface SampleOptions {
  width?: number;
  height?: number;
  /** World size of the sampled area. */
  sizeX?: number;
  sizeY?: number;
  depth?: number;
}

/**
 * Point cloud of anything drawn on a 2D canvas (silhouette, glyph, logo, map).
 * Morph between two clouds by lerping their arrays.
 */
export function samplePoints(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  count: number,
  rng: Rng,
  { width = 256, height = 256, sizeX = 4, sizeY = 4, depth = 0.15 }: SampleOptions = {},
): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#fff';
  draw(ctx, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const out = new Float32Array(count * 3);
  let n = 0;
  for (let i = 0; i < count * 30 && n < count; i++) {
    const px = Math.floor(rng() * width);
    const py = Math.floor(rng() * height);
    if ((data[(py * width + px) * 4 + 3] ?? 0) > 128) {
      out.set([(px / width - 0.5) * sizeX, -(py / height - 0.5) * sizeY, (rng() - 0.5) * depth], n * 3);
      n++;
    }
  }
  return out;
}

/**
 * Line segments that can be drawn progressively.
 * Returns a function: call it with `k ∈ [0, 1]` to reveal that fraction of the segments.
 */
export function drawLines(
  parent: THREE.Object3D,
  segments: readonly number[],
  color: THREE.ColorRepresentation,
  opacity = 1,
): (k: number) => THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  parent.add(lines);
  const vertices = segments.length / 3;
  return (k) => {
    geometry.setDrawRange(0, Math.floor((vertices * clamp(k)) / 2) * 2);
    return lines;
  };
}

/** Appends a horizontal circle (as line segments) of radius `r` at height `y` to `out`. */
export function circleSegments(out: number[], r: number, y: number, n = 96, cx = 0, cz = 0): number[] {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, cx + Math.cos(b) * r, y, cz + Math.sin(b) * r);
  }
  return out;
}

/** Random points on a spherical shell, e.g. a background starfield. */
export function starfield(count: number, rng: Rng, minRadius = 60, maxRadius = 180): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = minRadius + rng() * (maxRadius - minRadius);
    const a = rng() * Math.PI * 2;
    const b = Math.acos(2 * rng() - 1);
    out.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
  }
  return out;
}
