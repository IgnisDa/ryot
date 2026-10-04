import { describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
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
	Scope,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	ProviderHttpAdmissionService,
	ProviderHttpAdmissionUnavailable,
	type ProviderHttpClaim,
	type ProviderHttpPoll,
	type ProviderHttpRegistration,
	type ProviderHttpTicket,
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
	updateEvents: unusedStep,
	deleteEvents: unusedStep,
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
		updateEvents: unused,
		deleteEvents: unused,
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
		requestEventStreamWork: unused,
		changeUserRelationships: unused,
		upsertGlobalRelationships: unused,
		invalidateOAuthAccessToken: unused,
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
	lane: "background" as const,
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
		runtimeImports: [],
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
	poll: () => Effect.die("unused"),
	block: () => Effect.die("unused"),
	claim: () => Effect.die("unused"),
	cancel: () => Effect.die("unused"),
	register: () => Effect.die("unused"),
};

const dispatcherLayer = (options: {
	readonly script: typeof script;
	readonly engine: WorkflowEngine["Service"];
	readonly instance: WorkflowInstance["Service"];
	readonly httpClient?: HttpClient.HttpClient;
	readonly implementations?: SandboxHostImplementations["Service"];
	readonly lifecycleExecution?: Layer.Layer<LifecycleExecution>;
	readonly resolve?: PluginHttpRateLimitAuthority["Service"]["resolve"];
	readonly admission?: Partial<ProviderHttpAdmissionService["Service"]>;
}) =>
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.succeed(
					HttpClient.HttpClient,
					options.httpClient ?? HttpClient.make(() => Effect.die("unused")),
				),
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
					lane: "background" as const,
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

class RecordedImportHostInputs extends Context.Service<
	RecordedImportHostInputs,
	{ readonly inputs: Effect.Effect<ReadonlyArray<unknown>> }
>()("test/RecordedImportHostInputs") {}

const importHostDispatchLayer = Layer.unwrap(
	Effect.gen(function* () {
		const inputs = yield* Ref.make<ReadonlyArray<unknown>>([]);
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, "run-1-import");
		const engine = makeWorkflowActivityEngine(instance, {
			activityExecute: (activity) =>
				Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
		});
		const hostImplementations: SandboxHostImplementations["Service"] = {
			...implementations,
			additional: {
				...implementations.additional,
				getUserSettings: (input) =>
					append(inputs, {
						context: input.context,
						executionId: input.executionId,
						subject: input.principal.subject,
					}).pipe(Effect.as({ timezone: "America/Los_Angeles" })),
			},
		};
		return Layer.mergeAll(
			dispatcherLayer({
				engine,
				instance,
				implementations: hostImplementations,
				script: { ...script, metadata: { ...script.metadata, capabilities: ["getUserSettings"] } },
			}),
			Layer.succeed(RecordedImportHostInputs, { inputs: Ref.get(inputs) }),
		);
	}),
);

layer(importHostDispatchLayer)((test) => {
	test.effect("dispatches durable import host calls with their trusted run subject", () =>
		Effect.gen(function* () {
			const importRunId = ImportRunId.make("run-1");
			const importSubject = {
				importRunId,
				type: "user" as const,
				userId: UserId.make("user-1"),
				accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
			};
			const importedPrincipal: SandboxExecutionPrincipal = {
				...principal,
				subject: importSubject,
				metadata: { ...principal.metadata, capabilities: ["getUserSettings"] },
			};
			const context = { runId: "forged-run" };
			const executionId = `${importRunId}-import`;
			const dispatcher = yield* SandboxDurableHostDispatcher;

			expect(
				yield* dispatcher.dispatch(
					{
						index: 1,
						kind: "host",
						name: "getUserSettings",
						args: { args: [], capability: "getUserSettings" },
					},
					{
						scriptId,
						executionId,
						input: context,
						lane: "background",
						subject: importSubject,
						resolutionMode: "exact",
						startedAt: "2026-08-06T00:00:00.000Z",
					},
					importedPrincipal,
					executionId,
				),
			).toEqual({ state: "success", value: { timezone: "America/Los_Angeles" } });
			expect(yield* (yield* RecordedImportHostInputs).inputs).toEqual([
				{ context, subject: importSubject, executionId: "run-1-import-host-1" },
			]);
		}),
	);
});

