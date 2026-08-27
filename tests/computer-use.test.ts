import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ReplayResult } from "../src/contracts.js";
import { offlineDiscoveryDecisions, runOfflineDemo } from "../src/cli.js";
import { startDemoServer } from "../src/demo/server.js";
import { runDiscovery } from "../src/discovery.js";
import { EvidenceRecorder } from "../src/evidence.js";
import { HandoffController } from "../src/handoff.js";
import { ScriptedDiscoveryModel, type AgentDecision, type DiscoveryModel } from "../src/model.js";
import { createDefaultPolicy, PolicyEngine } from "../src/policy.js";
import { PlaywrightSurface } from "../src/surface/playwright-surface.js";

const collectFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return nested.flat();
};

test("offline vertical slice discovers, replays, handles outcomes, hands off, and captures failure evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-evidence-"));
  try {
    const result = await runOfflineDemo(root);
    const replaySuccess = result.replaySuccess as ReplayResult;
    const replayNotFound = result.replayNotFound as ReplayResult;
    const replayHandoff = result.replayHandoff as ReplayResult;
    const replayFailure = result.replayFailure as ReplayResult;
    const replayInterstitial = result.replayInterstitial as ReplayResult;
    const replayExpired = result.replayExpired as ReplayResult;
    const replayValidation = result.replayValidation as ReplayResult;
    const replayRetryExhausted = result.replayRetryExhausted as ReplayResult;
    const replayMissingLocator = result.replayMissingLocator as ReplayResult;
    const replayDriftMismatch = result.replayDriftMismatch as ReplayResult;
    const replayRiskDenied = result.replayRiskDenied as ReplayResult;
    const replayRiskApproved = result.replayRiskApproved as ReplayResult;

    assert.equal(replaySuccess.kind, "success");
    if (replaySuccess.kind === "success") {
      assert.equal(replaySuccess.outputs.savingsBalance, "$1,284.44");
    }
    assert.equal(replayNotFound.kind, "business_outcome");
    if (replayNotFound.kind === "business_outcome") assert.equal(replayNotFound.outcome, "member_not_found");
    assert.equal(replayHandoff.kind, "success");
    assert.equal(replayInterstitial.kind, "success");
    if (replayInterstitial.kind === "success") assert.ok(replayInterstitial.recoveriesApplied.includes("known-interstitial"));
    assert.equal(replayExpired.kind, "failure");
    if (replayExpired.kind === "failure") assert.equal(replayExpired.failure.category, "session_expired");
    assert.equal(replayValidation.kind, "failure");
    if (replayValidation.kind === "failure") assert.equal(replayValidation.failure.category, "invalid_invocation");
    assert.equal(replayRetryExhausted.kind, "failure");
    if (replayRetryExhausted.kind === "failure") assert.equal(replayRetryExhausted.failure.category, "retry_exhausted");
    assert.equal(replayMissingLocator.kind, "failure");
    if (replayMissingLocator.kind === "failure") assert.equal(replayMissingLocator.failure.category, "target_missing");
    assert.equal(replayDriftMismatch.kind, "failure");
    if (replayDriftMismatch.kind === "failure") assert.equal(replayDriftMismatch.failure.category, "checkpoint_mismatch");
    assert.equal(replayRiskDenied.kind, "failure");
    if (replayRiskDenied.kind === "failure") assert.equal(replayRiskDenied.failure.category, "policy_denied");
    assert.equal(replayRiskApproved.kind, "success");
    assert.equal(replayFailure.kind, "failure");
    if (replayFailure.kind === "failure") {
      assert.equal(replayFailure.failure.category, "permission_denied");
      assert.ok(replayFailure.evidence.screenshotPath);
      assert.ok(replayFailure.evidence.htmlSnapshotPath);
      await stat(join(process.cwd(), replayFailure.evidence.screenshotPath));
      await stat(join(process.cwd(), replayFailure.evidence.htmlSnapshotPath));
    }

    const files = await collectFiles(root);
    assert.ok(files.some(path => path.endsWith("example-capability.json")));
    assert.ok(files.some(path => path.endsWith(".png")));
    assert.ok(files.some(path => path.endsWith(".sanitized.html")));
    const textArtifacts = files.filter(path => /\.(?:json|jsonl|html)$/.test(path));
    const content = (await Promise.all(textArtifacts.map(path => readFile(path, "utf8")))).join("\n");
    assert.doesNotMatch(content, /sk-(?:proj-)?[A-Za-z0-9_-]{12,}/);
    assert.doesNotMatch(content, /"memberId"\s*:\s*"12345"/);
    assert.doesNotMatch(content, /"value"\s*:\s*"12345"/);
    assert.match(content, /control_claimed/);
    assert.match(content, /control_returned/);
    assert.match(content, /"modelCalls":0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery converts model exceptions into a rich intervention in the same browser session", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-intervention-"));
  const server = await startDemoServer();
  const surface = await PlaywrightSurface.create({ headless: true });
  try {
    const model: DiscoveryModel = {
      modelId: "throwing-test-model",
      decide: async () => { throw new Error("synthetic invalid model target"); },
    };
    const targetUrl = `${server.baseUrl}/app`;
    const result = await runDiscovery({ goal: "Test structured escalation", targetUrl, inputs: { memberId: "12345" }, surface, model, policy: new PolicyEngine(createDefaultPolicy(server.baseUrl)), evidenceRoot: root, evidenceKind: "fixture" });
    assert.equal(result.kind, "stopped");
    if (result.kind === "stopped") {
      assert.match(result.reason, /^model_error:/);
      assert.equal(result.intervention?.reason, "unknown_runtime_state");
      assert.equal(result.intervention?.runId, result.runId);
      assert.equal(result.intervention?.screenshotPath?.endsWith("intervention.png"), true);
      if (result.intervention?.screenshotPath !== undefined) await stat(result.intervention.screenshotPath);
    }
  } finally {
    await surface.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("operator lease binds identity and policy-checks every mediated human action", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-lease-"));
  const server = await startDemoServer();
  const surface = await PlaywrightSurface.create({ headless: true });
  try {
    const runId = "handoff-identity-test";
    const recorder = new EvidenceRecorder(runId, surface.sessionId, "fixture", root, ["memberId"]);
    await recorder.initialize();
    const policy = new PolicyEngine(createDefaultPolicy(server.baseUrl));
    await surface.act({ type: "navigate", url: `${server.baseUrl}/app`, timeoutMs: 5_000 });
    const observation = await surface.observe();
    const controller = new HandoffController(surface, recorder, policy, runId);
    await controller.requestIntervention({ runId, goal: "Verify lease ownership", reason: "unknown_runtime_state", requestedBy: "replay", observationFingerprint: observation.fingerprint });
    await controller.claim("alice");
    await assert.rejects(controller.humanAct("bob", { type: "wait", durationMs: 1, timeoutMs: 10 }, "safe"), /does not own/);
    await assert.rejects(controller.resume("bob", "spoofed hand-back"), /does not own/);
    await assert.rejects(controller.humanAct("alice", { type: "navigate", url: "https://example.com/escape", timeoutMs: 1_000 }, "safe"), /origin_not_allowed/);
    await controller.humanAct("alice", { type: "wait", durationMs: 1, timeoutMs: 10 }, "safe");
    await controller.resume("alice", "Policy-checked wait only");
    assert.equal(controller.state, "automation");
  } finally {
    await surface.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery completes an artifact after explicit same-session human hand-back", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-discovery-handoff-"));
  const server = await startDemoServer();
  const surface = await PlaywrightSurface.create({ headless: true });
  try {
    const escalation: AgentDecision = { action: "escalate", risk: "safe", rationale: "Unknown host dialog needs a human", target: null, value: null, outputName: null, completionValue: null, reason: "unknown host dialog" };
    const scripted = [...offlineDiscoveryDecisions().slice(0, 4), escalation];
    const result = await runDiscovery({
      goal: "Look up the member and return savings balance",
      targetUrl: `${server.baseUrl}/app?scenario=unknown-dialog`,
      inputs: { memberId: "12345" },
      surface,
      model: new ScriptedDiscoveryModel(scripted),
      policy: new PolicyEngine(createDefaultPolicy(server.baseUrl)),
      evidenceRoot: root,
      evidenceKind: "fixture",
      humanOperator: async (_request, controller) => {
        await controller.claim("alice");
        await controller.humanAct("alice", { type: "click", target: { candidates: [{ strategy: "role", role: "button", name: "Resolve manually", exact: true }], framePath: [{ strategy: "role", role: "iframe", name: "Legacy member servicing workspace", exact: false }, { strategy: "css", selector: "iframe[name=\"legacyWorkspace\"]" }], robustnessNote: "Known operator-only resolution button." }, timeoutMs: 3_000 }, "safe");
        await controller.resume("alice", "Resolved the unknown host dialog");
      },
    });
    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.equal(result.outputs.savingsBalance, "$1,284.44");
      assert.equal(result.artifact.review.status, "draft");
    }
    const log = await readFile(result.logPath, "utf8");
    assert.match(log, /control_returned/);
    assert.match(log, /Goal completed after explicit human hand-back/);
  } finally {
    await surface.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
