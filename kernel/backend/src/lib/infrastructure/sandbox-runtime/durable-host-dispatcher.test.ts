import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	SandboxProviderId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	Logger,
	MutableRef,
	References,
	Ref,
} from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	type ProviderHttpAdmissionConfirmation,
	ProviderHttpAdmissionService,
	type ProviderHttpAdmissionToken,
} from "#lib/infrastructure/provider-http-admission";
import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxLifecycleHostFailure } from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { NotificationDeliveryWorkflow } from "#modules/notifications/notification-delivery-workflow";
import {
	type HttpRateLimitAuthorityResolution,
	PluginHttpRateLimitAuthority,
} from "#modules/plugins/http-rate-limit-authority";
import {
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";

import { SandboxDurableHostDispatcherLive } from "./durable-host-dispatcher";

const unused = () => Effect.fail({ message: "unused" });
const unusedStep = {
	value: () => [],
	validate: unused,
	commit: () => Effect.die("unused"),
	prepare: () => Effect.die("unused"),
	applyPolicies: () => Effect.die("unused"),
};
const unusedLifecycle: SandboxHostImplementations["Service"]["lifecycle"] = {
	upsertGlobalEntities: unusedStep,
	changeUserRelationships: unusedStep,
	upsertGlobalRelationships: unusedStep,
};
const unusedLifecycleExecution = Layer.mock(LifecycleExecution)({
	dispatch: () => Effect.die("unused"),
});
const implementations: SandboxHostImplementations["Service"] = {
	lifecycle: unusedLifecycle,
	automation: { emitSignal: unused, sendNotification: unused },
	runtime: {
		httpCall: unused,
		getCachedValue: unused,
		setCachedValue: unused,
		getPersistentValue: unused,
		claimPersistentValue: unused,
	},
	additional: {
		createEvents: unused,
		executeRyotql: unused,
		getPluginConfig: unused,
		getUserSettings: unused,
		getEntitySchemas: unused,
		listEventSchemas: unused,
		listIntegrations: unused,
		getUserPreferences: unused,
		ensureUserEntities: unused,
		getOAuthAccessToken: unused,
		upsertGlobalEntities: unused,
		getCurrentIntegration: unused,
		changeUserRelationships: unused,
		upsertGlobalRelationships: unused,
	},
};

const scriptId = SandboxScriptId.make("script-1");
const runId = AutomationRunId.make("automation-run-1");
const triggerId = AutomationTriggerId.make("automation-trigger-1");
const causation = {
	depth: 0,
	parentRunId: null,
	parentTriggerId: null,
	source: "api" as const,
	executionId: AutomationExecutionId.make("root-execution"),
	rootExecutionId: AutomationExecutionId.make("root-execution"),
	initiator: { kind: "user" as const, id: UserId.make("user-1") },
};
const subject = {
	runId,
	causation,
	triggerId,
	stage: "after" as const,
	type: "automation-run" as const,
	pluginId: PluginId.make("plugin-id"),
	executionUserId: UserId.make("user-1"),
	pluginRevisionId: PluginRevisionId.make("plugin-revision"),
	pluginConfigRevisionId: PluginConfigRevisionId.make("plugin-config-revision"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};
const script = {
	source: "",
	id: scriptId,
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	name: "Dispatcher",
	slug: "dispatcher",
	contentHash: "hash",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	pluginSlug: "test-plugin",
	metadata: {
		name: "Dispatcher",
		slug: "dispatcher",
		oauthConnectionFields: [],
		executableDependencies: [],
		kind: "automation" as const,
		requiredPluginConfigKeys: [],
		optionalPluginConfigKeys: [],
		capabilities: ["emitSignal", "httpCall", "sendNotification"],
	},
};
const principal = {
	subject,
	scriptId,
	providerId: null,
	scriptSlug: script.slug,
	metadata: script.metadata,
	contentHash: script.contentHash,
	pluginRevision: {
		ownerId: null,
		compiledHashes: {},
		workflowScripts: {},
		id: subject.pluginId,
		slug: script.pluginSlug,
		scope: "system" as const,
		userBootstrapScriptSlugs: [],
		revisionId: subject.pluginRevisionId,
		configRevisionId: subject.pluginConfigRevisionId,
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
};

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const unusedAdmission = {
	block: () => Effect.die("unused"),
	confirm: () => Effect.die("unused"),
	reserve: () => Effect.die("unused"),
};

const dispatcherLayer = (options: {
	readonly script: typeof script;
	readonly engine: WorkflowEngine["Service"];
	readonly instance: WorkflowInstance["Service"];
	readonly implementations?: SandboxHostImplementations["Service"];
	readonly lifecycleExecution?: Layer.Layer<LifecycleExecution>;
	readonly resolve?: PluginHttpRateLimitAuthority["Service"]["resolve"];
	readonly admission?: Partial<ProviderHttpAdmissionService["Service"]>;
}) =>
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.succeed(WorkflowEngine, options.engine),
				Layer.succeed(WorkflowInstance, options.instance),
				options.lifecycleExecution ?? unusedLifecycleExecution,
				Layer.succeed(SandboxHostImplementations, options.implementations ?? implementations),
				Layer.mock(SandboxRepository)({ getScript: () => Effect.succeed(options.script) }),
				Layer.mock(PluginHttpRateLimitAuthority)({
					resolve: options.resolve ?? (() => Effect.die("unused")),
				}),
				Layer.mock(ProviderHttpAdmissionService)({ ...unusedAdmission, ...options.admission }),
			),
		),
	);

