import type { LocatorBundle } from "../contracts.js";

export interface ObservedControl {
  readonly frame: string;
  readonly role: string;
  readonly name: string;
  readonly value?: string;
  readonly disabled: boolean;
}

export interface SurfaceObservation {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly controls: readonly ObservedControl[];
  readonly applicationFingerprint: string;
  readonly fingerprint: string;
  readonly screenshotPath?: string;
}

export type SurfaceCommand =
  | { readonly type: "navigate"; readonly url: string; readonly timeoutMs: number }
  | { readonly type: "click"; readonly target: LocatorBundle; readonly timeoutMs: number }
  | { readonly type: "type"; readonly target: LocatorBundle; readonly value: string; readonly timeoutMs: number }
  | { readonly type: "read"; readonly target: LocatorBundle; readonly timeoutMs: number }
  | { readonly type: "wait"; readonly durationMs: number; readonly timeoutMs: number };

export interface SurfaceActionResult {
  readonly observedUrl: string;
  readonly readValue?: string;
  readonly locatorStrategy?: string;
}

export interface Surface {
  readonly sessionId: string;
  observe(options?: { readonly screenshotPath?: string }): Promise<SurfaceObservation>;
  act(command: SurfaceCommand): Promise<SurfaceActionResult>;
  isVisible(locator: LocatorBundle, timeoutMs: number): Promise<boolean>;
  read(locator: LocatorBundle, timeoutMs: number): Promise<string>;
  captureFailure(screenshotPath: string, htmlPath: string): Promise<void>;
  close(): Promise<void>;
}

export class SurfaceTargetError extends Error {
  public constructor(
    message: string,
    public readonly locator: LocatorBundle,
  ) {
    super(message);
    this.name = "SurfaceTargetError";
  }
}
