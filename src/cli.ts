import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import type { CapabilityArtifact, LocatorBundle, RiskApproval, SurfaceActionType } from "./contracts.js";
import { approveCapabilityArtifact, computeCapabilityContentHash } from "./artifact.js";
import { startDemoServer, type RunningDemoServer } from "./demo/server.js";
import { runDiscovery, type DiscoveryResult } from "./discovery.js";
import { ScriptedDiscoveryModel, OpenAIDiscoveryModel, type AgentDecision } from "./model.js";
import { createDefaultPolicy, PolicyEngine } from "./policy.js";
import { replayCapability } from "./replay.js";
import { PlaywrightSurface } from "./surface/playwright-surface.js";
import type { HumanOperator } from "./handoff.js";

const valuesFor = (args: readonly string[]) => parseArgs({
  args,
  options: {
    goal: { type: "string", default: "Look up the member using the supplied memberId and return the current savings balance" },
    "member-id": { type: "string", default: "12345" },
    target: { type: "string" },
    artifact: { type: "string", default: "evidence/example-capability.json" },
    model: { type: "string", default: "gpt-5.4-mini" },
    reviewer: { type: "string" },
    headed: { type: "boolean", default: false },
    "interactive-handoff": { type: "boolean", default: false },
    "approve-risk": { type: "boolean", default: false },
    scenario: { type: "string", default: "success" },
    "evidence-root": { type: "string", default: "evidence" },
  },
  strict: true,
  allowPositionals: false,
}).values;

const iframe = "Member Inquiry";
const decision = (partial: Partial<AgentDecision> & Pick<AgentDecision, "action" | "rationale">): AgentDecision => ({
  action: partial.action,
  risk: partial.risk ?? "safe",
  rationale: partial.rationale,
  target: partial.target ?? null,
  value: partial.value ?? null,
  outputName: partial.outputName ?? null,
  completionValue: partial.completionValue ?? null,
  reason: partial.reason ?? null,
});

export const offlineDiscoveryDecisions = (): readonly AgentDecision[] => [
  decision({ action: "navigate", rationale: "Open the allowlisted member-servicing entry point" }),
  decision({ action: "type", rationale: "Enter the invocation member identifier", target: { frameName: iframe, role: "textbox", name: "Member Number", label: "Member Number", text: null }, value: "$INPUT:memberId" }),
  decision({ action: "click", rationale: "Submit the member search", target: { frameName: iframe, role: "button", name: "Find Member", label: null, text: "Find Member" } }),
  decision({ action: "wait", rationale: "Wait for the legacy host response" }),
  decision({ action: "read", rationale: "Read the requested savings balance", target: { frameName: iframe, role: "generic", name: "Savings balance", label: null, text: "$1,284.44" }, outputName: "savingsBalance" }),
  decision({ action: "complete", rationale: "The requested value was read from the live UI" }),
];

interface TargetContext {
  readonly server?: RunningDemoServer;
  readonly targetUrl: string;
}

const resolveTarget = async (target: string | undefined, scenario: string): Promise<TargetContext> => {
  if (target !== undefined) return { targetUrl: target };
  const server = await startDemoServer();
  return { server, targetUrl: `${server.baseUrl}/app?scenario=${encodeURIComponent(scenario)}` };
};

const persistArtifact = async (path: string, artifact: CapabilityArtifact): Promise<void> => {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  await mkdir(parent, { recursive: true });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
};

const interactiveOperatorFor = (enabled: boolean, headed: boolean): HumanOperator | undefined => enabled ? async (request, controller): Promise<void> => {
  if (!headed || !process.stdin.isTTY) throw new Error("Interactive handoff requires --headed and a TTY");
  await controller.claim("local-operator");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`Intervention ${request.interventionId} claimed in browser session ${controller.sessionId}.\n`);
    const actions: string[] = [];
    while (true) {
      const action = (await terminal.question("Audited operator action [click, wait, return]: ")).trim().toLowerCase();
      if (action === "return") break;
      if (action === "wait") {
        await controller.humanAct("local-operator", { type: "wait", durationMs: 500, timeoutMs: 1_000 }, "safe");
        actions.push("waited 500ms");
        continue;
      }
      if (action === "click") {
        const accessibleName = (await terminal.question("Accessible button name: ")).trim();
        if (accessibleName === "") throw new Error("An accessible button name is required");
        const frame = (await terminal.question("Frame [legacy/main]: ")).trim().toLowerCase();
        const risk = (await terminal.question("Risk [safe/risky/irreversible]: ")).trim().toLowerCase();
        if (risk !== "safe" && risk !== "risky" && risk !== "irreversible") throw new Error("Risk must be safe, risky, or irreversible");
        const target: LocatorBundle = {
          candidates: [{ strategy: "role", role: "button", name: accessibleName, exact: true }],
          ...(frame === "legacy" ? { framePath: [{ strategy: "role", role: "iframe", name: "Legacy member servicing workspace", exact: false }, { strategy: "css", selector: "iframe[name=\"legacyWorkspace\"]" }] } : {}),
          robustnessNote: "Operator-supplied accessible name, executed through the policy-enforced handoff controller.",
        };
        await controller.humanAct("local-operator", { type: "click", target, timeoutMs: 5_000 }, risk);
        actions.push(`clicked ${accessibleName} (${risk})`);
        continue;
      }
      process.stdout.write("Unsupported action. Use click, wait, or return.\n");
    }
    await controller.resume("local-operator", actions.join("; ") || "Returned control without a UI action");
  } finally {
    terminal.close();
  }
} : undefined;

