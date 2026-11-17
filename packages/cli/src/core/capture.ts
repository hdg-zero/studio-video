/**
 * Frame capture for one worker: one page, driven through the Chrome DevTools Protocol.
 *
 * Talking CDP directly (Runtime.evaluate + Page.captureScreenshot with optimizeForSpeed)
 * avoids Playwright's per-call element lookup, scrolling and stability checks, which matter
 * when a call is made for each of thousands of frames.
 */
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';

export type ImageFormat = 'jpeg' | 'png';

export interface CaptureOptions {
  readonly url: string;
  readonly layout: { readonly width: number; readonly height: number };
  readonly pixelRatio: number;
  readonly format: ImageFormat;
  /** JPEG quality (ignored for PNG). */
  readonly quality: number;
}

export class FrameCapturer {
  /** Page errors collected since the last {@link takeErrors}. */
  private errors: string[] = [];

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly opts: CaptureOptions,
  ) {}

  static async open(browser: Browser, opts: CaptureOptions): Promise<FrameCapturer> {
    const context = await browser.newContext({ viewport: opts.layout, deviceScaleFactor: opts.pixelRatio });
    const page = await context.newPage();
    const capturer = new FrameCapturer(context, page, await context.newCDPSession(page), opts);
    page.on('pageerror', (e) => capturer.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') capturer.errors.push(m.text());
    });
    await page.goto(`${opts.url}?record`);
    await page.waitForFunction(() => window.studio?.ready === true || '__STUDIO_ERROR__' in window, null, {
      timeout: 120_000,
    });
    const bootError = await page.evaluate(() => (window as { __STUDIO_ERROR__?: string }).__STUDIO_ERROR__);
    if (bootError) throw new Error(`the capsule failed to start:\n${bootError}`);
    return capturer;
  }

  /** WebGL renderer string reported by the page (tells GPU from SwiftShader). */
  gpu(): Promise<string> {
    return this.page.evaluate(() => window.studio?.gpu() ?? 'unknown');
  }

  /** Renders time `t` (seconds) and returns the encoded image. */
  async frame(t: number): Promise<Buffer> {
    const r = await this.cdp.send('Runtime.evaluate', {
      // a promise when pictures must be decoded first (ready-made shots)
      expression: `window.studio.renderAt(${t})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`renderAt(${t}) threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    const shot = await this.cdp.send('Page.captureScreenshot', {
      format: this.opts.format,
      ...(this.opts.format === 'jpeg' ? { quality: this.opts.quality } : {}),
      // raw CDP captures CSS pixels: the clip scale asks for device pixels (layout × pixelRatio)
      clip: { x: 0, y: 0, ...this.opts.layout, scale: this.opts.pixelRatio },
      optimizeForSpeed: true,
      captureBeyondViewport: false,
    });
    return Buffer.from(shot.data, 'base64');
  }

  takeErrors(): string[] {
    const e = this.errors;
    this.errors = [];
    return e;
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}
