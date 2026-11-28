import { expect } from "bun:test";

import { DbError, type SandboxFailureKind, SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationPluginAfterRun,
	type AutomationRun,
	AutomationRunAttempt,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { type ChangeSet, ChangesOutput } from "@ryot-app/contract/modules/changes/change-set";
import { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/scripts/wire";
import {
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { decodeScriptCall } from "#modules/scripts/executions/calls";
import {
	sandboxExecutionFailure,
	type SandboxExecutionResult,
} from "#modules/scripts/executions/result";

import { automationAttemptIdentity, type FinalizeAutomationAttempt } from "./attempt-repository";
import { triggerFixture } from "./lifecycle.test-support";
import {
	type AutomationAttemptChanges,
	AutomationRunOperations,
	classifyAutomationSandboxError,
	prepareAutomationInvocation,
	type PreparedAutomationAttempt,
	runAutomationAttempt,
} from "./run-job-live";

const trigger = triggerFixture();
const accountUserId = UserId.make("owner");
const run = AutomationPluginAfterRun.make({
	attemptCount: 0,
	startedAt: null,
	hookName: "Hook",
	status: "queued",
	finishedAt: null,
	skipReason: null,
	nextAttemptAt: null,
	triggerId: trigger.id,
	scriptSlug: "hook-script",
	queuedAt: trigger.createdAt,
	scriptContentHash: "hash-old",
	id: AutomationRunId.make("run"),
	pluginId: PluginId.make("plugin"),
	executionUserId: UserId.make("owner"),
	hookSlug: AutomationHookSlug.make("hook"),
	artifactsExpireAt: "2026-09-22T00:00:00.000Z",
	sandboxScriptId: SandboxScriptId.make("script-old"),
	pluginRevisionId: PluginRevisionId.make("revision-old"),
	pluginConfigRevisionId: PluginConfigRevisionId.make("config-old"),
	retryPolicy: {
		maxAttempts: 3,
		maxDelayMs: 10000,
		initialDelayMs: 1000,
		externalIdempotency: "none",
	},
});
const payload = { runId: run.id, attemptNumber: 1 };
const afterScript = {
	...emptySandboxExecutionMetadata,
	kind: "automation",
	slug: "hook-script",
	name: "Hook script",
	automationType: "automation",
	inputProjection: { signal: { properties: ["nested"] } },
} as const;
const hookChanges = {
	signals: [{ properties: {}, discriminator: "first", schemaSlug: "hook-done" }],
} satisfies ChangeSet;
const withPrincipal = (
	prepared: Effect.Success<ReturnType<typeof prepareAutomationInvocation>>,
): PreparedAutomationAttempt => ({
	...prepared,
	principal: {
		providerId: null,
		pluginRevision: null,
		metadata: afterScript,
		subject: prepared.subject,
		scriptSlug: run.scriptSlug,
		scriptId: prepared.scriptId,
		contentHash: run.scriptContentHash,
	},
});
const identity = automationAttemptIdentity(run.id, 1);
const initialAttempt = AutomationRunAttempt.make({
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
				accountUserId,
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
				accountUserId,
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
					accountUserId,
					undefined,
					capturedTargets,
				),
			).toEqual(retained);
		}),
	testTimeout,
);
const otherTrigger = AutomationTrigger.make({ ...trigger, id: AutomationTriggerId.make("other") });

type Operations = AutomationRunOperations["Service"];
type SandboxRun = (
	input: Parameters<Operations["runSandbox"]>[0],
) => Effect.Effect<SandboxExecutionResult>;

type HarnessOptions = {
	readonly run?: AutomationRun;
	readonly trigger?: AutomationTrigger;
	readonly failFirstFinalize?: boolean;
	readonly overrides?: Partial<{ runSandbox: SandboxRun } & Pick<Operations, "claim" | "prepare">>;
};

type HarnessState = {
	readonly finalizeCalls: number;
	readonly options: HarnessOptions;
	readonly attempt: AutomationRunAttempt;
	readonly children: ReadonlyArray<string>;
	readonly written: ReadonlyArray<AutomationAttemptChanges>;
	readonly outcomes: ReadonlyArray<FinalizeAutomationAttempt>;
};

const initialState = (options: HarnessOptions): HarnessState => ({
	options,
	written: [],
	outcomes: [],
	children: [],
	finalizeCalls: 0,
	attempt: initialAttempt,
});