type WorkflowExecution = Readonly<{
	workflow: unknown;
	options: Parameters<WorkflowEngine["Service"]["execute"]>[1];
}>;

class RecordedWorkflowExecutions extends Context.Service<
	RecordedWorkflowExecutions,
	{ readonly executions: Effect.Effect<ReadonlyArray<WorkflowExecution>> }
>()("test/RecordedWorkflowExecutions") {}

const childOwnerExecutionId = "sandbox-parent";

const childOwnerDispatchLayer = Layer.unwrap(
	Effect.gen(function* () {
		const executions = yield* Ref.make<ReadonlyArray<WorkflowExecution>>([]);
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, childOwnerExecutionId);
		const engine = makeWorkflowActivityEngine(instance, {
			execute: (workflow, options) =>
				append(executions, { options, workflow }).pipe(
					Effect.as(
						workflow.name === SandboxDurableHostServiceWorkflow.name
							? { state: "success", value: { wasCreated: true, triggerId: "signal-trigger-1" } }
							: options.executionId,
					),
				),
		});
		return Layer.merge(
			dispatcherLayer({ engine, script, instance }),
			Layer.succeed(RecordedWorkflowExecutions, { executions: Ref.get(executions) }),
		);
	}),
);

layer(childOwnerDispatchLayer)((test) => {
	test.effect(
		"dispatches workflow-owned capabilities through their deterministic child owners",
		() =>
			Effect.gen(function* () {
				const executionId = childOwnerExecutionId;
				const payload = {
					subject,
					scriptId,
					executionId,
					resolutionMode: "exact" as const,
					startedAt: "2026-08-06T00:00:00.000Z",
					input: {
						automation: {
							runId,
							causation,
							triggerId,
							hookSlug: "dispatcher",
							occurredAt: "2026-08-06T00:00:00.000Z",
							executionUserId: subject.executionUserId,
							payload: {
								properties: {},
								operation: "emit",
								resource: "signal",
								category: "signal",
								signalSchemaPluginId: null,
								signalSchemaSlug: "fixture.signal",
								actorUserId: subject.executionUserId,
							},
						},
					},
				};
				const dispatcher = yield* SandboxDurableHostDispatcher;
				expect(
					yield* dispatcher.dispatch(
						{
							index: 0,
							kind: "host",
							name: "emitSignal",
							args: { args: [], capability: "emitSignal" },
						},
						payload,
						principal,
						executionId,
					),
				).toEqual({ state: "success", value: { wasCreated: true, triggerId: "signal-trigger-1" } });
				expect(
					yield* dispatcher.dispatch(
						{
							index: 1,
							kind: "host",
							name: "sendNotification",
							args: { args: ["Ready"], capability: "sendNotification" },
						},
						payload,
						principal,
						executionId,
					),
				).toEqual({ value: null, state: "success" });
				expect(yield* (yield* RecordedWorkflowExecutions).executions).toMatchObject([
					{
						workflow: SandboxDurableHostServiceWorkflow,
						options: { executionId: "sandbox-parent-host-service-0" },
					},
					{
						workflow: NotificationDeliveryWorkflow,
						options: { discard: true, executionId: "automation-run-1-host-1-notification" },
					},
				]);
			}),
	);
});

