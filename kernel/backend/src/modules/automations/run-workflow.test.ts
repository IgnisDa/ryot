import { expect, it } from "@effect/vitest";
import { DbError, SandboxRunError, type SandboxFailureKind } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationRunAttempt,
	AutomationRequestPayload,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/sandbox/wire";
import { Effect, Layer, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import { automationAttemptIdentity, type FinalizeAutomationAttempt } from "./attempt-repository";
import { triggerFixture } from "./lifecycle.test-support";
import { AutomationRunWorkflow } from "./run-workflow";
import {
	AutomationRunWorkflowOperations,
	classifyAutomationSandboxError,
	prepareAutomationInvocation,
	runAutomationRunWorkflow,
} from "./run-workflow-live";

const trigger = triggerFixture();
const run = Schema.decodeSync(AutomationRun)({
	id: "run",
	stage: "after",
	attemptCount: 0,
	startedAt: null,
	hookSlug: "hook",
	hookName: "Hook",
	status: "queued",
	finishedAt: null,
	skipReason: null,
	pluginId: "plugin",
	nextAttemptAt: null,
	delivery: "required",
	triggerId: trigger.id,
	executionUserId: "owner",
	scriptSlug: "hook-script",
	queuedAt: trigger.createdAt,
	scriptContentHash: "hash-old",
	sandboxScriptId: "script-old",
	pluginRevisionId: "revision-old",
	pluginConfigRevisionId: "config-old",
	artifactsExpireAt: "2026-09-22T00:00:00.000Z",
	retryPolicy: {
		maxAttempts: 3,
		maxDelayMs: 10000,
		initialDelayMs: 1000,
		externalIdempotency: "none",
	},
});
const payload = { runId: run.id, attemptNumber: 1 };
const identity = automationAttemptIdentity(run.id, 1);
const initialAttempt = Schema.decodeSync(AutomationRunAttempt)({
	...identity,
	...payload,
	logs: null,
	error: null,
	timing: null,
	retryable: false,
	finishedAt: null,
	status: "running",
	failureKind: null,
	returnedValue: null,
	artifactsPrunedAt: null,
	startedAt: trigger.createdAt,
});
const requestData = {
	resource: "entity",
	category: "request",
	operation: "create",
	draft: {
		properties: {},
		name: "Original",
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaSlug: "record",
	},
} as const;
const request = Schema.decodeSync(AutomationRequestPayload)(requestData);
const requestTrigger = Schema.decodeSync(AutomationTrigger)({
	...trigger,
	payload: request,
	kind: { resource: "entity", category: "request", operation: "create" },
});
const beforeRun = Schema.decodeSync(AutomationRun)({
	...run,
	stage: "before",
	retryPolicy: null,
	delivery: "policy",
	nextAttemptAt: null,
});

const workflowLayer = (operations: AutomationRunWorkflowOperations["Service"]) => {
	const instance = WorkflowInstance.initial(AutomationRunWorkflow, identity.workflowExecutionId);
	return Layer.mergeAll(
		Layer.succeed(AutomationRunWorkflowOperations, operations),
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
	);
};

const harness = (selectedRun = run, selectedTrigger = trigger) => {
	let attempt = initialAttempt;
	const outcomes: FinalizeAutomationAttempt[] = [];
	const children: string[] = [];
	const operations = AutomationRunWorkflowOperations.of({
		claim: () => Effect.sync(() => ({ attempt, stage: selectedRun.stage })),
		prepare: (input) =>
			prepareAutomationInvocation(selectedRun, selectedTrigger, input, { pinned: true }),
		finalize: (input) =>
			Effect.sync(() => {
				outcomes.push(input);
				attempt = { ...initialAttempt, ...input, finishedAt: "2026-09-15T00:00:01.000Z" };
				return attempt;
			}),
		runSandbox: (input) =>
			Effect.sync(() => {
				children.push(input.executionId);
				return {
					error: null,
					logs: ["script log"],
					status: "completed" as const,
					value: { secretLookingResult: "not-in-completion" },
				};
			}),
	});
	return { children, outcomes, operations };
};

it.effect(
	"passes inline canonical input, retained metadata and exact trusted revision identities",
	() =>
		Effect.gen(function* () {
			const prepared = yield* prepareAutomationInvocation(run, trigger, payload, {
				retained: "metadata",
			});
			expect(prepared).toEqual({
				scriptId: "script-old",
				subject: {
					runId: run.id,
					stage: "after",
					pluginId: "plugin",
					triggerId: trigger.id,
					type: "automation-run",
					executionUserId: "owner",
					causation: trigger.causation,
					pluginRevisionId: "revision-old",
					pluginConfigRevisionId: "config-old",
				},
				input: {
					automation: {
						runId: run.id,
						triggerId: trigger.id,
						hookSlug: run.hookSlug,
						executionUserId: "owner",
						payload: trigger.payload,
						causation: trigger.causation,
						occurredAt: trigger.occurredAt,
						hookMetadata: { retained: "metadata" },
					},
				},
			});
			const kernel = yield* prepareAutomationInvocation(
				{
					...run,
					pluginId: null,
					executionUserId: null,
					pluginRevisionId: null,
					pluginConfigRevisionId: null,
				},
				trigger,
				payload,
			);
			expect(kernel.subject).toEqual({
				...prepared.subject,
				pluginId: null,
				executionUserId: null,
				pluginRevisionId: null,
				pluginConfigRevisionId: null,
			});
		}),
);

it.effect(
	"feeds a transformed request into the next policy without replacing the immutable trigger",
	() =>
		Effect.gen(function* () {
			const transformed = yield* Schema.decodeEffect(AutomationRequestPayload)({
				...requestData,
				draft: { ...requestData.draft, name: "Transformed" },
			});
			const prepared = yield* prepareAutomationInvocation(beforeRun, requestTrigger, {
				...payload,
				policyPayload: transformed,
			});
			expect(prepared.input.automation.payload).toEqual(transformed);
			expect(requestTrigger.payload).toEqual(request);
			expect(prepared.subject).toMatchObject({ stage: "before", executionUserId: "owner" });
			const exit = yield* Effect.exit(
				prepareAutomationInvocation(beforeRun, requestTrigger, { ...payload, attemptNumber: 2 }),
			);
			expect(exit._tag).toBe("Failure");
		}),
);

it.effect("finalizes one attempt and returns only its safe summary on terminal replay", () =>
	Effect.gen(function* () {
		const state = harness();
		const execute = runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
			Effect.provide(workflowLayer(state.operations)),
		);
		const first = yield* execute;
		const replay = yield* execute;
		expect(replay).toEqual(first);
		expect(state.children).toEqual([`${identity.workflowExecutionId}-sandbox`]);
		expect(state.outcomes).toHaveLength(1);
		expect(state.outcomes[0]?.returnedValue).toEqual({ secretLookingResult: "not-in-completion" });
		expect(first).toEqual({
			policyOutput: null,
			attempt: {
				...identity,
				...payload,
				timing: null,
				retryable: false,
				failureKind: null,
				status: "succeeded",
				startedAt: trigger.createdAt,
				finishedAt: "2026-09-15T00:00:01.000Z",
			},
		});
	}),
);