class RunJobHarness extends Context.Service<
	RunJobHarness,
	{
		readonly children: Effect.Effect<ReadonlyArray<string>>;
		readonly reset: (options: HarnessOptions) => Effect.Effect<void>;
		readonly written: Effect.Effect<ReadonlyArray<AutomationAttemptChanges>>;
		readonly outcomes: Effect.Effect<ReadonlyArray<FinalizeAutomationAttempt>>;
	}
>()("@ryot-app/kernel-backend/modules/automations/run-job.test/RunJobHarness") {}

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
			const operations = AutomationRunOperations.of({
				claim: (input) =>
					Effect.flatMap(current, ({ options, attempt }) =>
						options.overrides?.claim
							? options.overrides.claim(input)
							: Effect.succeed({ attempt, claimed: true }),
					),
				prepare: (input) =>
					Effect.flatMap(selected, (chosen) =>
						chosen.overrides.prepare
							? chosen.overrides.prepare(input)
							: prepareAutomationInvocation(
									chosen.run,
									chosen.trigger,
									input,
									afterScript,
									chosen.run.executionUserId,
									{ pinned: true },
								).pipe(Effect.map(withPrincipal)),
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
							value: { changes: hookChanges },
						};
					}).pipe(Effect.flatMap((result) => decodeScriptCall(result, ChangesOutput))),
				finalize: (input, written) =>
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
							written: written === undefined ? snapshot.written : [...snapshot.written, written],
						}));
						return attempt;
					}),
			});
			return Context.make(AutomationRunOperations, operations).pipe(
				Context.add(RunJobHarness, {
					written: Effect.map(current, ({ written }) => written),
					outcomes: Effect.map(current, ({ outcomes }) => outcomes),
					children: Effect.map(current, ({ children }) => children),
					reset: (options) => Ref.set(state, initialState(options)),
				}),
			);
		}),
	);

const execute = () => runAutomationAttempt(payload);

it.effect(
	"passes inline canonical input, retained metadata and exact trusted revision identities",
	() =>
		Effect.gen(function* () {
			const prepared = yield* prepareAutomationInvocation(
				run,
				trigger,
				payload,
				afterScript,
				accountUserId,
				{ retained: "metadata" },
			);
			expect(prepared).toEqual<unknown>({
				lane: "background",
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
					accountUserId: UserId.make("owner"),
					pluginConfigRevisionId: "config-old",
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
			expect(kernel.subject).toEqual<unknown>({
				...prepared.subject,
				pluginId: null,
				accountUserId: null,
				executionUserId: null,
				pluginRevisionId: null,
				pluginConfigRevisionId: null,
			});
		}),
	testTimeout,
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
				accountUserId: null,
				executionUserId: null,
				causation: attributed.causation,
			});
			const user = yield* prepareAutomationInvocation(
				run,
				attributed,
				payload,
				afterScript,
				accountUserId,
			);
			expect(user.subject).toMatchObject({
				accountUserId,
				causation: attributed.causation,
				executionUserId: run.executionUserId,
			});
			for (const account of [null, UserId.make("importer")]) {
				const error = yield* Effect.flip(
					prepareAutomationInvocation(run, attributed, payload, afterScript, account),
				);
				expect(error).toMatchObject({ kind: "invalid-input" });
			}
		}),
	testTimeout,
);

it.effect(
	"runs after hooks on the background lane whatever lane triggered them",
	() =>
		Effect.gen(function* () {
			const prepared = yield* prepareAutomationInvocation(
				run,
				{ ...trigger, causation: { ...trigger.causation, lane: "interactive" } },
				payload,
				afterScript,
				accountUserId,
			);
			expect(prepared.lane).toBe("background");
			expect(prepared.subject).toMatchObject({
				stage: "after",
				causation: { lane: "interactive" },
			});
		}),
	testTimeout,
);

it.effect(
	"uses safe standard preparation diagnostics",
	() =>
		Effect.gen(function* () {
			const mismatch = yield* prepareAutomationInvocation(
				run,
				otherTrigger,
				payload,
				afterScript,
				accountUserId,
			).pipe(Effect.flip);
			expect(mismatch).toMatchObject({
				kind: "invalid-input",
				message: "Automation input does not match the retained run",
			});
			const missingScript = yield* prepareAutomationInvocation(
				{ ...run, sandboxScriptId: null },
				trigger,
				payload,
				afterScript,
				accountUserId,
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
				accountUserId,
			).pipe(Effect.flip);
			expect(invalidProjection).toMatchObject({
				kind: "invalid-input",
				message:
					"Automation input projection for script 'hook-script' and hook 'hook' does not declare the retained trigger resource",
			});
		}),
	testTimeout,
);