const httpPolicy = (
	key = "provider",
	intervalMs = 10_000,
): Extract<HttpRateLimitAuthorityResolution, { readonly matched: true }> => ({
	matched: true,
	hash: `${key}-hash`,
	origin: "https://provider.test",
	declaration: { key, intervalMs, requests: 1, origins: ["https://provider.test"] },
});

const unmatched = {
	matched: false,
	reason: "undeclared-origin",
	origin: "https://provider.test",
} as const satisfies HttpRateLimitAuthorityResolution;

type HttpOutcome = Readonly<{ status: number; headers?: Readonly<Record<string, string>> }>;

type CapturedLog = Readonly<{
	message: string;
	logLevel: string;
	annotations: Readonly<Record<string, unknown>>;
}>;

class HttpDispatchHarness extends Context.Service<
	HttpDispatchHarness,
	{
		readonly calls: Effect.Effect<number>;
		readonly confirms: Effect.Effect<number>;
		readonly blocks: Effect.Effect<ReadonlyArray<number>>;
		readonly logs: Effect.Effect<ReadonlyArray<CapturedLog>>;
		readonly clockNames: Effect.Effect<ReadonlyArray<string>>;
		readonly activityNames: Effect.Effect<ReadonlyArray<string>>;
		readonly clockDurations: Effect.Effect<ReadonlyArray<number>>;
		readonly reservationKeys: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/HttpDispatchHarness") {}

const httpExecutionId = "sandbox-http-parent";

const nextIndex = (cursor: Ref.Ref<number>) => Ref.getAndUpdate(cursor, (index) => index + 1);

const at = <A>(items: ReadonlyArray<A>, index: number) => items[Math.min(index, items.length - 1)];

const httpDispatchLayer = (options: {
	readonly resolveFailures?: number;
	readonly blockObservedAtMs?: number;
	readonly outcomes: ReadonlyArray<HttpOutcome>;
	readonly resolutions: ReadonlyArray<HttpRateLimitAuthorityResolution>;
	readonly confirmations?: ReadonlyArray<ProviderHttpAdmissionConfirmation>;
	readonly reservations?: ReadonlyArray<
		Pick<ProviderHttpAdmissionToken, "eligibleAtMs" | "observedAtMs">
	>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make(0);
			const confirms = yield* Ref.make(0);
			const blocks = yield* Ref.make<ReadonlyArray<number>>([]);
			const logs = yield* Ref.make<ReadonlyArray<CapturedLog>>([]);
			const clockNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const activityNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const clockDurations = yield* Ref.make<ReadonlyArray<number>>([]);
			const reservationKeys = yield* Ref.make<ReadonlyArray<string>>([]);
			const resolutionIndex = yield* Ref.make(0);
			const reservationIndex = yield* Ref.make(0);
			const confirmationIndex = yield* Ref.make(0);
			const remainingResolveFailures = yield* Ref.make(options.resolveFailures ?? 0);

			const logger = Logger.make<unknown, void>((entry) =>
				MutableRef.update(logs.ref, (all) => [
					...all,
					{
						logLevel: entry.logLevel,
						message: String(entry.message),
						annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
					},
				]),
			);
			const instance = WorkflowInstance.initial(SandboxScriptWorkflow, httpExecutionId);
			let engine: WorkflowEngine["Service"];
			engine = makeWorkflowActivityEngine(instance, {
				deferredResult: () => Effect.succeedSome(Exit.void),
				scheduleClock: (_workflow, scheduled) =>
					append(clockNames, scheduled.clock.name).pipe(
						Effect.andThen(append(clockDurations, Duration.toMillis(scheduled.clock.duration))),
					),
				activityExecute: (activity) =>
					Effect.gen(function* () {
						yield* append(activityNames, activity.name);
						const exit = yield* Effect.exit(
							activity.execute.pipe(
								Effect.provideService(WorkflowEngine, engine),
								Effect.provideService(WorkflowInstance, instance),
							),
						);
						return new Workflow.Complete({ exit });
					}),
			});
			const httpScript = {
				...script,
				metadata: { ...script.metadata, capabilities: ["httpCall"] },
			};
			const httpImplementations: SandboxHostImplementations["Service"] = {
				...implementations,
				runtime: {
					...implementations.runtime,
					httpCall: () =>
						Effect.flatMap(nextIndex(calls), (call) => {
							const outcome = at(options.outcomes, call);
							if (!outcome) {
								return Effect.die("missing HTTP outcome");
							}
							const data = {
								status: outcome.status,
								headers: outcome.headers ?? {},
								body: "sensitive response body",
							};
							return outcome.status >= 200 && outcome.status < 300
								? Effect.succeed(data)
								: Effect.fail({ data, message: `HTTP ${outcome.status}` });
						}),
				},
			};

			return Layer.mergeAll(
				dispatcherLayer({
					engine,
					instance,
					script: httpScript,
					implementations: httpImplementations,
					resolve: () =>
						Effect.gen(function* () {
							const remaining = yield* Ref.getAndUpdate(remainingResolveFailures, (n) => n - 1);
							if (remaining > 0) {
								return yield* new DbError({ message: "database unavailable" });
							}
							const resolution = at(options.resolutions, yield* nextIndex(resolutionIndex));
							return resolution ?? (yield* Effect.die("missing resolution"));
						}),
					admission: {
						block: (_declaration, blockedUntilMs) =>
							append(blocks, blockedUntilMs).pipe(
								Effect.as({
									blockedUntilMs,
									status: "blocked" as const,
									observedAtMs: options.blockObservedAtMs ?? 0,
								}),
							),
						confirm: () =>
							Effect.gen(function* () {
								yield* Ref.update(confirms, (count) => count + 1);
								const index = yield* nextIndex(confirmationIndex);
								return (
									(options.confirmations && at(options.confirmations, index)) ?? {
										status: "admitted" as const,
									}
								);
							}),
						reserve: (declaration) =>
							Effect.gen(function* () {
								yield* append(reservationKeys, declaration.key);
								const index = yield* nextIndex(reservationIndex);
								const reservation = (options.reservations && at(options.reservations, index)) ?? {
									eligibleAtMs: 10_000,
									observedAtMs: 10_000,
								};
								return { ...reservation, declarationHash: declaration.hash };
							}),
					},
				}),
				Layer.succeed(HttpDispatchHarness, {
					logs: Ref.get(logs),
					calls: Ref.get(calls),
					blocks: Ref.get(blocks),
					confirms: Ref.get(confirms),
					clockNames: Ref.get(clockNames),
					activityNames: Ref.get(activityNames),
					clockDurations: Ref.get(clockDurations),
					reservationKeys: Ref.get(reservationKeys),
				}),
				Logger.layer([logger]),
				Layer.succeed(References.MinimumLogLevel, "Trace"),
			);
		}),
	);

