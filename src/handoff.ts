import { randomUUID } from "node:crypto";
import type { ActionRisk, ControlLease, HandoffState, InterventionRequest } from "./contracts.js";
import type { EvidenceRecorder } from "./evidence.js";
import type { PolicyEngine } from "./policy.js";
import type { Surface, SurfaceCommand } from "./surface/types.js";

export interface InterventionContext {
  readonly runId: string;
  readonly capabilityId?: string;
  readonly goal: string;
  readonly reason: InterventionRequest["reason"];
  readonly requestedBy: InterventionRequest["requestedBy"];
  readonly observationFingerprint: string;
  readonly screenshotPath?: string;
  readonly currentStepId?: string;
  readonly currentStepIndex?: number;
}

export class InvalidControlTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidControlTransitionError";
  }
}

export class HandoffController {
  readonly #surface: Surface;
  readonly #evidence: EvidenceRecorder;
  readonly #policy: PolicyEngine;
  #state: HandoffState = "automation";
  #lease: ControlLease;
  #request: InterventionRequest | undefined;
  #operatorId: string | undefined;

  public constructor(
    surface: Surface,
    evidence: EvidenceRecorder,
    policy: PolicyEngine,
    runId: string,
  ) {
    this.#surface = surface;
    this.#evidence = evidence;
    this.#policy = policy;
    this.#lease = { leaseId: randomUUID(), runId, owner: "automation", issuedAt: new Date().toISOString() };
  }

