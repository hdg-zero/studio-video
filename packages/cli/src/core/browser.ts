/**
 * Headless Chromium launcher with GPU detection.
 *
 * Rendering cost is dominated by WebGL: SwiftShader emulates the GPU on the CPU (~1 frame/s at
 * 1080p with bloom), a real GPU is one to two orders of magnitude faster. `auto` probes the
 * hardware backends in order, keeps the first one whose WebGL renderer is not a software
 * rasterizer, and caches the answer per browser binary.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { USER_CACHE } from './home.js';
import { log } from './log.js';

export type GpuMode = 'auto' | 'gpu' | 'cpu';

export interface BrowserProfile {
  readonly name: string;
  readonly hardware: boolean;
  readonly args: readonly string[];
}

/** Flags that keep a headless page rendering at full speed and with stable colours. */
const COMMON_ARGS = [
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
];

/** Probed in this order; the first hardware profile that works wins. */
export const PROFILES: readonly BrowserProfile[] = [
  {
    name: 'angle-vulkan',
    hardware: true,
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan'],
  },
  { name: 'angle-gl', hardware: true, args: ['--use-gl=angle', '--use-angle=gl'] },
  { name: 'egl', hardware: true, args: ['--use-gl=egl'] },
  { name: 'swiftshader', hardware: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i;

function launchOptions(profile: BrowserProfile): LaunchOptions {
  const executablePath = process.env.CHROME_PATH;
  return {
    headless: true,
    // the full Chromium build ("new headless") has the GPU stack; the headless shell may not
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    args: [...COMMON_ARGS, ...profile.args],
    // the CLI turns Ctrl+C into an abort and closes its browsers itself, after the encoders
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
}

export async function launch(profile: BrowserProfile): Promise<Browser> {
  try {
    return await chromium.launch(launchOptions(profile));
  } catch (err) {
    const msg = (err as Error).message;
    if (/Executable doesn't exist|browserType.launch/.test(msg) && !process.env.CHROME_PATH) {
      throw new Error(
        `Chromium is not installed for Playwright. Run \`npx playwright install chromium\`, or set CHROME_PATH to a Chromium/Chrome binary.\n${msg.split('\n')[0]}`,
        { cause: err },
      );
    }
    throw err;
  }
}

/** Opens a WebGL context in the profile and returns its renderer string (or `null` if it fails). */
export async function probeProfile(profile: BrowserProfile): Promise<string | null> {
  let browser: Browser | undefined;
  try {
    browser = await launch(profile);
    const page = await browser.newPage();
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
  } catch (err) {
    log.debug(`probe ${profile.name}: ${(err as Error).message.split('\n')[0]}`);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

interface ProbeCache {
  readonly key: string;
  readonly profile: string;
  readonly renderer: string;
}

async function binaryKey(): Promise<string> {
  const exe = process.env.CHROME_PATH ?? chromium.executablePath();
  const st = existsSync(exe) ? await stat(exe) : undefined;
  return `${exe}:${st?.mtimeMs ?? 0}`;
}

export interface SelectedProfile {
  readonly profile: BrowserProfile;
  readonly renderer: string;
}

/** Picks the browser profile for a GPU mode; `auto`/`gpu` results are cached in ~/.cache/studio-video. */
export async function selectProfile(mode: GpuMode, { refresh = false } = {}): Promise<SelectedProfile> {
  const software = PROFILES.find((p) => !p.hardware) as BrowserProfile;
  if (mode === 'cpu') return { profile: software, renderer: (await probeProfile(software)) ?? 'unknown' };

  const cacheFile = path.join(USER_CACHE, 'gpu.json');
  const key = await binaryKey();
  if (!refresh && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as ProbeCache;
      const profile = PROFILES.find((p) => p.name === cached.profile);
      if (cached.key === key && profile && (profile.hardware || mode === 'auto')) {
        return { profile, renderer: cached.renderer };
      }
    } catch {
      // corrupted cache: probe again
    }
  }

  let chosen: SelectedProfile | undefined;
  for (const profile of PROFILES.filter((p) => p.hardware)) {
    const renderer = await probeProfile(profile);
    log.debug(`probe ${profile.name}: ${renderer ?? 'unavailable'}`);
    if (renderer && !SOFTWARE_RENDERER.test(renderer)) {
      chosen = { profile, renderer };
      break;
    }
  }
  if (!chosen) {
    if (mode === 'gpu') throw new Error('no hardware WebGL backend found (try `studio doctor`, or --gpu auto)');
    chosen = { profile: software, renderer: (await probeProfile(software)) ?? 'unknown' };
  }
  await mkdir(USER_CACHE, { recursive: true });
  await writeFile(
    cacheFile,
    JSON.stringify({ key, profile: chosen.profile.name, renderer: chosen.renderer } satisfies ProbeCache),
  );
  return chosen;
}