const runHttpDispatch = Effect.gen(function* () {
	const dispatcher = yield* SandboxDurableHostDispatcher;
	return yield* dispatcher.dispatch(
		{
			index: 7,
			kind: "host",
			name: "httpCall",
			args: { capability: "httpCall", args: ["GET", "https://provider.test/private?token=secret"] },
		},
		{
			scriptId,
			input: {},
			resolutionMode: "exact",
			subject: principal.subject,
			executionId: httpExecutionId,
		},
		principal,
		httpExecutionId,
	);
});

layer(httpDispatchLayer({ resolutions: [unmatched], outcomes: [{ status: 200 }] }))((test) => {
	test.effect("skips admission for unmatched HTTP requests and runs once", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch).toMatchObject({ state: "success" });
			expect(yield* harness.calls).toBe(1);
			expect(yield* harness.reservationKeys).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-resolve-0",
				"sandbox-http-7-network-1",
			]);
		}),
	);
});

layer(httpDispatchLayer({ outcomes: [{ status: 200 }], resolutions: [httpPolicy()] }))((test) => {
	test.effect("admits an immediate matched reservation", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch).toMatchObject({ state: "success" });
			expect(yield* harness.reservationKeys).toEqual(["provider"]);
			expect(yield* harness.confirms).toBe(0);
			expect(yield* harness.clockNames).toEqual([]);
			const logs = yield* harness.logs;
			expect(logs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						logLevel: "Trace",
						message: "sandbox HTTP policy resolution completed",
						annotations: expect.objectContaining({
							status: "matched",
							policyKey: "provider",
							origin: "https://provider.test",
							sandboxWorkflowExecutionId: "sandbox-http-parent",
						}),
					}),
					expect.objectContaining({
						logLevel: "Trace",
						message: "sandbox HTTP admission reserved",
						annotations: expect.objectContaining({
							status: "immediate",
							policyKey: "provider",
							origin: "https://provider.test",
							sandboxWorkflowExecutionId: "sandbox-http-parent",
						}),
					}),
				]),
			);
			const serializedLogs = logs
				.flatMap(({ message, annotations }) =>
					[message].concat(Object.values(annotations).map(String)),
				)
				.join(" ");
			expect(serializedLogs).not.toContain("private");
			expect(serializedLogs).not.toContain("secret");
			expect(serializedLogs).not.toContain("sensitive response body");
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy(), httpPolicy()],
		reservations: [{ eligibleAtMs: 5_000, observedAtMs: 4_000 }],
	}),
)((test) => {
	test.effect("sleeps, re-resolves, and confirms a future reservation", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch;
			expect(yield* harness.reservationKeys).toEqual(["provider"]);
			expect(yield* harness.confirms).toBe(1);
			expect(yield* harness.clockNames).toEqual(["sandbox-http-7-admission-wait-0"]);
			expect(yield* harness.clockDurations).toEqual([1_000]);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy("old"), httpPolicy("new")],
		reservations: [
			{ eligibleAtMs: 5_000, observedAtMs: 4_000 },
			{ eligibleAtMs: 6_000, observedAtMs: 6_000 },
		],
	}),
)((test) => {
	test.effect("discards a waited slot when the live policy changes", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch;
			expect(yield* harness.reservationKeys).toEqual(["old", "new"]);
			expect(yield* harness.confirms).toBe(0);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy(), unmatched],
		reservations: [{ eligibleAtMs: 5_000, observedAtMs: 4_000 }],
	}),
)((test) => {
	test.effect("runs once without confirmation when policy becomes unmatched during a wait", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch;
			expect(yield* harness.calls).toBe(1);
			expect(yield* harness.confirms).toBe(0);
			expect(yield* harness.reservationKeys).toEqual(["provider"]);
		}),
	);
});

