import OpenAI from "openai";
import type { SurfaceObservation } from "./surface/types.js";

export type AgentAction = "navigate" | "click" | "type" | "read" | "wait" | "complete" | "escalate";

export interface AgentTarget {
  readonly frameName: string | null;
  readonly role: string | null;
  readonly name: string | null;
  readonly label: string | null;
  readonly text: string | null;
}

export interface AgentDecision {
  readonly action: AgentAction;
  readonly risk: "safe" | "risky" | "irreversible";
  readonly rationale: string;
  readonly target: AgentTarget | null;
  readonly value: string | null;
  readonly outputName: string | null;
  readonly completionValue: string | null;
  readonly reason: string | null;
}

export interface DiscoveryModelInput {
  readonly goal: string;
  readonly targetUrl: string;
  readonly step: number;
  readonly observation: SurfaceObservation;
  readonly priorActions: readonly string[];
}

export interface DiscoveryModel {
  readonly modelId: string;
  decide(input: DiscoveryModelInput): Promise<AgentDecision>;
}

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "risk", "rationale", "target", "value", "outputName", "completionValue", "reason"],
  properties: {
    action: { type: "string", enum: ["navigate", "click", "type", "read", "wait", "complete", "escalate"] },
    risk: { type: "string", enum: ["safe", "risky", "irreversible"] },
    rationale: { type: "string" },
    target: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["frameName", "role", "name", "label", "text"],
          properties: {
            frameName: { anyOf: [{ type: "string" }, { type: "null" }] },
            role: { anyOf: [{ type: "string" }, { type: "null" }] },
            name: { anyOf: [{ type: "string" }, { type: "null" }] },
            label: { anyOf: [{ type: "string" }, { type: "null" }] },
            text: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      ],
    },
    value: { anyOf: [{ type: "string" }, { type: "null" }] },
    outputName: { anyOf: [{ type: "string" }, { type: "null" }] },
    completionValue: { anyOf: [{ type: "string" }, { type: "null" }] },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const isDecision = (value: unknown): value is AgentDecision => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.action === "string" &&
    ["navigate", "click", "type", "read", "wait", "complete", "escalate"].includes(record.action) &&
    ["safe", "risky", "irreversible"].includes(String(record.risk)) &&
    typeof record.rationale === "string" &&
    (record.target === null || typeof record.target === "object");
};

const parseStructuredObject = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(text.slice(0, index + 1));
      }
    }
    throw new Error("Model response did not contain one complete structured object");
  }
};

export class OpenAIDiscoveryModel implements DiscoveryModel {
  readonly #client: OpenAI;

  public constructor(
    apiKey: string,
    public readonly modelId = "gpt-5.4-mini",
  ) {
    if (apiKey.trim() === "") throw new Error("OPENAI_API_KEY is required for live discovery");
    this.#client = new OpenAI({ apiKey });
  }

  public async decide(input: DiscoveryModelInput): Promise<AgentDecision> {
    const response = await this.#client.responses.create({
      model: this.modelId,
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "You operate a synthetic legacy member-servicing UI through semantic controls.",
        "Choose exactly one safe action that makes progress toward the goal.",
        "Classify the proposed action as safe, risky, or irreversible. Reading, search-form typing, and navigation within the target are safe; submitting mutations is risky; destructive commits are irreversible.",
        "Use only controls present in the observation. Prefer role/name or label targeting.",
        "Use navigate only when the current URL is not the target. Use complete only after the requested value is visible or was read.",
        "Never invent a value, bypass a warning, or interact outside the target origin. Escalate when uncertain.",
        "The runtime has a declared memberId input. For typing it, return value '$INPUT:memberId'; do not ask for or copy the raw identifier.",
      ].join(" "),
      input: JSON.stringify({
        goal: input.goal,
        targetUrl: input.targetUrl,
        step: input.step,
        currentUrl: input.observation.url,
        title: input.observation.title,
        visibleText: input.observation.text,
        controls: input.observation.controls,
        observationFingerprint: input.observation.fingerprint,
        availableInputPlaceholders: ["$INPUT:memberId"],
        priorActions: input.priorActions,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "computer_use_decision",
          strict: true,
          schema: decisionSchema,
        },
      },
    });
    const parsed = parseStructuredObject(response.output_text);
    if (!isDecision(parsed)) throw new Error("Model returned an invalid discovery decision");
    return parsed;
  }
}

export class ScriptedDiscoveryModel implements DiscoveryModel {
  #index = 0;
  readonly #decisions: readonly AgentDecision[];

  public constructor(
    decisions: readonly AgentDecision[],
    public readonly modelId = "scripted-fixture-model",
  ) {
    this.#decisions = decisions;
  }

  public async decide(): Promise<AgentDecision> {
    const decision = this.#decisions[this.#index];
    if (decision === undefined) throw new Error("Scripted discovery model exhausted its decisions");
    this.#index += 1;
    return decision;
  }
}
