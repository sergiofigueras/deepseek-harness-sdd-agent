import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { JsonValue } from "./contracts.js";
import { redactValue } from "./redaction.js";
import type { Surface } from "./surface/types.js";

export type EvidenceActor = "model" | "automation" | "human" | "policy" | "fixture";
export type EvidenceKind = "live" | "deterministic" | "fixture";

export interface EvidenceEventInput {
  readonly phase: "discovery" | "replay" | "handoff" | "policy";
  readonly actor: EvidenceActor;
  readonly type: string;
  readonly stepId?: string;
  readonly summary: string;
  readonly data?: unknown;
}

export interface FailureEvidencePaths {
  readonly screenshotPath: string;
  readonly htmlSnapshotPath: string;
}

export class EvidenceRecorder {
  readonly #directory: string;
  readonly #logPath: string;
  readonly #sensitiveFields: readonly string[];
  #sequence = 0;

  public constructor(
    public readonly runId: string,
    public readonly sessionId: string,
    public readonly kind: EvidenceKind,
    rootDirectory: string,
    sensitiveFields: readonly string[] = [],
  ) {
    this.#directory = join(rootDirectory, runId);
    this.#logPath = join(this.#directory, `${kind}-events.jsonl`);
    this.#sensitiveFields = sensitiveFields;
  }

  public get logPath(): string { return this.#logPath; }

  public async initialize(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
  }

  public async record(event: EvidenceEventInput): Promise<void> {
    this.#sequence += 1;
    const { data, summary, ...eventFields } = event;
    const payload = {
      schemaVersion: "1.0.0",
      sequence: this.#sequence,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sessionId: this.sessionId,
      evidenceKind: this.kind,
      ...eventFields,
      summary: redactValue(summary, { sensitiveFields: this.#sensitiveFields }),
      ...(data === undefined ? {} : { data: redactValue(data, { sensitiveFields: this.#sensitiveFields }) }),
    } satisfies Record<string, JsonValue>;
    await appendFile(this.#logPath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  public async captureFailure(surface: Surface, label: string): Promise<FailureEvidencePaths> {
    const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "_");
    const screenshotPath = join(this.#directory, `${safeLabel}.png`);
    const htmlSnapshotPath = join(this.#directory, `${safeLabel}.sanitized.html`);
    await surface.captureFailure(screenshotPath, htmlSnapshotPath);
    await this.record({
      phase: "replay",
      actor: "automation",
      type: "failure_evidence_captured",
      summary: "Captured screenshot and sanitized HTML snapshot",
      data: { screenshotPath: relative(process.cwd(), screenshotPath), htmlSnapshotPath: relative(process.cwd(), htmlSnapshotPath) },
    });
    return { screenshotPath, htmlSnapshotPath };
  }

  public async writeJson(filename: string, value: unknown): Promise<string> {
    const path = join(this.#directory, filename.replace(/[^A-Za-z0-9_.-]/g, "_"));
    await writeFile(path, `${JSON.stringify(redactValue(value, { sensitiveFields: this.#sensitiveFields }), null, 2)}\n`, "utf8");
    return path;
  }
}