layer(
	httpDispatchLayer({
		resolveFailures: 1,
		resolutions: [httpPolicy()],
		outcomes: [{ status: 200 }],
	}),
)((test) => {
	test.effect("uses a new deterministic coordination Activity after durable backoff", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch;
			expect(yield* harness.clockNames).toEqual(["sandbox-http-7-coordination-backoff-0"]);
			expect((yield* harness.activityNames).slice(0, 2)).toEqual([
				"sandbox-http-7-resolve-0",
				"sandbox-http-7-resolve-1",
			]);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy(), httpPolicy()],
		reservations: [{ observedAtMs: 0, eligibleAtMs: 1_000 }],
		confirmations: [
			{ status: "later", eligibleAtMs: 5_000, observedAtMs: 2_000 },
			{ status: "admitted" },
		],
	}),
)((test) => {
	test.effect("repeats later confirmation without taking a second reservation", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch;
			expect(yield* harness.reservationKeys).toEqual(["provider"]);
			expect(yield* harness.confirms).toBe(2);
			expect(yield* harness.clockNames).toEqual([
				"sandbox-http-7-admission-wait-0",
				"sandbox-http-7-admission-wait-1",
			]);
			expect(yield* harness.clockDurations).toEqual([1_000, 3_000]);
		}),
	);
});

for (const [label, header, expected] of [
	["delta seconds", { "ReTrY-AfTeR": "7" }, 7_000],
	["HTTP date", { "retry-after": "Thu, 01 Jan 1970 00:00:05 GMT" }, 5_000],
	["malformed fallback", { "retry-after": "1.5" }, 10_000],
] as const) {
	layer(
		httpDispatchLayer({
			blockObservedAtMs: 1_000,
			resolutions: [httpPolicy(), unmatched],
			outcomes: [{ status: 429, headers: header }],
		}),
	)((test) => {
		test.effect(`uses Retry-After ${label} for the global block`, () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch).toMatchObject({
					state: "failure",
					error: { message: "HTTP 429" },
				});
				expect(yield* harness.blocks).toEqual([expected]);
				expect(yield* harness.calls).toBe(1);
				expect(yield* harness.clockDurations).toEqual([expected - 1_000]);
			}),
		);
	});
}

