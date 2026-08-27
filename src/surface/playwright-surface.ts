import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Frame, type FrameLocator, type Locator, type Page } from "playwright";
import type { LocatorBundle, LocatorCandidate } from "../contracts.js";
import { redactText } from "../redaction.js";
import type { ObservedControl, Surface, SurfaceActionResult, SurfaceCommand, SurfaceObservation } from "./types.js";
import { SurfaceTargetError } from "./types.js";

type LocatorRoot = Page | FrameLocator;

interface PlaywrightSurfaceOptions {
  readonly headless?: boolean;
  readonly browser?: Browser;
  readonly context?: BrowserContext;
  readonly page?: Page;
}

interface BrowserResources {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly ownsBrowser: boolean;
}

const candidateDescription = (candidate: LocatorCandidate): string => {
  switch (candidate.strategy) {
    case "role": return `role=${candidate.role} name=${candidate.name ?? "*"}`;
    case "label": return `label=${candidate.text}`;
    case "text": return `text=${candidate.text}`;
    case "css": return `css=${candidate.selector}`;
    case "coordinate": return `coordinate=${candidate.x},${candidate.y}`;
  }
};

const locatorFor = (root: LocatorRoot, candidate: Exclude<LocatorCandidate, { readonly strategy: "coordinate" }>): Locator => {
  switch (candidate.strategy) {
    case "role":
      return root.getByRole(candidate.role as Parameters<LocatorRoot["getByRole"]>[0], {
        ...(candidate.name === undefined ? {} : { name: candidate.name }),
        ...(candidate.exact === undefined ? {} : { exact: candidate.exact }),
      });
    case "label": return root.getByLabel(candidate.text, { exact: candidate.exact ?? false });
    case "text": return root.getByText(candidate.text, { exact: candidate.exact ?? false });
    case "css": return root.locator(candidate.selector);
  }
};

export class PlaywrightSurface implements Surface {
  public readonly sessionId = randomUUID();
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #ownsBrowser: boolean;

  private constructor(resources: BrowserResources) {
    this.#browser = resources.browser;
    this.#context = resources.context;
    this.#page = resources.page;
    this.#ownsBrowser = resources.ownsBrowser;
  }

  public static async create(options: PlaywrightSurfaceOptions = {}): Promise<PlaywrightSurface> {
    if (options.page !== undefined && options.context !== undefined && options.browser !== undefined) {
      return new PlaywrightSurface({ browser: options.browser, context: options.context, page: options.page, ownsBrowser: false });
    }
    const browser = options.browser ?? await chromium.launch({ headless: options.headless ?? true });
    const context = options.context ?? await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = options.page ?? await context.newPage();
    return new PlaywrightSurface({ browser, context, page, ownsBrowser: options.browser === undefined });
  }