const providerOrigin = "https://provider.test";

const httpPolicy = (
	key = "provider",
	intervalMs = 10_000,
	origin = providerOrigin,
): Extract<HttpRateLimitAuthorityResolution, { readonly matched: true }> => ({
	origin,
	matched: true,
	hash: `${key}-hash`,
	declaration: { key, intervalMs, requests: 1, origins: [origin] },
});

const unmatched = (origin = providerOrigin) =>
	({
		origin,
		matched: false,
		reason: "undeclared-origin",
	}) as const satisfies HttpRateLimitAuthorityResolution;

type HttpOutcome = Readonly<{ status: number; headers?: Readonly<Record<string, string>> }>;

type ScriptedResolution = HttpRateLimitAuthorityResolution | "fail";

type CapturedLog = Readonly<{
	message: string;
	logLevel: string;
	annotations: Readonly<Record<string, unknown>>;
}>;

class HttpDispatchHarness extends Context.Service<
	HttpDispatchHarness,
	{
		readonly instance: WorkflowInstance["Service"];
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly logs: Effect.Effect<ReadonlyArray<CapturedLog>>;
		readonly clockNames: Effect.Effect<ReadonlyArray<string>>;
		readonly activityNames: Effect.Effect<ReadonlyArray<string>>;
		readonly clockDurations: Effect.Effect<ReadonlyArray<number>>;
		readonly registered: Effect.Effect<ReadonlyArray<ProviderHttpTicket>>;
	}
>()("test/HttpDispatchHarness") {}

const httpExecutionId = "sandbox-http-parent";

const nextIndex = (cursor: Ref.Ref<number>) => Ref.getAndUpdate(cursor, (index) => index + 1);

const at = <A>(items: ReadonlyArray<A>, index: number) => items[Math.min(index, items.length - 1)];

const unavailable = new ProviderHttpAdmissionUnavailable({ message: "Redis is down" });