layer(
	httpDispatchLayer({
		resolutions: [httpPolicy(), httpPolicy(), httpPolicy()],
		outcomes: [
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 200 },
		],
	}),
)((test) => {
	test.effect("retries repeated matched 429 responses without a fixed cap", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch).toMatchObject({ state: "success" });
			expect(yield* harness.calls).toBe(3);
			expect(yield* harness.blocks).toEqual([0, 0]);
			const activityNames = yield* harness.activityNames;
			expect(activityNames.filter((name) => name.includes("-network-"))).toEqual([
				"sandbox-http-7-network-1",
				"sandbox-http-7-network-2",
				"sandbox-http-7-network-3",
			]);
			expect(activityNames.join(" ")).not.toContain("private");
			expect(activityNames.join(" ")).not.toContain("secret");
		}),
	);
});

layer(httpDispatchLayer({ resolutions: [httpPolicy()], outcomes: [{ status: 500 }] }))((test) => {
	test.effect("returns a non-429 HTTP failure after one attempt", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch).toMatchObject({
				state: "failure",
				error: { message: "HTTP 500" },
			});
			expect(yield* harness.calls).toBe(1);
			expect(yield* harness.blocks).toEqual([]);
		}),
	);
});

const interruptedExecutionId = "sandbox-http-interrupted";

const interruptedDispatchLayer = Layer.unwrap(
	Effect.sync(() => {
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, interruptedExecutionId);
		return dispatcherLayer({
			instance,
			resolve: () => Effect.succeed(unmatched),
			script: { ...script, metadata: { ...script.metadata, capabilities: ["httpCall"] } },
			engine: makeWorkflowActivityEngine(instance, { activityExecute: () => Effect.interrupt }),
		});
	}),
);

layer(interruptedDispatchLayer)((test) => {
	test.effect("does not swallow coordination interruption", () =>
		Effect.gen(function* () {
			const dispatcher = yield* SandboxDurableHostDispatcher;
			const exit = yield* Effect.exit(
				dispatcher.dispatch(
					{
						index: 0,
						kind: "host",
						name: "httpCall",
						args: { capability: "httpCall", args: ["GET", "https://provider.test"] },
					},
					{
						scriptId,
						input: {},
						resolutionMode: "exact",
						subject: principal.subject,
						executionId: interruptedExecutionId,
					},
					principal,
					interruptedExecutionId,
				),
			);
			expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
		}),
	);
});

const lifecycleCapabilities = ["changeUserRelationships", "upsertGlobalEntities"] as const;
const lifecycleScript = {
	...script,
	metadata: { ...script.metadata, capabilities: [...lifecycleCapabilities] },
};
const lifecyclePrincipal = { ...principal, metadata: lifecycleScript.metadata };
const lifecyclePayload = {
	subject,
	scriptId,
	input: {},
	resolutionMode: "exact" as const,
	executionId: "sandbox-lifecycle",
	startedAt: "2026-09-17T00:00:00.000Z",
};

type LifecycleSteps = SandboxHostImplementations["Service"]["lifecycle"];

class LifecycleDispatchHarness extends Context.Service<
	LifecycleDispatchHarness,
	{
		readonly logs: Effect.Effect<ReadonlyArray<string>>;
		readonly recorded: Effect.Effect<ReadonlyArray<string>>;
		readonly useLifecycle: (lifecycle: LifecycleSteps) => Effect.Effect<void>;
	}
>()("test/LifecycleDispatchHarness") {}

