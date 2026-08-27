import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { ArtifactValidationError, resolveValueExpression, validateInvocationInputs, verifyCapabilityContentHash } from "./artifact.js";
import type { Assertion, CapabilityArtifact, CapabilityStep, JsonPrimitive, ReplayFailureCategory, ReplayResult, RiskApproval } from "./contracts.js";
import { EvidenceRecorder } from "./evidence.js";
import { HandoffController, type HumanOperator } from "./handoff.js";
import { PolicyEngine } from "./policy.js";
import type { Surface, SurfaceCommand, SurfaceObservation } from "./surface/types.js";
import { SurfaceTargetError } from "./surface/types.js";

export interface ReplayOptions {
  readonly runId?: string;
  readonly artifact: CapabilityArtifact;
  readonly inputs: unknown;
  readonly surface: Surface;
  readonly policy: PolicyEngine;
  readonly evidenceRoot: string;
  readonly approval?: RiskApproval;
  readonly humanOperator?: HumanOperator;
}

export const replayCapability = async (options: ReplayOptions): Promise<ReplayResult> => {
  const runId = options.runId ?? `replay-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const recorder = new EvidenceRecorder(runId, options.surface.sessionId, "deterministic", options.evidenceRoot, options.artifact.inputs.filter(input => input.sensitive).map(input => input.name));
  await recorder.initialize();
  const evidenceBase = { logPath: relative(process.cwd(), recorder.logPath) };
  let inputs: Readonly<Record<string, JsonPrimitive>>;
  try {
    if (!verifyCapabilityContentHash(options.artifact)) throw new ArtifactValidationError("Capability content hash does not match its contents.");
    if (options.artifact.review.status !== "approved") throw new ArtifactValidationError("Only approved capabilities may replay unattended.");
    inputs = validateInvocationInputs(options.artifact, options.inputs);
  } catch (error) {
    return failure("invalid_invocation", error instanceof Error ? error.message : "Invalid invocation", false);
  }

  const outputs: Record<string, JsonPrimitive> = {};
  const recoveriesApplied: string[] = [];
  const handoff = new HandoffController(options.surface, recorder, options.policy, runId);
  await recorder.record({ phase: "replay", actor: "automation", type: "run_started", summary: "Deterministic replay started", data: { capabilityId: options.artifact.id, capabilityVersion: options.artifact.version, capabilityContentHash: options.artifact.contentHash, provenanceRunId: options.artifact.provenance.evidenceRunId, inputNames: Object.keys(inputs), modelCalls: 0 } });

  for (let index = 0; index < options.artifact.steps.length; index += 1) {
    const step = options.artifact.steps[index];
    if (step === undefined) continue;
    const before = await options.surface.observe();
    if (step.action !== "navigate") {
      const classified = await classifyRuntimeState(before, step, index);
      if (classified !== undefined) return classified;
    }
    const command = commandForStep(step, inputs);
    const targetUrl = command.type === "navigate" ? command.url : before.url;
    const text = command.type === "type" ? command.value : undefined;
    const policy = options.policy.authorize({ runId, action: command.type, risk: step.risk, targetUrl, ...(text === undefined ? {} : { text }), ...(options.approval === undefined ? {} : { approval: options.approval }) });
    await recorder.record({ phase: "policy", actor: "policy", type: "policy_decision", stepId: step.id, summary: policy.reason, data: { allowed: policy.allowed, code: policy.code, action: command.type } });
    if (!policy.allowed) return failure("policy_denied", policy.reason, false, step, index, `allowed ${command.type}`, policy.code);

    try {
      const actionResult = await options.surface.act(command);
      const postActionPolicy = options.policy.authorize({ runId, action: command.type, risk: step.risk, targetUrl: actionResult.observedUrl, ...(text === undefined ? {} : { text }), ...(options.approval === undefined ? {} : { approval: options.approval }) });
      await recorder.record({ phase: "policy", actor: "policy", type: "post_action_policy_decision", stepId: step.id, summary: postActionPolicy.reason, data: { allowed: postActionPolicy.allowed, code: postActionPolicy.code, observedUrl: actionResult.observedUrl } });
      if (!postActionPolicy.allowed) return failure("policy_denied", postActionPolicy.reason, false, step, index, "allowlisted post-action URL", actionResult.observedUrl);
      if (step.action === "navigate") {
        const applicationObservation = await options.surface.observe();
        if (applicationObservation.applicationFingerprint !== options.artifact.application.driftFingerprint) {
          return failure("checkpoint_mismatch", "Application drift fingerprint does not match the approved artifact", false, step, index, options.artifact.application.driftFingerprint, applicationObservation.applicationFingerprint);
        }
      }
      if (command.type === "read" && step.outputName !== undefined && actionResult.readValue !== undefined) outputs[step.outputName] = actionResult.readValue;
      await recorder.record({ phase: "replay", actor: "automation", type: "step_completed", stepId: step.id, summary: step.description, data: { index, action: command.type, locatorStrategy: actionResult.locatorStrategy, observedUrl: actionResult.observedUrl } });
    } catch (error) {
      if (error instanceof SurfaceTargetError) return failure("target_missing", error.message, false, step, index, step.target?.robustnessNote, before.text.slice(0, 240));
      return failure("internal_error", error instanceof Error ? error.message : "Unknown replay error", false, step, index);
    }

    const recoveryFailure = await applyRecoveries(step, index);
    if (recoveryFailure !== undefined) return recoveryFailure;
    const after = await options.surface.observe();
    const afterClassification = await classifyRuntimeState(after, step, index);
    if (afterClassification !== undefined) return afterClassification;
    if (step.postcondition !== undefined && !(await evaluateAssertion(step.postcondition, after, outputs))) {
      return failure("checkpoint_mismatch", "Step postcondition did not match", false, step, index, JSON.stringify(step.postcondition), after.text.slice(0, 240));
    }
  }

  const finalObservation = await options.surface.observe();
  const finalClassification = await classifyRuntimeState(finalObservation);
  if (finalClassification !== undefined) return finalClassification;
  for (const output of options.artifact.outputs) {
    if (outputs[output.name] === undefined) {
      try {
        const raw = await options.surface.read(output.locator, 5_000);
        outputs[output.name] = parseOutput(raw, output.type);
      } catch (error) {
        return failure("target_missing", error instanceof Error ? error.message : `Output ${output.name} was not found`, false, undefined, undefined, output.locator.robustnessNote, finalObservation.text.slice(0, 240));
      }
    }
  }
  if (!(await evaluateAssertion(options.artifact.checkpoint, finalObservation, outputs))) {
    return failure("checkpoint_mismatch", "Capability checkpoint did not match", false, undefined, undefined, JSON.stringify(options.artifact.checkpoint), finalObservation.text.slice(0, 240));
  }
  handoff.complete();
  await recorder.record({ phase: "replay", actor: "automation", type: "run_completed", summary: "Deterministic replay completed without model decisions", data: { outputs, recoveriesApplied, modelCalls: 0, sessionId: options.surface.sessionId } });
  return { kind: "success", runId, capabilityId: options.artifact.id, startedAt, finishedAt: new Date().toISOString(), evidence: evidenceBase, outputs, recoveriesApplied };

  async function classifyRuntimeState(observation: SurfaceObservation, step?: CapabilityStep, index?: number): Promise<ReplayResult | undefined> {
    for (const outcome of options.artifact.businessOutcomes) {
      if (await evaluateAssertion(outcome.condition, observation, outputs)) {
        await recorder.record({ phase: "replay", actor: "automation", type: "business_outcome", ...(step === undefined ? {} : { stepId: step.id }), summary: outcome.description, data: { code: outcome.code } });
        return { kind: "business_outcome", runId, capabilityId: options.artifact.id, startedAt, finishedAt: new Date().toISOString(), evidence: evidenceBase, outcome: outcome.code, description: outcome.description, data: outcome.data ?? {} };
      }
    }
    if (/permission denied/i.test(observation.text)) return failure("permission_denied", "The application denied permission", false, step, index, "authorized member view", observation.text.slice(0, 240));
    if (/session expired/i.test(observation.text)) return failure("session_expired", "The application session expired", false, step, index, "active session", observation.text.slice(0, 240));
    if (/validation error/i.test(observation.text)) return failure("invalid_invocation", "The application rejected the supplied input", false, step, index, "valid application input", observation.text.slice(0, 240));
    if (/operator review required|unrecognized host response/i.test(observation.text)) {
      if (options.humanOperator === undefined) return failure("intervention_required", "An unknown dialog requires human review", false, step, index, "known runtime state", observation.text.slice(0, 240));
      const screenshotPath = join(options.evidenceRoot, runId, `intervention-${step?.id ?? "run"}.png`);
      const captured = await options.surface.observe({ screenshotPath }).catch(() => observation);
      const request = await handoff.requestIntervention({ runId, capabilityId: options.artifact.id, goal: options.artifact.description, reason: "unknown_runtime_state", requestedBy: "replay", observationFingerprint: captured.fingerprint, screenshotPath, ...(step === undefined ? {} : { currentStepId: step.id }), ...(index === undefined ? {} : { currentStepIndex: index }) });
      await options.humanOperator(request, handoff);
      if (handoff.state !== "automation") return failure("intervention_required", "Human operator did not return control", false, step, index);
      const resumed = await options.surface.observe();
      if (/operator review required|unrecognized host response/i.test(resumed.text)) return failure("intervention_required", "Human intervention did not resolve the unknown dialog", false, step, index);
    }
    return undefined;
  }

  async function applyRecoveries(step: CapabilityStep, stepIndex: number): Promise<ReplayResult | undefined> {
    for (const recoveryId of step.recoveryIds ?? []) {
      const recovery = options.artifact.recoveries.find(candidate => candidate.id === recoveryId);
      if (recovery === undefined) continue;
      if (recovery.condition === "known_interstitial" && recovery.action?.target !== undefined && await options.surface.isVisible(recovery.action.target, 150)) {
        const command = commandForStep(recovery.action, inputs);
        const before = await options.surface.observe();
        const policy = options.policy.authorize({ runId, action: command.type, risk: recovery.action.risk, targetUrl: before.url });
        await recorder.record({ phase: "policy", actor: "policy", type: "recovery_policy_decision", stepId: step.id, summary: policy.reason, data: { recoveryId, action: command.type, allowed: policy.allowed, code: policy.code } });
        if (!policy.allowed) return failure("policy_denied", policy.reason, false, step, stepIndex, "allowlisted recovery action", policy.code);
        const actionResult = await options.surface.act(command);
        const postPolicy = options.policy.authorize({ runId, action: command.type, risk: recovery.action.risk, targetUrl: actionResult.observedUrl });
        if (!postPolicy.allowed) return failure("policy_denied", postPolicy.reason, false, step, stepIndex, "allowlisted recovery result", actionResult.observedUrl);
        recoveriesApplied.push(recovery.id);
        await recorder.record({ phase: "replay", actor: "automation", type: "recovery_applied", stepId: step.id, summary: recovery.id, data: { condition: recovery.condition, attempt: 1 } });
      }
      if (recovery.condition === "transient_load") {
        for (let attempt = 1; attempt <= recovery.maxAttempts; attempt += 1) {
          const observation = await options.surface.observe();
          if (!/loading member record/i.test(observation.text)) break;
          const waitCommand = { type: "wait" as const, durationMs: recovery.backoffMs * attempt, timeoutMs: Math.max(1_000, recovery.backoffMs * attempt) };
          const policy = options.policy.authorize({ runId, action: "wait", risk: "safe", targetUrl: observation.url });
          if (!policy.allowed) return failure("policy_denied", policy.reason, false, step, stepIndex, "allowlisted recovery wait", policy.code);
          const actionResult = await options.surface.act(waitCommand);
          const postPolicy = options.policy.authorize({ runId, action: "wait", risk: "safe", targetUrl: actionResult.observedUrl });
          if (!postPolicy.allowed) return failure("policy_denied", postPolicy.reason, false, step, stepIndex, "allowlisted recovery result", actionResult.observedUrl);
          if (!recoveriesApplied.includes(recovery.id)) recoveriesApplied.push(recovery.id);
          await recorder.record({ phase: "replay", actor: "automation", type: "recovery_applied", stepId: step.id, summary: recovery.id, data: { condition: recovery.condition, attempt } });
        }
        const exhausted = await options.surface.observe();
        if (/loading member record/i.test(exhausted.text)) {
          return failure("retry_exhausted", `Recovery ${recovery.id} exhausted ${recovery.maxAttempts} attempts`, true, step, stepIndex, "loading state cleared", exhausted.text.slice(0, 240));
        }
      }
    }
    return undefined;
  }

  async function failure(category: ReplayFailureCategory, message: string, retryable: boolean, step?: CapabilityStep, stepIndex?: number, expected?: string, observed?: string): Promise<ReplayResult> {
    const rich = await recorder.captureFailure(options.surface, `${category}-${step?.id ?? "run"}`).catch(() => undefined);
    await recorder.record({ phase: "replay", actor: "automation", type: "run_failed", ...(step === undefined ? {} : { stepId: step.id }), summary: message, data: { category, retryable, ...(stepIndex === undefined ? {} : { stepIndex }), ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }) } });
    return { kind: "failure", runId, capabilityId: options.artifact.id, startedAt, finishedAt: new Date().toISOString(), evidence: { ...evidenceBase, ...(rich === undefined ? {} : { screenshotPath: relative(process.cwd(), rich.screenshotPath), htmlSnapshotPath: relative(process.cwd(), rich.htmlSnapshotPath) }) }, failure: { category, message, ...(step === undefined ? {} : { stepId: step.id }), ...(stepIndex === undefined ? {} : { stepIndex }), ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }), retryable } };
  }
};

const commandForStep = (step: CapabilityStep, inputs: Readonly<Record<string, JsonPrimitive>>): SurfaceCommand => {
  const value = step.value === undefined ? undefined : resolveValueExpression(step.value, inputs);
  switch (step.action) {
    case "navigate": {
      if (typeof value !== "string") throw new ArtifactValidationError(`Navigate step ${step.id} requires a string URL`);
      return { type: "navigate", url: value, timeoutMs: step.timeoutMs };
    }
    case "click": {
      if (step.target === undefined) throw new ArtifactValidationError(`Click step ${step.id} requires a target`);
      return { type: "click", target: step.target, timeoutMs: step.timeoutMs };
    }
    case "type": {
      if (step.target === undefined || typeof value !== "string") throw new ArtifactValidationError(`Type step ${step.id} requires a target and string value`);
      return { type: "type", target: step.target, value, timeoutMs: step.timeoutMs };
    }
    case "read": {
      if (step.target === undefined) throw new ArtifactValidationError(`Read step ${step.id} requires a target`);
      return { type: "read", target: step.target, timeoutMs: step.timeoutMs };
    }
    case "wait": return { type: "wait", durationMs: step.durationMs ?? 250, timeoutMs: step.timeoutMs };
  }
};

const evaluateAssertion = async (assertion: Assertion, observation: SurfaceObservation, outputs: Readonly<Record<string, JsonPrimitive>>): Promise<boolean> => {
  switch (assertion.kind) {
    case "url_matches": return new RegExp(assertion.pattern).test(observation.url);
    case "visible": return observation.text !== "" && assertion.locator.candidates.some(candidate => {
      if (candidate.strategy === "role") return candidate.name === undefined || observation.controls.some(control => control.role === candidate.role && control.name.toLowerCase().includes(candidate.name?.toLowerCase() ?? ""));
      if (candidate.strategy === "text") return observation.text.includes(candidate.text);
      return false;
    });
    case "text_matches": return new RegExp(assertion.pattern).test(observation.text);
    case "output_equals": return outputs[assertion.outputName] === (assertion.expected.source === "literal" ? assertion.expected.value : undefined);
  }
};

const parseOutput = (raw: string, type: "string" | "number" | "boolean"): JsonPrimitive => {
  if (type === "string") return raw;
  if (type === "number") {
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(parsed)) throw new Error(`Cannot parse numeric output: ${raw}`);
    return parsed;
  }
  if (/^(true|yes|1)$/i.test(raw)) return true;
  if (/^(false|no|0)$/i.test(raw)) return false;
  throw new Error(`Cannot parse boolean output: ${raw}`);
};