const httpDispatchLayer = (options: {
	readonly blockObservedAtMs?: number;
	readonly outcomes: ReadonlyArray<HttpOutcome>;
	readonly claims?: ReadonlyArray<ProviderHttpClaim>;
	readonly polls?: ReadonlyArray<ProviderHttpPoll | "fail">;
	readonly registrations?: ReadonlyArray<ProviderHttpRegistration | "fail">;
	readonly resolutions?: Readonly<Record<string, ReadonlyArray<ScriptedResolution>>>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const logs = yield* Ref.make<ReadonlyArray<CapturedLog>>([]);
			const clockNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const activityNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const clockDurations = yield* Ref.make<ReadonlyArray<number>>([]);
			const registered = yield* Ref.make<ReadonlyArray<ProviderHttpTicket>>([]);
			const httpCalls = yield* Ref.make(0);
			const pollIndex = yield* Ref.make(0);
			const claimIndex = yield* Ref.make(0);
			const registrationIndex = yield* Ref.make(0);
			const resolutionIndex = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
			const record = (event: string) => append(events, event);

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
			const httpClient = HttpClient.make((_request, url) =>
				Effect.gen(function* () {
					const call = yield* nextIndex(httpCalls);
					yield* record(`http:${_request.method} ${url.toString()}`);
					const outcome = at(options.outcomes, call);
					if (!outcome) {
						return yield* Effect.die("missing HTTP outcome");
					}
					return HttpClientResponse.fromWeb(
						_request,
						new Response("sensitive response body", {
							status: outcome.status,
							headers: outcome.headers ?? {},
						}),
					);
				}),
			);
			const resolve = (url: string) =>
				Effect.gen(function* () {
					const origin = new URL(url).origin;
					const scripted = options.resolutions?.[origin] ?? [unmatched(origin)];
					const index = (yield* Ref.get(resolutionIndex)).get(origin) ?? 0;
					yield* Ref.update(resolutionIndex, (all) => new Map(all).set(origin, index + 1));
					const resolution = at(scripted, index);
					yield* record(`resolve:${origin}:${resolution === "fail" ? "fail" : "ok"}`);
					return resolution === "fail" || resolution === undefined
						? yield* new DbError({ message: "database unavailable" })
						: resolution;
				});
			const scriptedAdmission = <A extends { readonly status: string }>(
				label: string,
				scripted: ReadonlyArray<A | "fail"> | undefined,
				cursor: Ref.Ref<number>,
				fallback: A,
			) =>
				Effect.gen(function* () {
					const next = (scripted && at(scripted, yield* nextIndex(cursor))) ?? fallback;
					yield* record(`${label}:${typeof next === "string" ? next : next.status}`);
					return next === "fail" ? yield* unavailable : next;
				});

			return Layer.mergeAll(
				dispatcherLayer({
					engine,
					resolve,
					instance,
					httpClient,
					script: { ...script, metadata: { ...script.metadata, capabilities: ["httpCall"] } },
					admission: {
						cancel: (declaration, ticket) =>
							record(`cancel:${declaration.key}:${ticket.id}`).pipe(Effect.as(undefined)),
						claim: () =>
							scriptedAdmission("claim", options.claims, claimIndex, {
								status: "admitted" as const,
							}),
						poll: () =>
							scriptedAdmission("poll", options.polls, pollIndex, {
								nonce: "nonce-1",
								status: "granted" as const,
							}),
						block: (_declaration, delayMs) =>
							record(`block:${delayMs}`).pipe(
								Effect.as({
									status: "blocked" as const,
									observedAtMs: options.blockObservedAtMs ?? 0,
									blockedUntilMs: (options.blockObservedAtMs ?? 0) + delayMs,
								}),
							),
						register: (declaration, ticket) =>
							append(registered, ticket).pipe(
								Effect.andThen(record(`register:${declaration.key}:${ticket.id}`)),
								Effect.andThen(
									scriptedAdmission("registration", options.registrations, registrationIndex, {
										status: "registered" as const,
									}),
								),
							),
					},
				}),
				Layer.succeed(HttpDispatchHarness, {
					instance,
					logs: Ref.get(logs),
					events: Ref.get(events),
					clockNames: Ref.get(clockNames),
					registered: Ref.get(registered),
					activityNames: Ref.get(activityNames),
					clockDurations: Ref.get(clockDurations),
				}),
				Logger.layer([logger]),
				Layer.succeed(References.MinimumLogLevel, "Trace"),
			);
		}),
	);

const runHttpDispatch = (
	url = `${providerOrigin}/private?token=secret`,
	args: ReadonlyArray<JsonValue> = ["GET", url],
) =>
	Effect.gen(function* () {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		return yield* dispatcher.dispatch(
			{ index: 7, kind: "host", name: "httpCall", args: { args, capability: "httpCall" } },
			{
				scriptId,
				input: {},
				lane: "background",
				resolutionMode: "exact",
				subject: principal.subject,
				executionId: httpExecutionId,
			},
			principal,
			httpExecutionId,
		);
	});

const httpEvents = (events: ReadonlyArray<string>) =>
	events.filter((event) => event.startsWith("http:"));

const ticketId = (hop: number, attempt: number) => `${httpExecutionId}:7:${hop}:${attempt}`;

const matchedOnly = { [providerOrigin]: [httpPolicy()] };

layer(httpDispatchLayer({ outcomes: [{ status: 200 }] }))((test) => {
	test.effect("skips admission for unmatched HTTP requests and runs once", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			expect(httpEvents(yield* harness.events)).toHaveLength(1);
			expect(yield* harness.registered).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-resolve-0",
				"sandbox-http-7-network-1",
			]);
		}),
	);
});