const lifecycleDispatchLayer = (options: {
	readonly warnings?: ReadonlyArray<AutomationWarning>;
	readonly lifecycle: (record: (entry: string) => Effect.Effect<void>) => LifecycleSteps;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const logs = yield* Ref.make<ReadonlyArray<string>>([]);
			const recorded = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (entry: string) => append(recorded, entry);
			const lifecycle = yield* Ref.make(options.lifecycle(record));
			const instance = WorkflowInstance.initial(
				SandboxScriptWorkflow,
				lifecyclePayload.executionId,
			);
			let engine: WorkflowEngine["Service"];
			engine = makeWorkflowActivityEngine(instance, {
				activityExecute: (activity) =>
					Effect.gen(function* () {
						yield* record(activity.name);
						const exit = yield* Effect.exit(
							activity.execute.pipe(
								Effect.provideService(WorkflowEngine, engine),
								Effect.provideService(WorkflowInstance, instance),
							),
						);
						return new Workflow.Complete({ exit });
					}),
			});
			const logger = Logger.make<unknown, void>((entry) =>
				MutableRef.update(logs.ref, (all) => [...all, String(entry.message)]),
			);
			return Layer.mergeAll(
				dispatcherLayer({
					engine,
					instance,
					script: lifecycleScript,
					implementations: {
						...implementations,
						get lifecycle() {
							return MutableRef.get(lifecycle.ref);
						},
					},
					lifecycleExecution: Layer.mock(LifecycleExecution)({
						dispatch: (plans) =>
							record(`dispatch:${plans.length}`).pipe(Effect.as(options.warnings ?? [])),
					}),
				}),
				Layer.succeed(LifecycleDispatchHarness, {
					logs: Ref.get(logs),
					recorded: Ref.get(recorded),
					useLifecycle: (next) => Ref.set(lifecycle, next),
				}),
				Logger.layer([logger]),
			);
		}),
	);

const runLifecycleDispatch = (options: {
	readonly args: ReadonlyArray<JsonValue>;
	readonly capability: (typeof lifecycleCapabilities)[number];
	readonly principal?: SandboxExecutionPrincipal;
}) =>
	Effect.flatMap(SandboxDurableHostDispatcher, (dispatcher) =>
		dispatcher.dispatch(
			{
				index: 4,
				kind: "host",
				name: options.capability,
				args: { args: options.args, capability: options.capability },
			},
			lifecyclePayload,
			options.principal ?? lifecyclePrincipal,
			lifecyclePayload.executionId,
		),
	);

const lifecycleSteps = (overrides: Record<string, unknown>) => ({
	...unusedLifecycle,
	...overrides,
});

const batch = { creates: [], deletes: [] };

const batchWarning = {
	omittedHooks: [],
	hasRequiredHooks: true,
	code: "automation-limit-reached" as const,
	triggerId: AutomationTriggerId.make("batch-trigger"),
};

layer(
	lifecycleDispatchLayer({
		warnings: [batchWarning],
		lifecycle: () =>
			lifecycleSteps({
				changeUserRelationships: {
					commit: () => Effect.die("no commit"),
					applyPolicies: () => Effect.die("no policies"),
					value: (results: ReadonlyArray<{ created: number; deleted: number }>) =>
						results.map(({ created, deleted }) => ({ created, deleted })),
					prepare: (_input: unknown, _batch: unknown, index: number) =>
						Effect.succeed({
							_tag: "Committed",
							result: { updated: 0, deleted: 0, created: index },
							dispatch: [{ runs: [], blockedReason: null, triggerId: `batch-${index}` }],
						}),
					validate: () =>
						Effect.succeed({
							batches: [batch, batch],
							userId: UserId.make("user-1"),
							_tag: "ChangeUserRelationships",
							command: {
								causation,
								occurredAt: "2026-09-17T00:00:00.000Z",
								itemIdentity: "changeUserRelationships",
							},
						}),
				},
			}),
	}),
)((test) => {
	test.effect("writes each relationship batch as its own step and dispatches between them", () =>
		Effect.gen(function* () {
			const harness = yield* LifecycleDispatchHarness;
			const result = yield* runLifecycleDispatch({
				args: [[batch, batch]],
				capability: "changeUserRelationships",
			});
			expect(result).toEqual({
				state: "success",
				value: [
					{ created: 0, deleted: 0 },
					{ created: 1, deleted: 0 },
				],
			});
			expect(yield* harness.recorded).toEqual([
				"sandbox-host-4-changeUserRelationships-input",
				"sandbox-host-4-changeUserRelationships-0:prepare",
				"dispatch:1",
				"sandbox-host-4-changeUserRelationships-1:prepare",
				"dispatch:1",
			]);
			expect(
				(yield* harness.logs).filter((message) => message.includes("automation warnings")),
			).toHaveLength(1);
		}),
	);
});