it.effect("completes a terminalized claim without preparing or running a sandbox attempt", () =>
	Effect.gen(function* () {
		const state = harness();
		const result = yield* runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
			Effect.provide(
				workflowLayer({
					...state.operations,
					claim: () => Effect.succeed({ attempt: null, stage: "after" }),
					runSandbox: () => Effect.die("Terminalized claims must not run a sandbox"),
					prepare: () => Effect.die("Terminalized claims must not prepare an invocation"),
				}),
			),
		);
		expect(result).toEqual({ attempt: null, policyOutput: null });
		expect(state.outcomes).toEqual([]);
		expect(state.children).toEqual([]);
	}),
);

it.effect(
	"resumes the same child after a finalization failure instead of advancing the attempt",
	() =>
		Effect.gen(function* () {
			const state = harness();
			let first = true;
			const finalize = state.operations.finalize;
			const operations = {
				...state.operations,
				finalize: (input: FinalizeAutomationAttempt) => {
					if (first) {
						first = false;
						return Effect.fail(new DbError({ message: "handoff unavailable" }));
					}
					return finalize(input);
				},
			};
			const execute = runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
				Effect.provide(workflowLayer(operations)),
			);
			assertExitFails(yield* Effect.exit(execute), new DbError({ message: "handoff unavailable" }));
			const result = yield* execute;
			expect(state.children).toEqual([
				`${identity.workflowExecutionId}-sandbox`,
				`${identity.workflowExecutionId}-sandbox`,
			]);
			expect(result.attempt?.attemptNumber).toBe(1);
			expect(state.outcomes).toHaveLength(1);
		}),
);