layer(httpDispatchLayer({ resolutions: matchedOnly, outcomes: [{ status: 200 }] }))((test) => {
	test.effect("reaches the network for a matched request only after its claim is admitted", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			expect(yield* harness.registered).toEqual([
				{ lane: "background", id: ticketId(0, 0), plugin: "plugin-id", tenant: "user:user-1" },
			]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-resolve-0",
				"sandbox-http-7-register-1",
				"sandbox-http-7-poll-2",
				"sandbox-http-7-claim-3",
				"sandbox-http-7-network-1",
			]);
			const events = yield* harness.events;
			expect(events.indexOf("claim:admitted")).toBeLessThan(
				events.findIndex((event) => event.startsWith("http:")),
			);
			expect(yield* harness.clockNames).toEqual([]);
			const logs = yield* harness.logs;
			expect(logs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						logLevel: "Trace",
						message: "sandbox HTTP admission claimed",
						annotations: expect.objectContaining({
							status: "admitted",
							policyKey: "provider",
							origin: providerOrigin,
							sandboxWorkflowExecutionId: httpExecutionId,
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
			expect(serializedLogs).not.toContain("user-1");
			expect(serializedLogs).not.toContain("plugin-id");
			expect(serializedLogs).not.toContain("sensitive response body");
		}),
	);
});

layer(
	httpDispatchLayer({
		resolutions: matchedOnly,
		outcomes: [{ status: 200 }],
		polls: [
			{ waitMs: 1_000, status: "wait" },
			{ status: "retry" },
			"fail",
			{ nonce: "n", status: "granted" },
		],
	}),
)((test) => {
	test.effect("sleeps the wake hint, re-resolves and polls again without re-registering", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			expect(yield* harness.registered).toHaveLength(1);
			expect(yield* harness.clockNames).toEqual([
				"sandbox-http-7-admission-wait-0",
				"sandbox-http-7-coordination-backoff-0",
			]);
			expect(yield* harness.clockDurations).toEqual([1_000, 1_000]);
			expect((yield* harness.events).filter((event) => event.startsWith("resolve:"))).toEqual([
				`resolve:${providerOrigin}:ok`,
				`resolve:${providerOrigin}:ok`,
			]);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: { [providerOrigin]: [httpPolicy("old"), httpPolicy("new")] },
		polls: [
			{ waitMs: 1_000, status: "wait" },
			{ nonce: "n", status: "granted" },
		],
	}),
)((test) => {
	test.effect("cancels the ticket and registers under the live policy when it changes", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			expect(
				(yield* harness.events).filter(
					(event) => event.startsWith("register:") || event.startsWith("cancel:"),
				),
			).toEqual([
				`register:old:${ticketId(0, 0)}`,
				`cancel:old:${ticketId(0, 0)}`,
				`register:new:${ticketId(0, 0)}`,
			]);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		polls: [{ waitMs: 1_000, status: "wait" }],
		resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
	}),
)((test) => {
	test.effect("cancels the ticket and runs once when the policy becomes unmatched", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect(events.filter((event) => event.startsWith("claim:"))).toEqual([]);
			expect(events.filter((event) => event.startsWith("cancel:"))).toEqual([
				`cancel:provider:${ticketId(0, 0)}`,
			]);
		}),
	);
});

layer(
	httpDispatchLayer({
		outcomes: [{ status: 200 }],
		resolutions: { [providerOrigin]: ["fail", httpPolicy()] },
	}),
)((test) => {
	test.effect("uses a new deterministic coordination Activity after durable backoff", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
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
		resolutions: matchedOnly,
		outcomes: [{ status: 200 }],
		claims: [{ status: "rejected" }, { status: "unknown" }, { status: "admitted" }],
	}),
)((test) => {
	test.effect("polls again after a rejected claim and re-registers the same ticket", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect((yield* harness.registered).map(({ id }) => id)).toEqual([
				ticketId(0, 0),
				ticketId(0, 0),
			]);
			expect(events.filter((event) => event.startsWith("poll:"))).toHaveLength(3);
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
			outcomes: [{ status: 429, headers: header }],
			resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
		}),
	)((test) => {
		test.effect(`uses Retry-After ${label} for the global block`, () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch()).toMatchObject({
					state: "failure",
					error: { message: "HTTP 429" },
				});
				const events = yield* harness.events;
				expect(events.filter((event) => event.startsWith("block:"))).toEqual([`block:${expected}`]);
				expect(httpEvents(events)).toHaveLength(1);
				expect(yield* harness.clockDurations).toEqual([expected]);
			}),
		);
	});
}