  public get state(): HandoffState { return this.#state; }
  public get lease(): ControlLease { return this.#lease; }
  public get sessionId(): string { return this.#surface.sessionId; }
  public get currentRequest(): InterventionRequest | undefined { return this.#request; }

  public async requestIntervention(context: InterventionContext): Promise<InterventionRequest> {
    if (this.#state !== "automation" || this.#lease.owner !== "automation") {
      throw new InvalidControlTransitionError("Only the automation owner can request intervention");
    }
    this.#state = "pending_human";
    this.#operatorId = undefined;
    this.#lease = { leaseId: randomUUID(), runId: context.runId, owner: "none", issuedAt: new Date().toISOString() };
    const request: InterventionRequest = {
      schemaVersion: "1.0.0",
      interventionId: randomUUID(),
      runId: context.runId,
      ...(context.capabilityId === undefined ? {} : { capabilityId: context.capabilityId }),
      goal: context.goal,
      reason: context.reason,
      state: "pending",
      ...(context.currentStepId === undefined ? {} : { currentStepId: context.currentStepId }),
      ...(context.currentStepIndex === undefined ? {} : { currentStepIndex: context.currentStepIndex }),
      observationFingerprint: context.observationFingerprint,
      ...(context.screenshotPath === undefined ? {} : { screenshotPath: context.screenshotPath }),
      allowedOperatorActions: ["click", "type", "read", "wait", "complete", "escalate"],
      requestedAt: new Date().toISOString(),
      requestedBy: context.requestedBy,
      lease: this.#lease,
    };
    this.#request = request;
    await this.#evidence.record({ phase: "handoff", actor: "automation", type: "intervention_requested", summary: context.reason, data: { interventionId: request.interventionId, sessionId: this.#surface.sessionId, fingerprint: context.observationFingerprint } });
    return request;
  }

  public async claim(operatorId: string): Promise<InterventionRequest> {
    if (operatorId.trim() === "") throw new InvalidControlTransitionError("Operator ID is required");
    if (this.#state !== "pending_human" || this.#request === undefined) {
      throw new InvalidControlTransitionError("No pending intervention can be claimed");
    }
    this.#state = "human";
    this.#operatorId = operatorId;
    this.#lease = { leaseId: randomUUID(), runId: this.#request.runId, owner: "human", issuedAt: new Date().toISOString() };
    this.#request = { ...this.#request, state: "claimed", lease: this.#lease };
    await this.#evidence.record({ phase: "handoff", actor: "human", type: "control_claimed", summary: "Human operator claimed the existing session", data: { operatorId, sessionId: this.#surface.sessionId, leaseId: this.#lease.leaseId } });
    return this.#request;
  }

  public async humanAct(operatorId: string, command: SurfaceCommand, risk: ActionRisk): Promise<void> {
    if (this.#state !== "human" || this.#lease.owner !== "human") {
      throw new InvalidControlTransitionError("Human actions require the human control lease");
    }
    if (operatorId !== this.#operatorId) throw new InvalidControlTransitionError("Operator identity does not own the human control lease");
    const before = await this.#surface.observe();
    const text = command.type === "type" ? command.value : undefined;
    const targetUrl = command.type === "navigate" ? command.url : before.url;
    const policy = this.#policy.authorize({ runId: this.#lease.runId, action: command.type, risk, targetUrl, ...(text === undefined ? {} : { text }) });
    await this.#evidence.record({ phase: "policy", actor: "policy", type: "human_action_policy_decision", summary: policy.reason, data: { operatorId, action: command.type, allowed: policy.allowed, code: policy.code } });
    if (!policy.allowed) throw new InvalidControlTransitionError(`Human action denied by policy: ${policy.code}`);
    await this.#surface.act(command);
    const after = await this.#surface.observe();
    const postActionPolicy = this.#policy.authorize({ runId: this.#lease.runId, action: command.type, risk, targetUrl: after.url, ...(text === undefined ? {} : { text }) });
    await this.#evidence.record({ phase: "policy", actor: "policy", type: "human_post_action_policy_decision", summary: postActionPolicy.reason, data: { operatorId, action: command.type, allowed: postActionPolicy.allowed, code: postActionPolicy.code, observedUrl: after.url } });
    if (!postActionPolicy.allowed) throw new InvalidControlTransitionError(`Human action left the allowed surface: ${postActionPolicy.code}`);
    await this.#evidence.record({ phase: "handoff", actor: "human", type: "human_action", summary: `Operator executed ${command.type}`, data: { operatorId, sessionId: this.#surface.sessionId, beforeFingerprint: before.fingerprint, afterFingerprint: after.fingerprint, action: command.type } });
  }

  public async resume(operatorId: string, actionSummary: string): Promise<InterventionRequest> {
    if (this.#state !== "human" || this.#request === undefined) {
      throw new InvalidControlTransitionError("Only the human owner can return control");
    }
    if (operatorId !== this.#operatorId) throw new InvalidControlTransitionError("Operator identity does not own the human control lease");
    const after = await this.#surface.observe();
    const resolved: InterventionRequest = {
      ...this.#request,
      state: "resolved",
      resolution: {
        resolvedAt: new Date().toISOString(),
        resolvedBy: operatorId,
        actionSummary,
        beforeFingerprint: this.#request.observationFingerprint,
        afterFingerprint: after.fingerprint,
        resumeAutomation: true,
      },
    };
    this.#state = "automation";
    this.#operatorId = undefined;
    this.#lease = { leaseId: randomUUID(), runId: resolved.runId, owner: "automation", issuedAt: new Date().toISOString() };
    this.#request = resolved;
    await this.#evidence.record({ phase: "handoff", actor: "human", type: "control_returned", summary: actionSummary, data: { operatorId, sessionId: this.#surface.sessionId, interventionId: resolved.interventionId, beforeFingerprint: resolved.resolution?.beforeFingerprint, afterFingerprint: resolved.resolution?.afterFingerprint } });
    return resolved;
  }

  public complete(): void {
    if (this.#state !== "automation") throw new InvalidControlTransitionError("A run can complete only under automation control");
    this.#state = "completed";
    this.#operatorId = undefined;
    this.#lease = { leaseId: randomUUID(), runId: this.#lease.runId, owner: "none", issuedAt: new Date().toISOString() };
  }
}

export type HumanOperator = (request: InterventionRequest, controller: HandoffController) => Promise<void>;