  public async observe(options: { readonly screenshotPath?: string } = {}): Promise<SurfaceObservation> {
    await this.#page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const controls: ObservedControl[] = [];
    const texts: string[] = [];
    for (const frame of this.#page.frames()) {
      const frameName = frame === this.#page.mainFrame() ? "main" : (await frame.title().catch(() => "iframe")) || "iframe";
      const frameSnapshot = await frame.locator("body").evaluate(body => {
        const candidates: Array<{ role: string; name: string; value?: string; disabled: boolean }> = [];
        for (const element of body.querySelectorAll("button,input,select,textarea,a,[role]")) {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) continue;
          const input = element as HTMLInputElement;
          const labelledBy = element.getAttribute("aria-labelledby");
          const label = input.labels?.[0]?.textContent;
          const name = element.getAttribute("aria-label") ??
            (labelledBy === null ? null : document.getElementById(labelledBy)?.textContent) ??
            label ?? element.textContent ?? input.placeholder ?? "";
          const role = element.getAttribute("role") ?? ({
            BUTTON: "button", INPUT: "textbox", SELECT: "combobox", TEXTAREA: "textbox", A: "link",
          } as Record<string, string>)[element.tagName] ?? element.tagName.toLowerCase();
          candidates.push({
            role,
            name: name.replace(/\s+/g, " ").trim().slice(0, 160),
            ...(element instanceof HTMLInputElement ? { value: element.value.slice(0, 160) } : {}),
            disabled: (element as HTMLInputElement).disabled === true,
          });
          if (candidates.length >= 80) break;
        }
        return { text: ((body as HTMLElement).innerText ?? body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 4000), candidates };
      }).catch((error: unknown) => ({ text: `[frame observation failed: ${error instanceof Error ? error.message : String(error)}]`, candidates: [] }));
      texts.push(`[${frameName}] ${frameSnapshot.text}`);
      controls.push(...frameSnapshot.candidates.map(control => ({
        frame: frameName,
        role: control.role,
        name: redactText(control.name),
        ...(control.value === undefined || control.value === "" ? {} : { value: "[REDACTED:input]" }),
        disabled: control.disabled,
      })));
    }
    const title = await this.#page.title();
    const text = redactText(texts.join("\n")).slice(0, 10_000);
    const url = this.#page.url();
    const applicationFingerprint = createHash("sha256").update(JSON.stringify({ title, controls: controls.map(control => ({ frame: control.frame, role: control.role, name: control.name })) })).digest("hex").slice(0, 24);
    const fingerprint = createHash("sha256").update(JSON.stringify({ url, title, text, controls })).digest("hex").slice(0, 24);
    if (options.screenshotPath !== undefined) {
      await mkdir(dirname(options.screenshotPath), { recursive: true });
      await this.#captureRedactedScreenshot(options.screenshotPath);
    }
    return { url, title, text, controls, applicationFingerprint, fingerprint, ...(options.screenshotPath === undefined ? {} : { screenshotPath: options.screenshotPath }) };
  }

  public async act(command: SurfaceCommand): Promise<SurfaceActionResult> {
    if (command.type === "navigate") {
      await this.#page.goto(command.url, { waitUntil: "domcontentloaded", timeout: command.timeoutMs });
      return { observedUrl: this.#page.url() };
    }
    if (command.type === "wait") {
      await this.#page.waitForTimeout(Math.min(command.durationMs, command.timeoutMs));
      return { observedUrl: this.#page.url() };
    }
    const resolved = await this.#resolve(command.target, command.timeoutMs);
    if (command.type === "click") await resolved.locator.click({ timeout: command.timeoutMs });
    if (command.type === "type") await resolved.locator.fill(command.value, { timeout: command.timeoutMs });
    if (command.type === "read") {
      const value = await this.#readResolved(resolved.locator);
      return { observedUrl: this.#page.url(), readValue: redactText(value), locatorStrategy: resolved.strategy };
    }
    return { observedUrl: this.#page.url(), locatorStrategy: resolved.strategy };
  }

  public async isVisible(locator: LocatorBundle, timeoutMs: number): Promise<boolean> {
    try {
      const resolved = await this.#resolve(locator, timeoutMs);
      return await resolved.locator.isVisible();
    } catch (error) {
      if (error instanceof SurfaceTargetError) return false;
      throw error;
    }
  }

  public async read(locator: LocatorBundle, timeoutMs: number): Promise<string> {
    const resolved = await this.#resolve(locator, timeoutMs);
    return redactText(await this.#readResolved(resolved.locator));
  }

  public async captureFailure(screenshotPath: string, htmlPath: string): Promise<void> {
    await Promise.all([mkdir(dirname(screenshotPath), { recursive: true }), mkdir(dirname(htmlPath), { recursive: true })]);
    const frameHtml = await Promise.all(this.#page.frames().map(async frame => {
      const html = await frame.content().catch(() => "<p>Frame snapshot unavailable</p>");
      const sanitized = redactText(html)
        .replace(/(<(?:input|textarea)\b[^>]*\bvalue=)["'][^"']*["']/gi, "$1\"[REDACTED:value]\"")
        .split("\n").map(line => line.trimEnd()).join("\n");
      return `<!-- frame ${redactText(frame.url())} -->\n${sanitized}`;
    }));
    await Promise.all([this.#captureRedactedScreenshot(screenshotPath), writeFile(htmlPath, frameHtml.join("\n"), "utf8")]);
  }

  public async close(): Promise<void> {
    if (this.#ownsBrowser) await this.#browser.close();
  }

  async #readResolved(locator: Locator): Promise<string> {
    if (await locator.evaluate(element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return locator.inputValue();
    }
    return (await locator.textContent())?.trim() ?? "";
  }

  async #captureRedactedScreenshot(path: string): Promise<void> {
    const frames = this.#page.frames();
    const values = await Promise.all(frames.map(frame => this.#maskFrameInputs(frame)));
    try {
      await this.#page.screenshot({ path, fullPage: true });
    } finally {
      await Promise.all(frames.map((frame, index) => frame.locator("input,textarea").evaluateAll((elements, captured) => {
        for (let controlIndex = 0; controlIndex < elements.length; controlIndex += 1) {
          const control = elements[controlIndex] as HTMLInputElement | HTMLTextAreaElement;
          control.value = captured[controlIndex] ?? "";
        }
      }, values[index] ?? []).catch(() => undefined)));
    }
  }

  async #maskFrameInputs(frame: Frame): Promise<readonly string[]> {
    return frame.locator("input,textarea").evaluateAll(elements => {
      const captured: string[] = [];
      for (const element of elements) {
        const control = element as HTMLInputElement | HTMLTextAreaElement;
        captured.push(control.value);
        if (control.value !== "") control.value = "[REDACTED]";
      }
      return captured;
    }).catch(() => []);
  }

  async #resolve(bundle: LocatorBundle, timeoutMs: number): Promise<{ readonly locator: Locator; readonly strategy: string }> {
    let root: LocatorRoot = this.#page;
    if ((bundle.framePath?.length ?? 0) > 0) {
      let matchedFrame: Locator | undefined;
      for (const frameCandidate of bundle.framePath ?? []) {
        if (frameCandidate.strategy === "coordinate") continue;
        const locator = locatorFor(this.#page, frameCandidate).first();
        if (await locator.isVisible({ timeout: Math.min(timeoutMs, 300) }).catch(() => false)) {
          matchedFrame = locator;
          break;
        }
      }
      if (matchedFrame === undefined) throw new SurfaceTargetError("No frame locator candidate matched", bundle);
      root = matchedFrame.contentFrame();
    }
    const perCandidateTimeout = Math.max(100, Math.floor(timeoutMs / Math.max(1, bundle.candidates.length)));
    for (const candidate of bundle.candidates) {
      if (candidate.strategy === "coordinate") continue;
      const locator = locatorFor(root, candidate).first();
      if (await locator.isVisible({ timeout: perCandidateTimeout }).catch(() => false)) {
        return { locator, strategy: candidateDescription(candidate) };
      }
    }
    throw new SurfaceTargetError(`No locator candidate matched: ${bundle.candidates.map(candidateDescription).join("; ")}`, bundle);
  }
}