layer(
	httpDispatchLayer({
		resolutions: { [providerOrigin]: [httpPolicy(), httpPolicy(), httpPolicy()] },
		outcomes: [
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 200 },
		],
	}),
)((test) => {
	test.effect("retries repeated matched 429 responses with a new ticket per attempt", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(3);
			expect(events.filter((event) => event.startsWith("block:"))).toEqual(["block:0", "block:0"]);
			expect((yield* harness.registered).map(({ id }) => id)).toEqual([
				ticketId(0, 0),
				ticketId(0, 1),
				ticketId(0, 2),
			]);
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

layer(httpDispatchLayer({ resolutions: matchedOnly, outcomes: [{ status: 500 }] }))((test) => {
	test.effect("returns a non-429 HTTP failure after one attempt", () =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({
				state: "failure",
				error: { message: "HTTP 500" },
			});
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect(events.filter((event) => event.startsWith("block:"))).toEqual([]);
		}),
	);
});

describe("http_fair_tickets_preserve_durable_admission_protections", () => {
	layer(
		httpDispatchLayer({
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: ["fail", "fail", { nonce: "n", status: "granted" }],
			registrations: ["fail", { observedAtMs: 0, status: "overloaded" }, { status: "registered" }],
		}),
	)((test) => {
		test.effect("never dispatches while Redis is unavailable or the policy is overloaded", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(httpEvents(events)).toHaveLength(1);
				expect(events.indexOf("claim:admitted")).toBe(events.length - 2);
				expect(yield* harness.clockNames).toEqual([
					"sandbox-http-7-coordination-backoff-0",
					"sandbox-http-7-overload-wait-0",
					"sandbox-http-7-coordination-backoff-1",
					"sandbox-http-7-coordination-backoff-2",
				]);
				expect(yield* harness.clockDurations).toEqual([1_000, 1_000, 1_000, 2_000]);
			}),
		);
	});

	layer(httpDispatchLayer({ resolutions: matchedOnly, outcomes: [{ status: 200 }] }))((test) => {
		test.effect("admits a matched request whose options are an explicit null", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const url = `${providerOrigin}/data`;
				expect(yield* runHttpDispatch(url, ["GET", url, null])).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(events.indexOf("claim:admitted")).toBeLessThan(events.indexOf(`http:GET ${url}`));
				expect(yield* harness.registered).toHaveLength(1);
			}),
		);
	});

	layer(
		httpDispatchLayer({
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "retry-after": "7200" } }, { status: 200 }],
		}),
	)((test) => {
		test.effect("caps an honoured Retry-After at one hour", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				yield* runHttpDispatch();
				expect((yield* harness.events).filter((event) => event.startsWith("block:"))).toEqual([
					"block:3600000",
				]);
				expect(yield* harness.clockDurations).toEqual([3_600_000]);
			}),
		);
	});

	layer(
		httpDispatchLayer({
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "retry-after": "3600" } }, { status: 200 }],
			polls: [
				{ nonce: "first", status: "granted" },
				...Array.from({ length: 30 }, () => ({ waitMs: 60_000, status: "wait" as const })),
				{ nonce: "second", status: "granted" },
			],
		}),
	)((test) => {
		test.effect("bounds activities per request by the wait over the wake hint", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
				const activities = yield* harness.activityNames;
				const clocks = yield* harness.clockDurations;
				expect(clocks).toEqual([3_600_000, ...Array<number>(30).fill(60_000)]);
				expect(activities.filter((name) => name.includes("-poll-"))).toHaveLength(32);
				expect(activities.filter((name) => name.includes("-resolve-"))).toHaveLength(32);
				expect(activities).toHaveLength(32 * 2 + 2 * 2 + 1 + 2);
			}),
		);
	});

	layer(httpDispatchLayer({ resolutions: matchedOnly, outcomes: [{ status: 200 }] }))((test) => {
		test.effect("cancels the registered ticket when the workflow is interrupted", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				yield* runHttpDispatch();
				expect((yield* harness.events).filter((event) => event.startsWith("cancel:"))).toEqual([]);
				harness.instance.interrupted = true;
				yield* Scope.close(harness.instance.scope, Exit.void);
				expect((yield* harness.events).filter((event) => event.startsWith("cancel:"))).toEqual([
					`cancel:provider:${ticketId(0, 0)}`,
				]);
			}),
		);
	});
});

