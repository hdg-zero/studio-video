/**
 * ffmpeg wrappers: per-chunk frame encoders and the final concat + audio mux.
 *
 * Chunks are independent MP4 files encoded with identical settings, so they can be
 * concatenated losslessly (`-c copy`) and reused from the cache across renders.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { ImageFormat } from './capture.js';
import { runOrThrow } from './util.js';

export type VideoCodec = 'x264' | 'vaapi' | 'nvenc';

export interface EncodeSettings {
  readonly codec: VideoCodec;
  readonly fps: number;
  /** Constant quality: CRF for x264, QP for VAAPI, CQ for NVENC. Lower is better. */
  readonly quality: number;
  /** x264 preset (ultrafast … veryslow). */
  readonly preset: string;
  /** ffmpeg threads per chunk encoder (several encoders run in parallel). */
  readonly threads: number;
  readonly input: ImageFormat;
  /** VAAPI render node. */
  readonly vaapiDevice?: string;
}

/** BT.709 tagging so players show the colours the browser rendered. */
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];

export function encoderArgs(s: EncodeSettings, output: string): string[] {
  const input = [
    '-f',
    'image2pipe',
    '-framerate',
    String(s.fps),
    '-c:v',
    s.input === 'jpeg' ? 'mjpeg' : 'png',
    '-i',
    '-',
  ];
  const head = ['-hide_banner', '-loglevel', 'error', '-y'];
  // prettier-ignore
  switch (s.codec) {
    case 'x264':
      return [
        ...head,
        ...input,
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'libx264', '-preset', s.preset, '-crf', String(s.quality), '-tune', 'film',
        '-threads', String(s.threads),
        ...BT709,
        output,
      ];
    case 'vaapi':
      return [
        ...head,
        '-vaapi_device', s.vaapiDevice ?? '/dev/dri/renderD128',
        ...input,
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=nv12,hwupload',
        '-c:v', 'h264_vaapi', '-qp', String(s.quality),
        ...BT709,
        output,
      ];
    case 'nvenc':
      return [
        ...head,
        ...input,
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(s.quality), '-b:v', '0',
        ...BT709,
        output,
      ];
  }
}

/** Streams encoded images into one ffmpeg process, honouring back-pressure. */
export class FrameEncoder {
  private readonly child: ChildProcess;
  private readonly done: Promise<void>;
  private stderr = '';

  constructor(args: readonly string[]) {
    this.child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child.stderr?.on('data', (d: Buffer) => (this.stderr += d.toString()));
    this.done = new Promise((resolve, reject) => {
      this.child.on('error', reject);
      this.child.on('close', (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code ?? signal}): ${this.stderr.trim()}`)),
      );
    });
    // surface early failures (bad codec…) instead of an EPIPE on the next write
    this.done.catch(() => undefined);
  }

  async write(image: Buffer): Promise<void> {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) await this.done;
    if (!stdin?.write(image)) {
      await new Promise<void>((resolve, reject) => {
        stdin?.once('drain', resolve);
        this.done.then(resolve, reject);
      });
    }
  }

  async finish(): Promise<void> {
    this.child.stdin?.end();
    await this.done;
  }

  abort(): void {
    this.child.kill('SIGKILL');
  }
}

/** A section of a soundtrack file. */
export interface AudioSlice {
  readonly file: string;
  readonly offset: number;
  readonly duration: number;
}

/** Joins chunks without re-encoding and muxes the soundtrack (AAC 192k) if there is one. */
export async function concatAndMux(listFile: string, audio: AudioSlice | null, output: string): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (audio) {
    if (audio.offset > 0) args.push('-ss', audio.offset.toFixed(3), '-t', audio.duration.toFixed(3));
    args.push(
      '-i',
      audio.file,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
    );
  } else args.push('-c:v', 'copy');
  args.push('-movflags', '+faststart', output);
  await runOrThrow('ffmpeg', args);
}

export interface ProbeInfo {
  readonly duration: number;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const out = await runOrThrow('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height:format=duration,size',
    '-of',
    'json',
    file,
  ]);
  const j = JSON.parse(out) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration: string; size: string };
  };
  const video = j.streams.find((s) => s.codec_type === 'video');
  return {
    duration: Number(j.format.duration),
    size: Number(j.format.size),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Lists the hardware encoders this ffmpeg build offers. */
export async function availableEncoders(): Promise<Set<VideoCodec>> {
  const out = await runOrThrow('ffmpeg', ['-hide_banner', '-encoders']);
  const set = new Set<VideoCodec>();
  if (/\blibx264\b/.test(out)) set.add('x264');
  if (/\bh264_vaapi\b/.test(out)) set.add('vaapi');
  if (/\bh264_nvenc\b/.test(out)) set.add('nvenc');
  return set;
}
