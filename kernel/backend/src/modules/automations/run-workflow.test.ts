import { expect, it, layer } from "@effect/vitest";
import { DbError, SandboxRunError, type SandboxFailureKind } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationRunAttempt,
	AutomationRequestPayload,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/sandbox/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { jsonByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Context, Effect, Layer, Ref, Schema } from "effect";
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
const accountGeneration = { userId: UserId.make("owner"), token: "test-account-generation" };
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
const payload = { runId: run.id, attemptNumber: 1, acceptedPatches: [] };
const afterScript = {
	capabilities: [],
	kind: "automation",
	slug: "hook-script",
	name: "Hook script",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	inputProjection: { signal: { properties: ["nested"] } },
} as const;
const policyScript = {
	...afterScript,
	automationType: "policy",
	inputProjection: { entity: { properties: [] } },
} as const;
const identity = automationAttemptIdentity(run.id, 1);
const initialAttempt = Schema.decodeSync(AutomationRunAttempt)({
	...identity,
	logs: null,
	error: null,
	timing: null,
	retryable: false,
	finishedAt: null,
	status: "running",
	failureKind: null,
	returnedValue: null,
	runId: payload.runId,
	artifactsPrunedAt: null,
	startedAt: trigger.createdAt,
	attemptNumber: payload.attemptNumber,
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

type Operations = AutomationRunWorkflowOperations["Service"];

type HarnessOptions = {
	readonly run?: AutomationRun;
	readonly trigger?: AutomationTrigger;
	readonly failFirstFinalize?: boolean;
	readonly overrides?: Partial<Pick<Operations, "claim" | "prepare" | "runSandbox">>;
};

type HarnessState = {
	readonly options: HarnessOptions;
	readonly attempt: AutomationRunAttempt;
	readonly outcomes: ReadonlyArray<FinalizeAutomationAttempt>;
	readonly children: ReadonlyArray<string>;
	readonly finalizeCalls: number;
};

const initialState = (options: HarnessOptions): HarnessState => ({
	options,
	outcomes: [],
	children: [],
	finalizeCalls: 0,
	attempt: initialAttempt,
});

class RunWorkflowHarness extends Context.Service<
	RunWorkflowHarness,
	{
		readonly outcomes: Effect.Effect<ReadonlyArray<FinalizeAutomationAttempt>>;
		readonly children: Effect.Effect<ReadonlyArray<string>>;
		readonly reset: (options: HarnessOptions) => Effect.Effect<void>;
	}
>()("test/RunWorkflowHarness") {}

const harnessLayer = (initialOptions: HarnessOptions = {}) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const state = yield* Ref.make(initialState(initialOptions));
			const current = Ref.get(state);
			const selected = Effect.map(current, ({ options }) => ({
				run: options.run ?? run,
				overrides: options.overrides ?? {},
				trigger: options.trigger ?? trigger,
			}));
			const operations = AutomationRunWorkflowOperations.of({
				claim: (input) =>
					Effect.flatMap(current, ({ options, attempt }) =>
						options.overrides?.claim
							? options.overrides.claim(input)
							: Effect.succeed({ attempt, stage: (options.run ?? run).stage }),
					),
				prepare: (input) =>
					Effect.flatMap(selected, (chosen) =>
						chosen.overrides.prepare
							? chosen.overrides.prepare(input)
							: prepareAutomationInvocation(
									chosen.run,
									chosen.trigger,
									input,
									chosen.run.stage === "before" ? policyScript : afterScript,
									chosen.run.executionUserId === null
										? null
										: { token: "test-account-generation", userId: chosen.run.executionUserId },
									{ pinned: true },
								),
					),
				runSandbox: (input) =>
					Effect.gen(function* () {
						const { overrides } = yield* selected;
						if (overrides.runSandbox) {
							return yield* overrides.runSandbox(input);
						}
						yield* Ref.update(state, (snapshot) => ({
							...snapshot,
							children: [...snapshot.children, input.executionId],
						}));
						return {
							error: null,
							logs: ["script log"],
							status: "completed" as const,
							value: { secretLookingResult: "not-in-completion" },
						};
					}),
				finalize: (input) =>
					Effect.gen(function* () {
						const { options, finalizeCalls } = yield* Ref.updateAndGet(state, (snapshot) => ({
							...snapshot,
							finalizeCalls: snapshot.finalizeCalls + 1,
						}));
						if (options.failFirstFinalize && finalizeCalls === 1) {
							return yield* new DbError({ message: "handoff unavailable" });
						}
						const attempt = { ...initialAttempt, ...input, finishedAt: "2026-09-15T00:00:01.000Z" };
						yield* Ref.update(state, (snapshot) => ({
							...snapshot,
							attempt,
							outcomes: [...snapshot.outcomes, input],
						}));
						return attempt;
					}),
			});
			return Context.make(AutomationRunWorkflowOperations, operations).pipe(
				Context.add(RunWorkflowHarness, {
					outcomes: Effect.map(current, ({ outcomes }) => outcomes),
					children: Effect.map(current, ({ children }) => children),
					reset: (options) => Ref.set(state, initialState(options)),
				}),
			);
		}),
	);

