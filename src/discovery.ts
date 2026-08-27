import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { compileCapabilityArtifact, type CapabilityArtifactDraft, type DiscoveredCapabilityStep } from "./artifact.js";
import type { CapabilityArtifact, InterventionRequest, JsonPrimitive, LocatorBundle } from "./contracts.js";
import { EvidenceRecorder } from "./evidence.js";
import { HandoffController, type HumanOperator } from "./handoff.js";
import type { AgentDecision, AgentTarget, DiscoveryModel } from "./model.js";
import { PolicyEngine } from "./policy.js";
import type { Surface, SurfaceCommand, SurfaceObservation } from "./surface/types.js";

export interface DiscoveryOptions {
  readonly goal: string;
  readonly targetUrl: string;
  readonly inputs: Readonly<{ memberId: string }>;
  readonly surface: Surface;
  readonly model: DiscoveryModel;
  readonly policy: PolicyEngine;
  readonly evidenceRoot: string;
  readonly maxSteps?: number;
  readonly timeoutMs?: number;
  readonly evidenceKind?: "live" | "fixture";
  readonly humanOperator?: HumanOperator;
}

export type DiscoveryResult =
  | { readonly kind: "success"; readonly runId: string; readonly artifact: CapabilityArtifact; readonly outputs: Readonly<Record<string, JsonPrimitive>>; readonly logPath: string }
  | { readonly kind: "stopped"; readonly runId: string; readonly reason: string; readonly observation: SurfaceObservation; readonly logPath: string; readonly intervention?: InterventionRequest };

interface ExecutedDecision {
  readonly decision: AgentDecision;
  readonly command: SurfaceCommand;
  readonly readValue?: string;
}

const locatorFromTarget = (target: AgentTarget): LocatorBundle => {
  const candidates: LocatorBundle["candidates"] = [
    ...(target.role === null ? [] : [{ strategy: "role" as const, role: target.role, ...(target.name === null ? {} : { name: target.name, exact: false }) }]),
    ...(target.label === null ? [] : [{ strategy: "label" as const, text: target.label, exact: false }]),
    ...(target.text === null ? [] : [{ strategy: "text" as const, text: target.text, exact: false }]),
  ];
  if (candidates.length === 0) throw new Error("A UI action requires at least one semantic target candidate");
  const inFrame = target.frameName !== null && target.frameName !== "main";
  return {
    candidates,
    ...(inFrame ? {
      framePath: [
        { strategy: "role" as const, role: "iframe", name: "Legacy member servicing workspace", exact: false },
        { strategy: "css" as const, selector: "iframe[name=\"legacyWorkspace\"]" },
      ],
    } : {}),
    robustnessNote: "Semantic role/name or label first; visible text fallback. Frame identity is independent of DOM nesting.",
  };
};

const targetRequired = (decision: AgentDecision): LocatorBundle => {
  if (decision.target === null) throw new Error(`${decision.action} requires a target`);
  return locatorFromTarget(decision.target);
};

const commandForDecision = (decision: AgentDecision, targetUrl: string, memberId: string): SurfaceCommand => {
  switch (decision.action) {
    case "navigate": return { type: "navigate", url: targetUrl, timeoutMs: 10_000 };
    case "click": return { type: "click", target: targetRequired(decision), timeoutMs: 5_000 };
    case "type": {
      const value = decision.value === "$INPUT:memberId" ? memberId : decision.value;
      if (value === null) throw new Error("type requires a value");
      return { type: "type", target: targetRequired(decision), value, timeoutMs: 5_000 };
    }
    case "read": return { type: "read", target: targetRequired(decision), timeoutMs: 5_000 };
    case "wait": return { type: "wait", durationMs: 300, timeoutMs: 1_000 };
    case "complete":
    case "escalate": throw new Error(`${decision.action} is a stopping decision, not a surface command`);
  }
};