it.effect("records policy rejection as success and returns the output on replay", () =>
	Effect.gen(function* () {
		const state = harness(beforeRun, requestTrigger);
		const operations = {
			...state.operations,
			runSandbox: () =>
				Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: { action: "reject", reason: "Rule declined" },
				}),
		};
		const execute = runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
			Effect.provide(workflowLayer(operations)),
		);
		const result = yield* execute;
		expect(result.policyOutput).toEqual({ action: "reject", reason: "Rule declined" });
		expect(result.attempt?.status).toBe("succeeded");
		expect(yield* execute).toEqual(result);
	}),
);

it.effect(
	"finalizes invalid policy output and sandbox timeout without waiting or creating another attempt",
	() =>
		Effect.gen(function* () {
			const invalid = harness(beforeRun, requestTrigger);
			const failed = yield* runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
				Effect.provide(workflowLayer(invalid.operations)),
			);
			expect(failed.attempt?.failureKind).toBe("invalid-output");
			expect(failed.policyOutput).toBeNull();
			const timeout = harness();
			const timed = yield* runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
				Effect.provide(
					workflowLayer({
						...timeout.operations,
						runSandbox: () =>
							Effect.fail(
								new SandboxRunError({
									kind: "timeout",
									message: "Sandbox timed out after 30000ms",
								}),
							),
					}),
				),
			);
			expect(timed.attempt?.failureKind).toBe("sandbox-timeout");
			expect(timeout.outcomes).toHaveLength(1);
		}),
);

it.effect(
	"finalizes missing retained input before dispatch and rejects a different workflow owner",
	() =>
		Effect.gen(function* () {
			const state = harness(run, { ...trigger, payload: null });
			const result = yield* runAutomationRunWorkflow(payload, identity.workflowExecutionId).pipe(
				Effect.provide(workflowLayer(state.operations)),
			);
			expect(result.attempt?.failureKind).toBe("missing-artifact");
			expect(state.children).toEqual([]);
			assertExitFails(
				yield* Effect.exit(
					runAutomationRunWorkflow(payload, "other-workflow").pipe(
						Effect.provide(workflowLayer(state.operations)),
					),
				),
				new DbError({ message: "Automation attempt workflow identity mismatch" }),
			);
		}),
);

const classify = (kind: SandboxFailureKind) =>
	classifyAutomationSandboxError({ kind, phase: "execute", message: "failed" });

it("maps every sandbox failure kind onto its automation failure kind", () => {
	expect(classify("timeout")).toBe("sandbox-timeout");
	expect(classify("infrastructure")).toBe("sandbox-infrastructure");
	expect(classify("resource-unavailable")).toBe("resource-unavailable");
	expect(classify("invalid-input")).toBe("invalid-input");
	expect(classify("invalid-output")).toBe("invalid-output");
	expect(classify("missing-artifact")).toBe("missing-artifact");
	expect(classify("external-uncertain")).toBe("external-uncertain-outcome");
	expect(classify("script-failure")).toBe("business-failure");
	expect(SANDBOX_FAILURE_KINDS.map(classify)).toHaveLength(SANDBOX_FAILURE_KINDS.length);
});
