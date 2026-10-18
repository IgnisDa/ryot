import { expect, it, layer } from "@effect/vitest";
import { DbError, type SandboxFailureKind, SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationRequestPayload,
	AutomationRun,
	AutomationRunAttempt,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/scripts/wire";
import { EntityId, EntitySchemaSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";
import { assert } from "vitest";

import { makeWorkflowActivityEngine } from "#testing/effect";

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
	...emptySandboxExecutionMetadata,
	kind: "automation",
	slug: "hook-script",
	name: "Hook script",
	automationType: "automation",
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
		entitySchemaPluginId: null,
	},
} as const;
const request = Schema.decodeSync(AutomationRequestPayload)(requestData);

it.effect(
	"replays captured kernel collection observer targets without changing plugin write ownership",
	() =>
		Effect.gen(function* () {
			const target = {
				resource: "event",
				operation: "create",
				owner: { kind: "kernel" },
				eventSchemaSlug: "review",
				entitySchemaSlug: "collection",
			} as const;
			const capturedTargets = [target];
			const { owner: _owner, ...localTarget } = target;
			const item = {
				resource: "event",
				category: "change",
				operation: "create",
				after: {
					properties: {},
					id: "kernel-event",
					sessionEntityId: null,
					entityId: "collection",
					eventSchemaSlug: "review",
					eventSchemaPluginId: null,
					entitySchemaPluginId: null,
					createdAt: trigger.occurredAt,
					updatedAt: trigger.occurredAt,
					occurredAt: trigger.occurredAt,
					entitySchemaSlug: "collection",
				},
			};
			const batch = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
				...trigger,
				kind: { resource: "event", category: "change", operation: "batch" },
				payload: {
					resource: "event",
					category: "change",
					operation: "batch",
					items: [
						item,
						{
							...item,
							after: {
								...item.after,
								id: "plugin-event",
								eventSchemaPluginId: run.pluginId,
								entitySchemaPluginId: run.pluginId,
							},
						},
					],
				},
			});
			const script = {
				...afterScript,
				inputProjection: { event: { properties: [], compareProperties: [] } },
			};
			const retained = yield* prepareAutomationInvocation(
				run,
				batch,
				payload,
				script,
				accountGeneration,
				undefined,
				capturedTargets,
			);
			expect(retained).toMatchObject({
				subject: { pluginId: run.pluginId, pluginRevisionId: run.pluginRevisionId },
				input: {
					automation: {
						payload: {
							items: [
								{
									after: {
										id: "kernel-event",
										eventSchemaPluginId: null,
										entitySchemaPluginId: null,
									},
								},
							],
						},
					},
				},
			});
			const current = yield* prepareAutomationInvocation(
				run,
				batch,
				payload,
				script,
				accountGeneration,
				undefined,
				[localTarget],
			);
			expect(current).toMatchObject({
				subject: { pluginId: run.pluginId },
				input: {
					automation: {
						payload: {
							items: [{ after: { id: "plugin-event", eventSchemaPluginId: run.pluginId } }],
						},
					},
				},
			});
			expect(
				yield* prepareAutomationInvocation(
					run,
					batch,
					payload,
					script,
					accountGeneration,
					undefined,
					capturedTargets,
				),
			).toEqual(retained);
		}),
);
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
				policyItemIdentity: null,
				lane: trigger.causation.lane,
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
					delivery: "required",
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
	"prepares system execution with user attribution and rejects missing or mismatched user ownership",
	() =>
		Effect.gen(function* () {
			const attributed = {
				...trigger,
				causation: {
					...trigger.causation,
					initiator: { kind: "user" as const, id: UserId.make("importer") },
				},
			};
			const system = yield* prepareAutomationInvocation(
				{ ...run, executionUserId: null },
				attributed,
				payload,
				afterScript,
				null,
			);
			expect(system.subject).toMatchObject({
				executionUserId: null,
				accountGeneration: null,
				causation: attributed.causation,
			});
			const user = yield* prepareAutomationInvocation(
				run,
				attributed,
				payload,
				afterScript,
				accountGeneration,
			);
			expect(user.subject).toMatchObject({
				accountGeneration,
				causation: attributed.causation,
				executionUserId: run.executionUserId,
			});
			for (const account of [null, { token: "token", userId: UserId.make("importer") }]) {
				const error = yield* Effect.flip(
					prepareAutomationInvocation(run, attributed, payload, afterScript, account),
				);
				expect(error).toMatchObject({ kind: "invalid-input" });
			}
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
			assert("items" in prepared.input);
			const item = prepared.input.items[0];
			assert(item);
			expect(item.payload).toEqual({
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

it.effect(
	"scheduling_lane_survives_durable_boundaries: before and required after runs keep the trigger lane and async after runs are background",
	() =>
		Effect.gen(function* () {
			const interactive = {
				...trigger,
				causation: { ...trigger.causation, lane: "interactive" as const },
			};
			const after = (delivery: "async" | "required") =>
				prepareAutomationInvocation(
					Schema.decodeUnknownSync(AutomationRun)({
						...Schema.encodeSync(AutomationRun)(run),
						delivery,
					}),
					interactive,
					payload,
					afterScript,
					accountGeneration,
				);
			const required = yield* after("required");
			const async = yield* after("async");
			const before = yield* prepareAutomationInvocation(
				beforeRun,
				{ ...requestTrigger, causation: interactive.causation },
				payload,
				policyScript,
				accountGeneration,
			);
			expect([before.lane, required.lane, async.lane]).toEqual([
				"interactive",
				"interactive",
				"background",
			]);
			expect(async.subject).toMatchObject({
				delivery: "async",
				causation: { lane: "interactive" },
			});
		}),
);

it.effect(
	"keeps a fifty-item policy batch within the input limit by sharing invocation metadata",
	() =>
		Effect.gen(function* () {
			const itemIdentities = Array.from({ length: 50 }, (_, index) => `item-${index}`);
			const batchTrigger = yield* Schema.decodeEffect(AutomationTrigger)({
				...requestTrigger,
				kind: { resource: "entity", operation: "batch", category: "request" },
				payload: {
					references: {},
					itemIdentities,
					resource: "entity",
					operation: "batch",
					category: "request",
					items: itemIdentities.map(() => request),
				},
			});
			const hookMetadata = { note: "x".repeat(2000) };
			const prepared = yield* prepareAutomationInvocation(
				beforeRun,
				batchTrigger,
				{ ...payload, acceptedBatchPatches: {}, activeItemIdentities: itemIdentities },
				policyScript,
				accountGeneration,
				hookMetadata,
			);
			assert("items" in prepared.input);
			expect(prepared.input.items).toHaveLength(50);
			expect(prepared.input.automation.hookMetadata).toEqual(hookMetadata);
			const bytes = jsonByteLength(prepared.input);
			assert(bytes !== null);
			expect(bytes).toBeLessThan(65_536);
		}),
);

it.effect("projects captured references for a session changed by an earlier batch policy", () =>
	Effect.gen(function* () {
		const eventRequest = yield* Schema.decodeEffect(AutomationRequestPayload)({
			resource: "event",
			category: "request",
			operation: "create",
			draft: {
				properties: {},
				entityId: "entity",
				entitySchemaSlug: "record",
				eventSchemaSlug: "activity",
				sessionEntityId: "original",
				eventSchemaPluginId: "plugin",
				entitySchemaPluginId: "plugin",
				occurredAt: trigger.occurredAt,
			},
		});
		const batchTrigger = yield* Schema.decodeEffect(AutomationTrigger)({
			...requestTrigger,
			kind: { resource: "event", operation: "batch", category: "request" },
			payload: {
				references: {},
				resource: "event",
				operation: "batch",
				category: "request",
				items: [eventRequest],
				itemIdentities: ["item"],
			},
		});
		const prepared = yield* prepareAutomationInvocation(
			beforeRun,
			batchTrigger,
			{
				...payload,
				acceptedBatchPatches: {
					item: [{ resource: "event", draft: { sessionEntityId: EntityId.make("replacement") } }],
				},
				acceptedReferences: {
					[EntityId.make("replacement")]: {
						name: "Related",
						providerId: null,
						externalId: null,
						populatedAt: null,
						properties: { marker: "captured" },
						entitySchemaPluginId: PluginId.make("plugin"),
						entitySchemaSlug: EntitySchemaSlug.make("record"),
					},
				},
			},
			{
				...policyScript,
				inputProjection: {
					event: { properties: [], entityProperties: [], sessionEntityProperties: ["marker"] },
				},
			},
			accountGeneration,
		);
		assert("items" in prepared.input);
		expect(prepared.input.automation.references?.[EntityId.make("replacement")]).toEqual({
			entitySchemaSlug: "record",
			entitySchemaPluginId: "plugin",
			properties: { marker: "captured" },
		});
		const item = prepared.input.items[0];
		assert(item?.payload.resource === "event");
		expect(item.payload.draft.sessionEntityId).toBe("replacement");
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
					value: {
						items: [
							{
								itemIdentity: requestTrigger.id,
								decision: { action: "reject", reason: "Rule declined" },
							},
						],
					},
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