const policyPending = { planned: [], pending: { policies: [] } };

layer(
	lifecycleDispatchLayer({
		lifecycle: (record) =>
			lifecycleSteps({
				upsertGlobalEntities: {
					value: (results: ReadonlyArray<{ status: string }>) => results,
					applyPolicies: (value: unknown) => record("policies").pipe(Effect.as(value)),
					prepare: () => Effect.succeed({ pending: policyPending, _tag: "PoliciesRequired" }),
					commit: () =>
						Effect.succeed({
							_tag: "Committed",
							result: [{ status: "skipped" }],
							dispatch: [{ runs: [], blockedReason: null, triggerId: "upsert-trigger" }],
						}),
					validate: () =>
						Effect.succeed({
							items: [],
							options: null,
							_tag: "UpsertGlobalEntities",
							providerId: SandboxProviderId.make("provider-1"),
							command: {
								causation,
								itemIdentity: "upsertGlobalEntities",
								occurredAt: "2026-09-17T00:00:00.000Z",
							},
						}),
				},
			}),
	}),
)((test) => {
	test.effect("records the policy outcome for a global entity upsert before committing", () =>
		Effect.gen(function* () {
			const providerPrincipal = {
				...lifecyclePrincipal,
				subject: { type: "system" as const },
				providerId: SandboxProviderId.make("provider-1"),
				metadata: { ...lifecycleScript.metadata, kind: "script" as const },
			};
			const result = yield* runLifecycleDispatch({
				args: [[]],
				principal: providerPrincipal,
				capability: "upsertGlobalEntities",
			});
			expect(result).toEqual({ state: "success", value: [{ status: "skipped" }] });
			expect(yield* (yield* LifecycleDispatchHarness).recorded).toEqual([
				"sandbox-host-4-upsertGlobalEntities-input",
				"sandbox-host-4-upsertGlobalEntities-0:prepare",
				"policies",
				"sandbox-host-4-upsertGlobalEntities-0:policy-outcome",
				"sandbox-host-4-upsertGlobalEntities-0:commit",
				"dispatch:1",
			]);
		}),
	);
});

layer(lifecycleDispatchLayer({ lifecycle: () => lifecycleSteps({}) }))((test) => {
	test.effect(
		"reports invalid arguments, denied limits, and policy rejections as host failures",
		() =>
			Effect.gen(function* () {
				const harness = yield* LifecycleDispatchHarness;
				const validated = {
					batches: [batch],
					userId: UserId.make("user-1"),
					_tag: "ChangeUserRelationships",
					command: {
						causation,
						occurredAt: "2026-09-17T00:00:00.000Z",
						itemIdentity: "changeUserRelationships",
					},
				};

				expect(
					yield* runLifecycleDispatch({ args: [], capability: "changeUserRelationships" }),
				).toEqual({
					state: "failure",
					error: { message: "changeUserRelationships received an invalid number of arguments" },
				});
				yield* harness.useLifecycle(
					lifecycleSteps({
						changeUserRelationships: {
							...unusedLifecycle.changeUserRelationships,
							validate: () =>
								Effect.fail({ message: "changeUserRelationships exceeds 500 changes" }),
						},
					}),
				);
				expect(
					yield* runLifecycleDispatch({ args: [[batch]], capability: "changeUserRelationships" }),
				).toEqual({
					state: "failure",
					error: { message: "changeUserRelationships exceeds 500 changes" },
				});
				yield* harness.useLifecycle(
					lifecycleSteps({
						changeUserRelationships: {
							value: () => [],
							commit: () => Effect.die("no commit"),
							validate: () => Effect.succeed(validated),
							prepare: () => Effect.succeed({ pending: { items: [] }, _tag: "PoliciesRequired" }),
							applyPolicies: () =>
								Effect.fail(new SandboxLifecycleHostFailure({ message: "policy-rejected" })),
						},
					}),
				);
				expect(
					yield* runLifecycleDispatch({ args: [[batch]], capability: "changeUserRelationships" }),
				).toEqual({ state: "failure", error: { message: "policy-rejected" } });
			}),
	);
});