const execute = (executionId: string = identity.workflowExecutionId) =>
	Effect.suspend(() => {
		const instance = WorkflowInstance.initial(AutomationRunWorkflow, identity.workflowExecutionId);
		return runAutomationRunWorkflow(payload, executionId).pipe(
			Effect.provideService(WorkflowInstance, instance),
			Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		);
	});

it.effect(
	"passes inline canonical input, retained metadata and exact trusted revision identities",
	() =>
		Effect.gen(function* () {
			const prepared = yield* prepareAutomationInvocation(
				run,
				trigger,
				payload,
				afterScript,
				accountGeneration,
				{ retained: "metadata" },
			);
			expect(prepared).toEqual({
				scriptId: "script-old",
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
					accountGeneration: { userId: UserId.make("owner"), token: "test-account-generation" },
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
				afterScript,
				null,
			);
			expect(kernel.subject).toEqual({
				...prepared.subject,
				pluginId: null,
				executionUserId: null,
				pluginRevisionId: null,
				accountGeneration: null,
				pluginConfigRevisionId: null,
			});
		}),
);

it.effect(
	"feeds a transformed request into the next policy without replacing the immutable trigger",
	() =>
		Effect.gen(function* () {
			const patch = { resource: "entity", draft: { name: "Transformed" } } as const;
			const prepared = yield* prepareAutomationInvocation(
				beforeRun,
				requestTrigger,
				{ ...payload, acceptedPatches: [patch] },
				policyScript,
				accountGeneration,
			);
			expect(prepared.input.automation.payload).toEqual({
				...request,
				draft: { ...request.draft, properties: {}, name: "Transformed" },
			});
			expect(requestTrigger.payload).toEqual(request);
			expect(prepared.subject).toMatchObject({ stage: "before", executionUserId: "owner" });
			const exit = yield* Effect.exit(
				prepareAutomationInvocation(
					beforeRun,
					requestTrigger,
					{ ...payload, attemptNumber: 2 },
					policyScript,
					accountGeneration,
				),
			);
			expect(exit._tag).toBe("Failure");
		}),
);

it.effect("uses safe standard preparation diagnostics", () =>
	Effect.gen(function* () {
		const mismatch = yield* prepareAutomationInvocation(
			beforeRun,
			requestTrigger,
			{ ...payload, attemptNumber: 2 },
			policyScript,
			accountGeneration,
		).pipe(Effect.flip);
		expect(mismatch).toMatchObject({
			kind: "invalid-input",
			message: "Automation workflow input does not match the retained run",
		});
		const missingScript = yield* prepareAutomationInvocation(
			{ ...run, sandboxScriptId: null },
			trigger,
			payload,
			afterScript,
			accountGeneration,
		).pipe(Effect.flip);
		expect(missingScript).toMatchObject({
			kind: "missing-artifact",
			message: "Pinned automation script or hook declaration is unavailable",
		});

		const invalidProjection = yield* prepareAutomationInvocation(
			run,
			trigger,
			payload,
			{
				...afterScript,
				inputProjection: {
					entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
				},
			},
			accountGeneration,
		).pipe(Effect.flip);
		expect(invalidProjection).toMatchObject({
			kind: "invalid-input",
			message:
				"Automation input projection for script 'hook-script' and hook 'hook' does not declare the retained trigger resource",
		});

		const oversizedPayload = {
			actorUserId: "owner",
			operation: "emit" as const,
			signalSchemaPluginId: null,
			category: "signal" as const,
			resource: "signal" as const,
			signalSchemaSlug: "fixture.signal",
			properties: { oversized: "a".repeat(65_536) },
		};
		const oversizedTrigger = yield* Schema.decodeEffect(AutomationTrigger)({
			...trigger,
			payload: oversizedPayload,
		});
		const expectedInput = {
			automation: {
				runId: run.id,
				triggerId: trigger.id,
				hookSlug: run.hookSlug,
				payload: oversizedPayload,
				causation: trigger.causation,
				occurredAt: trigger.occurredAt,
				executionUserId: run.executionUserId,
			},
		};
		const expectedBytes = jsonByteLength(expectedInput);
		expect(expectedBytes).not.toBeNull();
		const oversized = yield* prepareAutomationInvocation(
			run,
			oversizedTrigger,
			payload,
			{ ...afterScript, inputProjection: { signal: { properties: ["oversized"] } } },
			accountGeneration,
		).pipe(Effect.flip);
		expect(oversized).toMatchObject({
			kind: "invalid-input",
			message: `Automation input for hook 'hook' is ${expectedBytes} UTF-8 bytes; maximum is 65536 bytes`,
		});
	}),
);

layer(harnessLayer())((test) => {
	test.effect("finalizes one attempt and returns only its safe summary on terminal replay", () =>
		Effect.gen(function* () {
			const harness = yield* RunWorkflowHarness;
			const first = yield* execute();
			const replay = yield* execute();
			expect(replay).toEqual(first);
			expect(yield* harness.children).toEqual([`${identity.workflowExecutionId}-sandbox`]);
			const outcomes = yield* harness.outcomes;
			expect(outcomes).toHaveLength(1);
			expect(outcomes[0]?.returnedValue).toEqual({ secretLookingResult: "not-in-completion" });
			expect(first).toEqual({
				policyOutput: null,
				attempt: {
					...identity,
					timing: null,
					retryable: false,
					failureKind: null,
					status: "succeeded",
					runId: payload.runId,
					startedAt: trigger.createdAt,
					attemptNumber: payload.attemptNumber,
					finishedAt: "2026-09-15T00:00:01.000Z",
				},
			});
		}),
	);
});

layer(
	harnessLayer({
		overrides: {
			claim: () => Effect.succeed({ attempt: null, stage: "after" }),
			runSandbox: () => Effect.die("Terminalized claims must not run a sandbox"),
			prepare: () => Effect.die("Terminalized claims must not prepare an invocation"),
		},
	}),
)((test) => {
	test.effect("completes a terminalized claim without preparing or running a sandbox attempt", () =>
		Effect.gen(function* () {
			const harness = yield* RunWorkflowHarness;
			const result = yield* execute();
			expect(result).toEqual({ attempt: null, policyOutput: null });
			expect(yield* harness.outcomes).toEqual([]);
			expect(yield* harness.children).toEqual([]);
		}),
	);
});

layer(harnessLayer({ failFirstFinalize: true }))((test) => {
	test.effect(
		"resumes the same child after a finalization failure instead of advancing the attempt",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunWorkflowHarness;
				assertExitFails(
					yield* Effect.exit(execute()),
					new DbError({ message: "handoff unavailable" }),
				);
				const result = yield* execute();
				expect(yield* harness.children).toEqual([
					`${identity.workflowExecutionId}-sandbox`,
					`${identity.workflowExecutionId}-sandbox`,
				]);
				expect(result.attempt?.attemptNumber).toBe(1);
				expect(yield* harness.outcomes).toHaveLength(1);
			}),
	);
});