layer(harnessLayer())((test) => {
	test.effect(
		"finalizes one attempt and does nothing when its settled job runs again",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				yield* execute();
				expect(yield* harness.children).toEqual([`${identity.executionId}-sandbox`]);
				const outcomes = yield* harness.outcomes;
				expect(outcomes).toHaveLength(1);
				expect(outcomes[0]?.returnedValue).toEqual({ changes: hookChanges });
				const written = yield* harness.written;
				expect(written).toHaveLength(1);
				expect(written[0]).toMatchObject({
					changes: hookChanges,
					prepared: {
						principal: {
							scriptId: run.sandboxScriptId,
							subject: { runId: run.id, stage: "after" },
						},
					},
				});
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		overrides: {
			runSandbox: () =>
				Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: { written: "through a host call" },
				}),
		},
	}),
)((test) => {
	test.effect(
		"fails an after hook whose output is not a change set result without committing",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				expect((yield* harness.outcomes)[0]).toMatchObject({
					status: "failed",
					failureKind: "invalid-output",
				});
				expect(yield* harness.written).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		overrides: {
			runSandbox: () => Effect.die("Terminalized claims must not run a sandbox"),
			prepare: () => Effect.die("Terminalized claims must not prepare an invocation"),
			claim: () => Effect.succeed({ attempt: null, claimed: false, stage: "after" as const }),
		},
	}),
)((test) => {
	test.effect(
		"completes a terminalized claim without preparing or running a sandbox attempt",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				expect(yield* harness.outcomes).toEqual([]);
				expect(yield* harness.children).toEqual([]);
			}),
		testTimeout,
	);
});

layer(harnessLayer({ failFirstFinalize: true }))((test) => {
	test.effect(
		"resumes the same child after a finalization failure instead of advancing the attempt",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				assertExitFails(
					yield* Effect.exit(execute()),
					new DbError({ message: "handoff unavailable" }),
				);
				yield* execute();
				expect(yield* harness.children).toEqual([
					`${identity.executionId}-sandbox`,
					`${identity.executionId}-sandbox`,
				]);
				expect((yield* harness.outcomes).map(({ attemptNumber }) => attemptNumber)).toEqual([1]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		overrides: {
			runSandbox: () =>
				Effect.succeed({ logs: [], value: 1, error: null, status: "completed" as const }),
		},
	}),
)((test) => {
	test.effect(
		"finalizes invalid output and sandbox timeout without creating another attempt",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				expect((yield* harness.outcomes)[0]?.failureKind).toBe("invalid-output");
				yield* harness.reset({
					overrides: {
						runSandbox: () =>
							Effect.succeed(
								sandboxExecutionFailure(
									new SandboxRunError({
										kind: "timeout",
										message: "Sandbox timed out after 30000ms",
									}),
								),
							),
					},
				});
				yield* execute();
				const outcomes = yield* harness.outcomes;
				expect(outcomes).toHaveLength(1);
				expect(outcomes[0]?.failureKind).toBe("sandbox-timeout");
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		overrides: {
			runSandbox: () =>
				Effect.succeed(
					sandboxExecutionFailure(
						new SandboxRunError({
							kind: "script-failure",
							message: "Rule declined the request",
							data: {
								code: "operation-rejected",
								reason: { namespace: "test", key: "test.declined" },
							},
						}),
					),
				),
		},
	}),
)((test) => {
	test.effect(
		"records an operation rejection as a business failure with its code",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				expect((yield* harness.outcomes)[0]).toMatchObject({
					failureKind: "business-failure",
					error: { code: "operation-rejected", message: "Rule declined the request" },
				});
			}),
		testTimeout,
	);
});

layer(harnessLayer({ trigger: { ...trigger, payload: null } }))((test) => {
	test.effect(
		"finalizes missing retained input before dispatch",
		() =>
			Effect.gen(function* () {
				const harness = yield* RunJobHarness;
				yield* execute();
				expect((yield* harness.outcomes)[0]).toMatchObject({
					failureKind: "missing-artifact",
					error: {
						code: "missing-artifact",
						message: "Retained automation trigger payload is unavailable",
					},
				});
				expect(yield* harness.children).toEqual([]);
			}),
		testTimeout,
	);
});

const classify = (kind: SandboxFailureKind) =>
	classifyAutomationSandboxError({ kind, phase: "execute", message: "failed" });

it("classifies an operation rejection raised by an automation script as a business failure", () => {
	expect(
		classifyAutomationSandboxError({
			phase: "execute",
			message: "Not allowed",
			kind: "script-failure",
			data: { code: "operation-rejected", reason: { namespace: "test", key: "test.declined" } },
		}),
	).toBe("business-failure");
});

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