const openOrigin = "https://open.test";

describe("sandbox_http_redirects_admit_every_matched_hop", () => {
	layer(
		httpDispatchLayer({
			resolutions: matchedOnly,
			outcomes: [{ status: 302, headers: { location: `${providerOrigin}/data` } }, { status: 200 }],
		}),
	)((test) => {
		test.effect("admits the matched hop of an unmatched redirect before requesting it", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch(`${openOrigin}/start`)).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(httpEvents(events)).toEqual([
					`http:GET ${openOrigin}/start`,
					`http:GET ${providerOrigin}/data`,
				]);
				expect(events.indexOf("claim:admitted")).toBeLessThan(
					events.indexOf(`http:GET ${providerOrigin}/data`),
				);
				expect((yield* harness.registered).map(({ id }) => id)).toEqual([ticketId(1, 0)]);
				expect((yield* harness.activityNames).filter((name) => name.includes("-network-"))).toEqual(
					["sandbox-http-7-network-1", "sandbox-http-7-network-2"],
				);
			}),
		);
	});

	layer(
		httpDispatchLayer({
			resolutions: matchedOnly,
			outcomes: [{ status: 307, headers: { location: `${providerOrigin}/loop` } }],
		}),
	)((test) => {
		test.effect("counts the hop cap across durable network activities", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch(`${openOrigin}/start`)).toEqual({
					state: "failure",
					error: { message: "httpCall exceeded 5 redirects" },
				});
				expect(httpEvents(yield* harness.events)).toHaveLength(6);
				expect((yield* harness.registered).map(({ id }) => id)).toEqual(
					[1, 2, 3, 4, 5].map((hop) => ticketId(hop, 0)),
				);
			}),
		);
	});

	layer(
		httpDispatchLayer({
			resolutions: { [providerOrigin]: ["fail", "fail", httpPolicy()] },
			outcomes: [{ status: 302, headers: { location: `${providerOrigin}/data` } }, { status: 200 }],
		}),
	)((test) => {
		test.effect("sends nothing to a redirect target whose policy lookup fails", () =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				yield* runHttpDispatch(`${openOrigin}/start`);
				const events = yield* harness.events;
				const target = events.indexOf(`http:GET ${providerOrigin}/data`);
				expect(events.slice(0, target)).toEqual(
					expect.arrayContaining([
						`resolve:${providerOrigin}:fail`,
						`resolve:${providerOrigin}:fail`,
						"claim:admitted",
					]),
				);
				expect(httpEvents(events)).toHaveLength(2);
			}),
		);
	});
});

const interruptedExecutionId = "sandbox-http-interrupted";

const interruptedDispatchLayer = Layer.unwrap(
	Effect.sync(() => {
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, interruptedExecutionId);
		return dispatcherLayer({
			instance,
			resolve: () => Effect.succeed(unmatched()),
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
						lane: "background",
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
	lane: "background" as const,
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