export const runDiscovery = async (options: DiscoveryOptions): Promise<DiscoveryResult> => {
  const runId = `discovery-${randomUUID()}`;
  const recorder = new EvidenceRecorder(runId, options.surface.sessionId, options.evidenceKind ?? "live", options.evidenceRoot, ["memberId"]);
  await recorder.initialize();
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const maxSteps = options.maxSteps ?? 12;
  const priorActions: string[] = [];
  const executed: ExecutedDecision[] = [];
  const outputs: Record<string, JsonPrimitive> = {};
  const handoff = new HandoffController(options.surface, recorder, options.policy, runId);
  let previousFingerprint = "";
  let unchangedCount = 0;
  await recorder.record({ phase: "discovery", actor: options.evidenceKind === "fixture" ? "fixture" : "model", type: "run_started", summary: "Discovery run started", data: { goal: options.goal, targetUrl: options.targetUrl, model: options.model.modelId } });

  for (let step = 0; step < maxSteps; step += 1) {
    if (Date.now() >= deadline) return stop("timeout", await safeObserve());
    let observation: SurfaceObservation;
    try {
      const screenshotPath = step === 0 ? join(options.evidenceRoot, runId, "initial.png") : undefined;
      observation = await options.surface.observe(screenshotPath === undefined ? {} : { screenshotPath });
    } catch (error) {
      return stop(`observation_error:${messageOf(error)}`, await safeObserve());
    }
    unchangedCount = observation.fingerprint === previousFingerprint ? unchangedCount + 1 : 0;
    previousFingerprint = observation.fingerprint;
    if (unchangedCount >= 3) return stop("dead_end_repeated_observation", observation);

    await recorder.record({ phase: "discovery", actor: "automation", type: "observation", summary: `Observed ${observation.controls.length} controls`, data: { step, url: observation.url, fingerprint: observation.fingerprint, controls: observation.controls } });
    let decision: AgentDecision;
    try {
      decision = await options.model.decide({ goal: options.goal, targetUrl: options.targetUrl, step, observation, priorActions });
    } catch (error) {
      return stop(`model_error:${messageOf(error)}`, observation);
    }
    await recorder.record({ phase: "discovery", actor: options.evidenceKind === "fixture" ? "fixture" : "model", type: "decision", summary: decision.rationale, data: { step, action: decision.action, target: decision.target, outputName: decision.outputName, reason: decision.reason } });

    if (decision.action === "escalate") return stop(decision.reason ?? "model_escalated", observation);
    if (decision.action === "complete") {
      if (decision.outputName !== null && decision.completionValue !== null) outputs[decision.outputName] = decision.completionValue;
      if (!("savingsBalance" in outputs)) {
        const displayedBalance = observation.text.match(/Savings\s+(\$[0-9,]+\.[0-9]{2})/i)?.[1];
        if (displayedBalance !== undefined) outputs.savingsBalance = displayedBalance;
      }
      if (!("savingsBalance" in outputs)) return stop("completion_without_declared_output", observation);
      const successScreenshot = join(options.evidenceRoot, runId, "success.png");
      const completedObservation = await options.surface.observe({ screenshotPath: successScreenshot });
      const artifact = buildArtifact(options, runId, executed, completedObservation.applicationFingerprint);
      handoff.complete();
      await recorder.record({ phase: "discovery", actor: "automation", type: "run_completed", summary: "Goal completed and capability compiled", data: { artifactId: artifact.id, outputs } });
      return { kind: "success", runId, artifact, outputs, logPath: recorder.logPath };
    }

    let command: SurfaceCommand;
    try {
      command = commandForDecision(decision, options.targetUrl, options.inputs.memberId);
    } catch (error) {
      return stop(`invalid_model_action:${messageOf(error)}`, observation);
    }
    const targetUrl = command.type === "navigate" ? command.url : (observation.url === "about:blank" ? options.targetUrl : observation.url);
    const risk = decision.risk;
    const policy = options.policy.authorize({ runId, action: command.type, risk, targetUrl, ...(command.type === "type" ? { text: command.value } : {}) });
    await recorder.record({ phase: "policy", actor: "policy", type: "policy_decision", summary: policy.reason, data: { step, action: command.type, allowed: policy.allowed, code: policy.code } });
    if (!policy.allowed) return stop(`policy_denied:${policy.code}`, observation);

    let result;
    try {
      result = await options.surface.act(command);
    } catch (error) {
      return stop(`surface_action_error:${messageOf(error)}`, observation);
    }
    const postActionPolicy = options.policy.authorize({ runId, action: command.type, risk, targetUrl: result.observedUrl, ...(command.type === "type" ? { text: command.value } : {}) });
    await recorder.record({ phase: "policy", actor: "policy", type: "post_action_policy_decision", summary: postActionPolicy.reason, data: { step, action: command.type, allowed: postActionPolicy.allowed, code: postActionPolicy.code, observedUrl: result.observedUrl } });
    if (!postActionPolicy.allowed) return stop(`post_action_policy_denied:${postActionPolicy.code}`, await options.surface.observe());
    const executedDecision: ExecutedDecision = { decision, command, ...(result.readValue === undefined ? {} : { readValue: result.readValue }) };
    executed.push(executedDecision);
    if (decision.action === "read" && decision.outputName !== null && result.readValue !== undefined) outputs[decision.outputName] = result.readValue;
    priorActions.push(`${decision.action}:${decision.target?.name ?? decision.target?.label ?? decision.target?.text ?? ""}`);
    await recorder.record({ phase: "discovery", actor: "automation", type: "action_executed", summary: `Executed ${decision.action}`, data: { step, action: decision.action, locatorStrategy: result.locatorStrategy, observedUrl: result.observedUrl, ...(result.readValue === undefined ? {} : { readValue: result.readValue }) } });
  }
  return stop("max_steps", await safeObserve());

  async function stop(reason: string, observation: SurfaceObservation): Promise<DiscoveryResult> {
    const screenshotPath = join(options.evidenceRoot, runId, "intervention.png");
    const current = await options.surface.observe({ screenshotPath }).catch(() => observation);
    const interventionReason = reason.includes("policy_denied") ? "policy_denied" : reason === "timeout" || reason === "max_steps" || reason.includes("dead_end") ? "agent_stuck" : "unknown_runtime_state";
    const intervention = await handoff.requestIntervention({ runId, goal: options.goal, reason: interventionReason, requestedBy: reason.includes("policy_denied") ? "policy" : "discovery", observationFingerprint: current.fingerprint, screenshotPath });
    await recorder.record({ phase: "discovery", actor: "automation", type: "run_stopped", summary: reason, data: { fingerprint: current.fingerprint, interventionId: intervention.interventionId } });
    if (options.humanOperator !== undefined) {
      await options.humanOperator(intervention, handoff);
      if (handoff.state === "automation") {
        const resumedScreenshot = join(options.evidenceRoot, runId, "handoff-completed.png");
        const resumed = await options.surface.observe({ screenshotPath: resumedScreenshot });
        const displayedBalance = resumed.text.match(/Savings\s+(\$[0-9,]+\.[0-9]{2})/i)?.[1];
        if (displayedBalance !== undefined) {
          outputs.savingsBalance = displayedBalance;
          const artifact = buildArtifact(options, runId, executed, resumed.applicationFingerprint);
          handoff.complete();
          await recorder.record({ phase: "discovery", actor: "automation", type: "run_completed", summary: "Goal completed after explicit human hand-back", data: { artifactId: artifact.id, outputs, interventionId: intervention.interventionId } });
          return { kind: "success", runId, artifact, outputs, logPath: recorder.logPath };
        }
      }
    }
    return { kind: "stopped", runId, reason, observation: current, logPath: recorder.logPath, intervention: handoff.currentRequest ?? intervention };
  }

  async function safeObserve(): Promise<SurfaceObservation> {
    return options.surface.observe().catch(() => ({ url: "about:blank", title: "Unavailable", text: "Observation unavailable", controls: [], applicationFingerprint: "unavailable", fingerprint: "unavailable" }));
  }
};

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const buildArtifact = (options: DiscoveryOptions, runId: string, executed: readonly ExecutedDecision[], applicationFingerprint: string): CapabilityArtifact => {
  const steps: DiscoveredCapabilityStep[] = executed.map((entry, index) => {
    const base = { id: `step-${String(index + 1).padStart(2, "0")}`, risk: entry.decision.risk, description: entry.decision.rationale, timeoutMs: entry.command.timeoutMs };
    switch (entry.command.type) {
      case "navigate": return { ...base, action: "navigate", value: entry.command.url };
      case "click": return { ...base, action: "click", target: entry.command.target, recoveryIds: ["transient-load", "known-interstitial"] };
      case "type": return { ...base, action: "type", target: entry.command.target, value: entry.command.value };
      case "read": return { ...base, action: "read", target: entry.command.target, ...(entry.decision.outputName === null ? {} : { outputName: entry.decision.outputName }) };
      case "wait": return { ...base, action: "wait", durationMs: entry.command.durationMs };
    }
  });
  const framePath = [
    { strategy: "role" as const, role: "iframe", name: "Legacy member servicing workspace", exact: false },
    { strategy: "css" as const, selector: "iframe[name=\"legacyWorkspace\"]" },
  ];
  const draft: CapabilityArtifactDraft = {
    schemaVersion: "1.0.0",
    id: "northstar.lookup-savings-balance",
    version: "1.0.0",
    name: "Look up synthetic member savings balance",
    description: "Searches the Northstar member console and returns the displayed savings balance.",
    application: { vendor: "Northstar", product: "Core Banking Training Console", baseUrlPattern: new URL(options.targetUrl).origin, compatibleVersionRange: "demo-v1", driftFingerprint: applicationFingerprint },
    inputs: [
      { name: "targetUrl", type: "string", description: "Allowlisted entry URL", required: true, sensitive: false, pattern: "^https?://" },
      { name: "memberId", type: "string", description: "Synthetic member identifier", required: true, sensitive: true, pattern: "^[0-9]{5,12}$" },
    ],
    outputs: [{ name: "savingsBalance", type: "string", description: "Displayed synthetic savings balance", required: true, locator: { candidates: [{ strategy: "role", role: "generic", name: "Savings balance", exact: false }, { strategy: "css", selector: "[aria-label=\"Savings balance\"]" }], framePath, robustnessNote: "Accessible name first; attribute fallback within the stable workspace frame." }, extraction: "text" }],
    steps,
    checkpoint: { kind: "visible", locator: { candidates: [{ strategy: "role", role: "heading", name: "Member located", exact: false }, { strategy: "text", text: "Member located", exact: true }], framePath, robustnessNote: "Semantic heading with exact visible-text fallback." } },
    businessOutcomes: [{ code: "member_not_found", description: "No synthetic member matches the supplied identifier.", condition: { kind: "visible", locator: { candidates: [{ strategy: "role", role: "heading", name: "Record not found", exact: false }, { strategy: "text", text: "Record not found", exact: true }], framePath, robustnessNote: "Declared business message, not an exception." } }, data: { found: false } }],
    recoveries: [
      { id: "known-interstitial", condition: "known_interstitial", maxAttempts: 1, backoffMs: 50, action: { id: "recovery-continue", action: "click", risk: "safe", description: "Dismiss the known daily notice", target: { candidates: [{ strategy: "role", role: "button", name: "Continue", exact: true }], framePath, robustnessNote: "Known reversible interstitial control." }, timeoutMs: 2_000 } },
      { id: "transient-load", condition: "transient_load", maxAttempts: 3, backoffMs: 250 },
    ],
    declaredRisk: steps.reduce<"safe" | "risky" | "irreversible">((highest, step) => {
      const rank = { safe: 0, risky: 1, irreversible: 2 } as const;
      return rank[step.risk] > rank[highest] ? step.risk : highest;
    }, "safe"),
    provenance: { discoveredAt: new Date().toISOString(), model: options.model.modelId, sourceTarget: new URL(options.targetUrl).origin, evidenceRunId: runId },
    review: { status: "draft" },
  };
  return compileCapabilityArtifact(draft, [{ name: "targetUrl", value: options.targetUrl }, { name: "memberId", value: options.inputs.memberId }]);
};