layer(
	harnessLayer({
		run: beforeRun,
		trigger: requestTrigger,
		overrides: {
			runSandbox: () =>
				Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: { action: "reject", reason: "Rule declined" },
				}),
		},
	}),
)((test) => {
	test.effect("records policy rejection as success and returns the output on replay", () =>
		Effect.gen(function* () {
			const result = yield* execute();
			expect(result.policyOutput).toEqual({ action: "reject", reason: "Rule declined" });
			expect(result.attempt?.status).toBe("succeeded");
			expect(yield* execute()).toEqual(result);
		}),
	);
});

layer(harnessLayer({ run: beforeRun, trigger: requestTrigger }))((test) => {
	test.effect(
		"finalizes invalid policy output and sandbox timeout without waiting or creating another attempt",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunWorkflowHarness;
				const failed = yield* execute();
				expect(failed.attempt?.failureKind).toBe("invalid-output");
				expect(failed.policyOutput).toBeNull();
				yield* harness.reset({
					overrides: {
						runSandbox: () =>
							Effect.fail(
								new SandboxRunError({
									kind: "timeout",
									message: "Sandbox timed out after 30000ms",
								}),
							),
					},
				});
				const timed = yield* execute();
				expect(timed.attempt?.failureKind).toBe("sandbox-timeout");
				expect(yield* harness.outcomes).toHaveLength(1);
			}),
	);
});

layer(harnessLayer({ trigger: { ...trigger, payload: null } }))((test) => {
	test.effect(
		"finalizes missing retained input before dispatch and rejects a different workflow owner",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunWorkflowHarness;
				const result = yield* execute();
				expect(result.attempt?.failureKind).toBe("missing-artifact");
				expect((yield* harness.outcomes)[0]?.error).toEqual({
					code: "missing-artifact",
					message: "Retained automation trigger payload is unavailable",
				});
				expect(yield* harness.children).toEqual([]);
				assertExitFails(
					yield* Effect.exit(execute("other-workflow")),
					new DbError({ message: "Automation attempt workflow identity mismatch" }),
				);
			}),
	);
});

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