export const runOfflineDemo = async (evidenceRoot = "evidence"): Promise<Readonly<Record<string, unknown>>> => {
  const target = await resolveTarget(undefined, "success");
  const surface = await PlaywrightSurface.create({ headless: true });
  try {
    const targetUrl = target.targetUrl;
    const policy = new PolicyEngine(createDefaultPolicy(new URL(targetUrl).origin));
    const discovery = await runDiscovery({ goal: "Look up member 12345 and read the current savings balance", targetUrl, inputs: { memberId: "12345" }, surface, model: new ScriptedDiscoveryModel(offlineDiscoveryDecisions()), policy, evidenceRoot, evidenceKind: "fixture" });
    if (discovery.kind !== "success") throw new Error(`Offline discovery stopped: ${discovery.reason}`);
    const approvedArtifact = approveCapabilityArtifact(discovery.artifact, "offline-demo-review");
    await persistArtifact(`${evidenceRoot}/example-capability.json`, approvedArtifact);
    const replaySuccess = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl, memberId: "12345" }, surface, policy, evidenceRoot });

    const notFoundUrl = `${target.server?.baseUrl ?? new URL(targetUrl).origin}/app?scenario=success`;
    const replayNotFound = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: notFoundUrl, memberId: "00000" }, surface, policy, evidenceRoot });

    const handoffUrl = `${target.server?.baseUrl ?? new URL(targetUrl).origin}/app?scenario=unknown-dialog`;
    const resolveButton: LocatorBundle = { candidates: [{ strategy: "role", role: "button", name: "Resolve manually", exact: true }], framePath: [{ strategy: "role", role: "iframe", name: "Legacy member servicing workspace", exact: false }, { strategy: "css", selector: "iframe[name=\"legacyWorkspace\"]" }], robustnessNote: "Explicit operator-only dialog control." };
    const replayHandoff = await replayCapability({
      artifact: approvedArtifact,
      inputs: { targetUrl: handoffUrl, memberId: "12345" },
      surface,
      policy,
      evidenceRoot,
      humanOperator: async (_request, controller) => {
        await controller.claim("offline-demo-operator");
        await controller.humanAct("offline-demo-operator", { type: "click", target: resolveButton, timeoutMs: 3_000 }, "safe");
        await controller.resume("offline-demo-operator", "Dismissed the unknown synthetic host dialog");
      },
    });

    const failureUrl = `${target.server?.baseUrl ?? new URL(targetUrl).origin}/app?scenario=permission`;
    const replayFailure = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: failureUrl, memberId: "12345" }, surface, policy, evidenceRoot });
    const scenarioUrl = (scenario: string): string => `${target.server?.baseUrl ?? new URL(targetUrl).origin}/app?scenario=${scenario}`;
    const replayInterstitial = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: scenarioUrl("interstitial"), memberId: "12345" }, surface, policy, evidenceRoot });
    const replayExpired = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: scenarioUrl("expired"), memberId: "12345" }, surface, policy, evidenceRoot });
    const replayValidation = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: scenarioUrl("validation"), memberId: "12345" }, surface, policy, evidenceRoot });
    const replayRetryExhausted = await replayCapability({ artifact: approvedArtifact, inputs: { targetUrl: scenarioUrl("stuck-loading"), memberId: "12345" }, surface, policy, evidenceRoot });

    const { contentHash: _contentHash, ...hashableArtifact } = approvedArtifact;
    const brokenHashable: Omit<CapabilityArtifact, "contentHash"> = {
      ...hashableArtifact,
      steps: hashableArtifact.steps.map((step, index) => index === 1 && step.action === "type" ? {
        ...step,
        target: { candidates: [{ strategy: "role", role: "textbox", name: "Missing Member Field", exact: true }], robustnessNote: "Deliberately missing target used to verify hard-failure classification." },
      } : step),
    };
    const brokenArtifact: CapabilityArtifact = { ...brokenHashable, contentHash: computeCapabilityContentHash(brokenHashable) };
    const replayMissingLocator = await replayCapability({ artifact: brokenArtifact, inputs: { targetUrl, memberId: "12345" }, surface, policy, evidenceRoot });

    const driftHashable: Omit<CapabilityArtifact, "contentHash"> = { ...hashableArtifact, application: { ...hashableArtifact.application, driftFingerprint: "deliberate-drift-mismatch" } };
    const driftArtifact: CapabilityArtifact = { ...driftHashable, contentHash: computeCapabilityContentHash(driftHashable) };
    const replayDriftMismatch = await replayCapability({ artifact: driftArtifact, inputs: { targetUrl, memberId: "12345" }, surface, policy, evidenceRoot });

    const riskyHashable: Omit<CapabilityArtifact, "contentHash"> = {
      ...hashableArtifact,
      declaredRisk: "risky",
      steps: hashableArtifact.steps.map(step => step.action === "click" ? { ...step, risk: "risky" } : step),
    };
    const riskyArtifact: CapabilityArtifact = { ...riskyHashable, contentHash: computeCapabilityContentHash(riskyHashable) };
    const riskyRunId = `replay-${randomUUID()}`;
    const replayRiskDenied = await replayCapability({ runId: riskyRunId, artifact: riskyArtifact, inputs: { targetUrl, memberId: "12345" }, surface, policy, evidenceRoot });
    const issuedAt = new Date();
    const replayRiskApproved = await replayCapability({ runId: `${riskyRunId}-approved`, artifact: riskyArtifact, inputs: { targetUrl, memberId: "12345" }, surface, policy, evidenceRoot, approval: { approvalId: randomUUID(), runId: `${riskyRunId}-approved`, actionTypes: ["click"], issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString() } });

    const result = { discovery: { kind: discovery.kind, runId: discovery.runId, logPath: discovery.logPath, model: "scripted-fixture-model" }, replaySuccess, replayNotFound, replayHandoff, replayFailure, replayInterstitial, replayExpired, replayValidation, replayRetryExhausted, replayMissingLocator, replayDriftMismatch, replayRiskDenied, replayRiskApproved };
    await writeFile(`${evidenceRoot}/offline-demo-result.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    await surface.close();
    await target.server?.close();
  }
};

const discover = async (args: readonly string[]): Promise<void> => {
  const values = valuesFor(args);
  const target = await resolveTarget(values.target, values.scenario);
  const surface = await PlaywrightSurface.create({ headless: !values.headed });
  try {
    const key = process.env.OPENAI_API_KEY;
    if (key === undefined || key.trim() === "") throw new Error("Set OPENAI_API_KEY for a genuine model-driven discovery run");
    const policy = new PolicyEngine(createDefaultPolicy(new URL(target.targetUrl).origin));
    const humanOperator = interactiveOperatorFor(values["interactive-handoff"], values.headed);
    const result = await runDiscovery({ goal: values.goal, targetUrl: target.targetUrl, inputs: { memberId: values["member-id"] }, surface, model: new OpenAIDiscoveryModel(key, values.model), policy, evidenceRoot: values["evidence-root"], evidenceKind: "live", ...(humanOperator === undefined ? {} : { humanOperator }) });
    if (result.kind === "success") await persistArtifact(values.artifact, result.artifact);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await surface.close();
    await target.server?.close();
  }
};

const replay = async (args: readonly string[]): Promise<void> => {
  const values = valuesFor(args);
  const target = await resolveTarget(values.target, values.scenario);
  const surface = await PlaywrightSurface.create({ headless: !values.headed });
  try {
    const artifact = JSON.parse(await readFile(values.artifact, "utf8")) as CapabilityArtifact;
    const policy = new PolicyEngine(createDefaultPolicy(new URL(target.targetUrl).origin));
    const humanOperator = interactiveOperatorFor(values["interactive-handoff"], values.headed);
    const runId = `replay-${randomUUID()}`;
    const riskyActions = [...new Set(artifact.steps.filter(step => step.risk === "risky").map(step => step.action as SurfaceActionType))];
    const approval: RiskApproval | undefined = values["approve-risk"] && riskyActions.length > 0 ? {
      approvalId: randomUUID(), runId, actionTypes: riskyActions, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    } : undefined;
    const result = await replayCapability({ runId, artifact, inputs: { targetUrl: target.targetUrl, memberId: values["member-id"] }, surface, policy, evidenceRoot: values["evidence-root"], ...(approval === undefined ? {} : { approval }), ...(humanOperator === undefined ? {} : { humanOperator }) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.kind === "failure") process.exitCode = 1;
  } finally {
    await surface.close();
    await target.server?.close();
  }
};

const approve = async (args: readonly string[]): Promise<void> => {
  const values = valuesFor(args);
  if (values.reviewer === undefined || values.reviewer.trim() === "") throw new Error("--reviewer is required for explicit artifact approval");
  const artifact = JSON.parse(await readFile(values.artifact, "utf8")) as CapabilityArtifact;
  const approved = approveCapabilityArtifact(artifact, values.reviewer);
  await persistArtifact(values.artifact, approved);
  process.stdout.write(`${JSON.stringify({ artifact: values.artifact, status: approved.review.status, reviewer: approved.review.reviewedBy, contentHash: approved.contentHash }, null, 2)}\n`);
};

export const main = async (args = process.argv.slice(2)): Promise<void> => {
  const [command, ...rest] = args;
  if (command === "discover") await discover(rest);
  else if (command === "approve") await approve(rest);
  else if (command === "replay") await replay(rest);
  else if (command === "offline") process.stdout.write(`${JSON.stringify(await runOfflineDemo(valuesFor(rest)["evidence-root"]), null, 2)}\n`);
  else throw new Error("Usage: tsx src/cli.ts discover|approve|replay|offline [options]");
};

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
