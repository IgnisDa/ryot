import { assert, describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import type { SandboxInlineProgress } from "@ryot-app/sandbox/host/inline-progress";
import { makeSandboxShortWait } from "@ryot-app/sandbox/host/short-wait";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Logger,
	MutableRef,
	Option,
	Ref,
	References,
	Schema,
	Scope,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { NotificationDeliveryWorkflow } from "#modules/notifications/notification-delivery-workflow";
import {
	type HttpRateLimitAuthorityResolution,
	PluginHttpRateLimitAuthority,
} from "#modules/plugins/catalog/http-rate-limit-authority";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipBatchSummary } from "#modules/relationships/mutation-pipeline";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import {
	SandboxDurableHostDispatcher,
	SandboxDurableHostServiceWorkflow,
} from "#modules/scripts/host/durable-dispatcher";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { unusedSandboxHostImplementations } from "#modules/scripts/host/host-implementations.test-support";
import {
	ProviderHttpAdmissionService,
	ProviderHttpAdmissionUnavailable,
	type ProviderHttpClaim,
	type ProviderHttpPoll,
	type ProviderHttpRegistration,
	type ProviderHttpTicket,
} from "#modules/scripts/host/http-admission";
import { SandboxLifecycleHostFailure } from "#modules/scripts/host/lifecycle-host";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { type EgressPolicy, withEgressPolicy } from "#platform/egress/http-client";
import { makeWorkflowActivityEngine } from "#testing/effect";

import { SandboxDurableHostDispatcherLive } from "./durable-dispatcher-live";
import { SandboxHttpProgress } from "./http-progress";

const publicEgressPolicy: EgressPolicy = {
	allowedNetworks: [],
	resolver: { resolve: () => Effect.succeed(["93.184.215.14"]) },
};

const emptyValue = () => [];
const defaults = unusedSandboxHostImplementations().lifecycle;
const unusedLifecycle: ScriptHostImplementations["Service"]["lifecycle"] = {
	...defaults,
	upsertGlobalEntities: { ...defaults.upsertGlobalEntities, value: emptyValue },
	changeUserRelationships: { ...defaults.changeUserRelationships, value: emptyValue },
	upsertGlobalRelationships: { ...defaults.upsertGlobalRelationships, value: emptyValue },
};
const unusedLifecycleExecution = Layer.mock(LifecycleExecution)({
	dispatch: () => Effect.die("unused"),
});
const implementations = unusedSandboxHostImplementations({}, unusedLifecycle);

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
	delivery: "required" as const,
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
		scope: "system" as const,
		userBootstrapScriptSlugs: [],
		revisionId: subject.pluginRevisionId,
		packageId: fixtureManifest().metadata.packageId,
		configRevisionId: subject.pluginConfigRevisionId,
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		schemaScope: {
			eventSchemas: [],
			entitySchemaSlugs: [],
			signalSchemaSlugs: [],
			relationshipSchemaSlugs: [],
		},
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
	readonly implementations?: ScriptHostImplementations["Service"];
	readonly lifecycleExecution?: Layer.Layer<LifecycleExecution>;
	readonly resolve?: PluginHttpRateLimitAuthority["Service"]["resolve"];
	readonly admission?: Partial<ProviderHttpAdmissionService["Service"]>;
	readonly authority?: SandboxExecutionAuthority["Service"];
}) =>
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.succeed(
					SandboxExecutionAuthority,
					options.authority ?? {
						resolve: (executionPrincipal) =>
							Effect.succeed(executionPrincipal.pluginRevision?.scope ?? "system"),
					},
				),
				Layer.succeed(
					HttpClient.HttpClient,
					options.httpClient ?? HttpClient.make(() => Effect.die("unused")),
				),
				Layer.succeed(WorkflowEngine, options.engine),
				Layer.mock(SandboxSubmissionCommands)({ commandFor: () => Effect.die("unused") }),
				Layer.succeed(WorkflowInstance, options.instance),
				options.lifecycleExecution ?? unusedLifecycleExecution,
				Layer.succeed(ScriptHostImplementations, options.implementations ?? implementations),
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
		const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, childOwnerExecutionId);
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
		const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, "run-1-import");
		const engine = makeWorkflowActivityEngine(instance, {
			activityExecute: (activity) =>
				Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
		});
		const hostImplementations: ScriptHostImplementations["Service"] = {
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
			const importedPrincipal: ScriptExecutionPrincipal = {
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
const openOrigin = "https://open.test";
const withPrefix = (events: ReadonlyArray<string>, prefix: string) =>
	events.filter((event) => event.startsWith(prefix));

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

type SentHttpRequest = Readonly<{
	url: string;
	method: string;
	body: string | null;
	headers: Readonly<Record<string, string>>;
	requestInit: RequestInit | undefined;
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
		readonly requestInterrupt: Effect.Effect<void>;
		readonly registered: Effect.Effect<ReadonlyArray<ProviderHttpTicket>>;
		readonly sent: Effect.Effect<ReadonlyArray<SentHttpRequest>>;
		readonly resolvedUrls: Effect.Effect<ReadonlyArray<string>>;
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
	readonly cancelFailures?: number;
	readonly blockFailures?: number;
	readonly staleBlock?: boolean;
	readonly cachedInterruptedAdmission?: boolean;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const logs = yield* Ref.make<ReadonlyArray<CapturedLog>>([]);
			const clockNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const activityNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const clockDurations = yield* Ref.make<ReadonlyArray<number>>([]);
			const registered = yield* Ref.make<ReadonlyArray<ProviderHttpTicket>>([]);
			const sent = yield* Ref.make<ReadonlyArray<SentHttpRequest>>([]);
			const resolvedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
			const interruptRequested = yield* Ref.make(false);
			const cancellations = yield* Ref.make(0);
			const blockCalls = yield* Ref.make(0);
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
			const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, httpExecutionId);
			let engine: WorkflowEngine["Service"];
			engine = makeWorkflowActivityEngine(instance, {
				scheduleClock: (_workflow, scheduled) =>
					append(clockNames, scheduled.clock.name).pipe(
						Effect.andThen(append(clockDurations, Duration.toMillis(scheduled.clock.duration))),
					),
				deferredResult: (deferred) =>
					deferred.name === "Workflow/InterruptSignal"
						? Effect.map(Ref.get(interruptRequested), (requested) =>
								requested ? Option.some(Exit.void) : Option.none(),
							)
						: Effect.succeedSome(Exit.void),
				activityExecute: (activity) =>
					Effect.gen(function* () {
						yield* append(activityNames, activity.name);
						if (options.cachedInterruptedAdmission && activity.name.includes("-admission-")) {
							return new Workflow.Complete({
								exit: Exit.succeed({
									_tag: "Interrupted",
									cleanupPolicy: { ...httpPolicy(), durationMs: 0 },
								}),
							});
						}
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
					yield* append(sent, {
						url: url.toString(),
						method: _request.method,
						headers: { ..._request.headers },
						requestInit: Option.getOrUndefined(
							yield* Effect.serviceOption(FetchHttpClient.RequestInit),
						),
						body:
							_request.body._tag === "Uint8Array"
								? new TextDecoder().decode(_request.body.body)
								: null,
					});
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
					yield* append(resolvedUrls, url);
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
					httpClient: withEgressPolicy(httpClient, publicEgressPolicy),
					script: { ...script, metadata: { ...script.metadata, capabilities: ["httpCall"] } },
					admission: {
						claim: () =>
							scriptedAdmission("claim", options.claims, claimIndex, {
								status: "admitted" as const,
							}),
						poll: () =>
							scriptedAdmission("poll", options.polls, pollIndex, {
								nonce: "nonce-1",
								status: "granted" as const,
							}),
						cancel: (declaration, ticket) =>
							Effect.gen(function* () {
								yield* record(`cancel:${declaration.key}:${ticket.id}`);
								if ((yield* nextIndex(cancellations)) < (options.cancelFailures ?? 0)) {
									return yield* unavailable;
								}
								return undefined;
							}),
						register: (declaration, ticket) =>
							append(registered, ticket).pipe(
								Effect.andThen(record(`register:${declaration.key}:${ticket.id}`)),
								Effect.andThen(
									scriptedAdmission("registration", options.registrations, registrationIndex, {
										status: "registered" as const,
									}),
								),
							),
						block: (_declaration, delayMs) =>
							record(`block:${delayMs}`).pipe(
								Effect.andThen(
									Effect.gen(function* () {
										if ((yield* nextIndex(blockCalls)) < (options.blockFailures ?? 0)) {
											return yield* unavailable;
										}
										return undefined;
									}),
								),
								Effect.as(
									options.staleBlock
										? { status: "stale" as const }
										: {
												status: "blocked" as const,
												observedAtMs: options.blockObservedAtMs ?? 0,
												blockedUntilMs: (options.blockObservedAtMs ?? 0) + delayMs,
											},
								),
							),
					},
				}),
				Layer.succeed(HttpDispatchHarness, {
					instance,
					logs: Ref.get(logs),
					sent: Ref.get(sent),
					events: Ref.get(events),
					clockNames: Ref.get(clockNames),
					registered: Ref.get(registered),
					resolvedUrls: Ref.get(resolvedUrls),
					activityNames: Ref.get(activityNames),
					clockDurations: Ref.get(clockDurations),
					requestInterrupt: Ref.set(interruptRequested, true),
				}),
				Logger.layer([logger]),
				Layer.succeed(References.MinimumLogLevel, "Trace"),
			);
		}),
	);

const decodeHttpProgress = Schema.decodeUnknownSync(SandboxHttpProgress);

const runHttpDispatch = (
	url = `${providerOrigin}/private?token=secret`,
	args: ReadonlyArray<JsonValue> = ["GET", url],
	progress?: SandboxHttpProgress,
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
				startedAt: "2026-01-01T00:00:00.000Z",
			},
			principal,
			httpExecutionId,
			progress,
		);
	});

const runHttpDispatchOver = (elapsed: Duration.Input, url?: string) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(runHttpDispatch(url));
		yield* TestClock.adjust(elapsed);
		return yield* Fiber.join(fiber);
	});

const httpCase = (
	name: string,
	options: Parameters<typeof httpDispatchLayer>[0],
	body: () => Effect.Effect<
		void,
		unknown,
		Layer.Success<ReturnType<typeof httpDispatchLayer>> | Scope.Scope
	>,
) =>
	layer(httpDispatchLayer(options))((test) => {
		test.effect(name, body);
	});

const httpEvents = (events: ReadonlyArray<string>) => withPrefix(events, "http:");

const ticketId = (hop: number, attempt: number) => `${httpExecutionId}:7:${hop}:${attempt}`;

const matchedOnly = { [providerOrigin]: [httpPolicy()] };

const runInlineHttp = (
	url = `${providerOrigin}/private?token=secret`,
	args: ReadonlyArray<JsonValue> = ["GET", url],
) =>
	Effect.gen(function* () {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		const pending = yield* Ref.make<ReadonlyArray<SandboxInlineProgress>>([]);
		const result = yield* dispatcher.settleInline(
			[{ index: 7, kind: "host", name: "httpCall", args: { args, capability: "httpCall" } }],
			{},
			principal,
			"background",
			httpExecutionId,
			"1970-01-01T00:00:00.000Z",
			makeSandboxShortWait(),
			(entry) => append(pending, entry),
		);
		return { result, pending: yield* Ref.get(pending) };
	});

describe("live HTTP settlement admits each matched hop", () => {
	httpCase(
		"settles short admission waits without a workflow activity",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: [
				{ waitMs: 200, status: "wait" },
				{ waitMs: 300, status: "wait" },
				{ nonce: "short", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("500 millis");
				const settled = yield* Fiber.join(fiber);
				expect(settled.result).toMatchObject([{ state: "success" }]);
				expect(settled.pending.at(-1)?._tag).toBe("Completed");
				expect(yield* harness.activityNames).toEqual([]);
				const events = yield* harness.events;
				expect(events.indexOf("claim:admitted")).toBeLessThan(
					events.findIndex((event) => event.startsWith("http:")),
				);
				expect(yield* harness.registered).toHaveLength(1);
			}),
	);
	httpCase(
		"hands a long admission wait back with the same ticket",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: [
				{ waitMs: 1_001, status: "wait" },
				{ nonce: "long", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const deferred = yield* runInlineHttp();
				expect(deferred.result).toBeNull();
				expect(httpEvents(yield* harness.events)).toEqual([]);
				const progress = deferred.pending.at(-1);
				assert(progress?._tag === "Http");
				expect(
					yield* runHttpDispatch(undefined, undefined, decodeHttpProgress(progress.progress)),
				).toMatchObject({ state: "success" });
				expect((yield* harness.registered).map((ticket) => ticket.id)).toEqual([
					ticketId(0, 0),
					ticketId(0, 0),
				]);
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([]);
			}),
	);
});

describe("live HTTP settlement preserves redirect and retry semantics", () => {
	const nextOrigin = "https://next-provider.test";
	const resolutions = {
		[providerOrigin]: [httpPolicy("first", 100)],
		[nextOrigin]: [httpPolicy("next", 100, nextOrigin)],
	};
	httpCase(
		"admits a matched redirect and short retry in the same live call",
		{
			resolutions,
			outcomes: [
				{ status: 302, headers: { Location: `${nextOrigin}/target` } },
				{ status: 429, headers: { "Retry-After": "0" } },
				{ status: 200 },
			],
			polls: [
				{ nonce: "first", status: "granted" },
				{ waitMs: 100, status: "wait" },
				{ nonce: "next", status: "granted" },
				{ waitMs: 100, status: "wait" },
				{ nonce: "retry", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("200 millis");
				expect((yield* Fiber.join(fiber)).result).toMatchObject([{ state: "success" }]);
				expect((yield* harness.registered).map((ticket) => ticket.id)).toEqual([
					ticketId(0, 0),
					ticketId(1, 0),
					ticketId(1, 1),
				]);
				expect(httpEvents(yield* harness.events)).toEqual([
					`http:GET ${providerOrigin}/private?token=secret`,
					`http:GET ${nextOrigin}/target`,
					`http:GET ${nextOrigin}/target`,
				]);
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:0"]);
				expect(yield* harness.activityNames).toEqual([]);
			}),
	);
	httpCase(
		"hands off a redirect when cumulative waits exhaust the replay budget",
		{
			resolutions,
			outcomes: [{ status: 302, headers: { Location: `${nextOrigin}/target` } }, { status: 200 }],
			polls: [
				{ waitMs: 600, status: "wait" },
				{ nonce: "first", status: "granted" },
				{ waitMs: 600, status: "wait" },
				{ nonce: "next", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("600 millis");
				const deferred = yield* Fiber.join(fiber);
				expect(deferred.result).toBeNull();
				const progress = deferred.pending.at(-1);
				assert(progress?._tag === "Http");
				expect(progress.progress).toMatchObject({
					attempt: 0,
					networkAttempt: 1,
					phase: { rateLimit: null, _tag: "Admitting" },
					current: { hop: 1, url: `${nextOrigin}/target` },
				});
				expect(
					yield* runHttpDispatch(undefined, undefined, decodeHttpProgress(progress.progress)),
				).toMatchObject({ state: "success" });
				expect(httpEvents(yield* harness.events)).toEqual([
					`http:GET ${providerOrigin}/private?token=secret`,
					`http:GET ${nextOrigin}/target`,
				]);
			}),
	);
	httpCase(
		"resumes a long 429 delay without repeating its response or global block",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "Retry-After": "2" } }, { status: 200 }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const deferred = yield* runInlineHttp();
				expect(deferred.result).toBeNull();
				const progress = deferred.pending.at(-1);
				assert(progress?._tag === "Http");
				expect(progress.progress).toMatchObject({
					attempt: 1,
					networkAttempt: 1,
					phase: { blockedUntilMs: 2_000, _tag: "WaitingForRateLimitBlock" },
				});
				expect(
					yield* runHttpDispatch(undefined, undefined, decodeHttpProgress(progress.progress)),
				).toMatchObject({ state: "success" });
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:2000"]);
				expect((yield* harness.registered).map((ticket) => ticket.id)).toEqual([
					ticketId(0, 0),
					ticketId(0, 1),
				]);
				expect(httpEvents(yield* harness.events)).toHaveLength(2);
				expect(yield* harness.clockDurations).toEqual([2_000]);
			}),
	);
	httpCase(
		"retains an unapplied global block through coordination failure",
		{
			blockFailures: 2,
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "Retry-After": "0" } }, { status: 200 }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("1 second");
				const deferred = yield* Fiber.join(fiber);
				const progress = deferred.pending.at(-1);
				assert(progress?._tag === "Http");
				expect(progress.progress).toMatchObject({
					attempt: 0,
					networkAttempt: 1,
					phase: { delayMs: 0, _tag: "ApplyingRateLimitBlock" },
				});
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
				expect(
					yield* runHttpDispatch(undefined, undefined, decodeHttpProgress(progress.progress)),
				).toMatchObject({ state: "success" });
				expect((yield* harness.registered).map((ticket) => ticket.id)).toEqual([
					ticketId(0, 0),
					ticketId(0, 1),
				]);
				expect(httpEvents(yield* harness.events)).toHaveLength(2);
			}),
	);
});

describe("live HTTP waits preserve cancellation and fail-closed admission", () => {
	httpCase(
		"cancels the exact last binding retained by a deferred admission",
		{
			outcomes: [{ status: 200 }],
			resolutions: { [providerOrigin]: [httpPolicy("old"), httpPolicy("new")] },
			polls: [
				{ waitMs: 100, status: "wait" },
				{ waitMs: 1_001, status: "wait" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("100 millis");
				const deferred = yield* Fiber.join(fiber);
				const retained = deferred.pending.at(-1);
				assert(retained?._tag === "Http");
				expect(retained.progress).toMatchObject({
					phase: { _tag: "Admitting" },
					cleanup: { declaration: { key: "new" }, ticket: { id: ticketId(0, 0) } },
				});
				yield* (yield* SandboxDurableHostDispatcher).cancelInline(httpExecutionId, [retained]);
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
					`cancel:old:${ticketId(0, 0)}`,
					`cancel:new:${ticketId(0, 0)}`,
				]);
				expect(httpEvents(yield* harness.events)).toEqual([]);
			}),
	);
	httpCase(
		"cancels the old binding when live policy changes",
		{
			outcomes: [{ status: 200 }],
			resolutions: { [providerOrigin]: [httpPolicy("old"), httpPolicy("new")] },
			polls: [
				{ waitMs: 100, status: "wait" },
				{ nonce: "changed", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("100 millis");
				expect((yield* Fiber.join(fiber)).result).toMatchObject([{ state: "success" }]);
				expect(withPrefix(yield* harness.events, "register:")).toEqual([
					`register:old:${ticketId(0, 0)}`,
					`register:new:${ticketId(0, 0)}`,
				]);
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
					`cancel:old:${ticketId(0, 0)}`,
				]);
			}),
	);
	httpCase(
		"cancels a live waiting ticket when its parent interrupt arrives",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: [{ waitMs: 500, status: "wait" }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("100 millis");
				yield* harness.requestInterrupt;
				yield* TestClock.adjust("400 millis");
				expect((yield* Fiber.join(fiber)).result).toBeNull();
				expect(httpEvents(yield* harness.events)).toEqual([]);
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
					`cancel:provider:${ticketId(0, 0)}`,
				]);
			}),
	);
});

describe("HTTP continuation phase transitions", () => {
	httpCase(
		"returns the retained 429 when policy disappears during a resumed retry admission",
		{
			outcomes: [{ status: 429, headers: { "Retry-After": "0" } }],
			resolutions: { [providerOrigin]: [httpPolicy(), httpPolicy(), unmatched()] },
			polls: [
				{ nonce: "initial", status: "granted" },
				{ waitMs: 1_001, status: "wait" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const deferred = yield* runInlineHttp();
				const retained = deferred.pending.at(-1);
				assert(retained?._tag === "Http");
				expect(retained.progress).toMatchObject({
					attempt: 1,
					phase: { _tag: "Admitting", rateLimit: { error: { message: "HTTP 429" } } },
				});
				const progress = decodeHttpProgress(retained.progress);
				expect(yield* runHttpDispatch(undefined, undefined, progress)).toEqual(
					progress.phase.rateLimit,
				);
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:0"]);
			}),
	);
	for (const elapsedMs of [500, 2_500]) {
		httpCase(
			`resumes an acknowledged block after ${elapsedMs}ms without reapplying it`,
			{
				outcomes: [{ status: 429, headers: { "Retry-After": "2" } }],
				resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
			},
			() =>
				Effect.gen(function* () {
					const harness = yield* HttpDispatchHarness;
					const deferred = yield* runInlineHttp();
					const retained = deferred.pending.at(-1);
					assert(retained?._tag === "Http");
					const progress = decodeHttpProgress(retained.progress);
					assert(progress.phase._tag === "WaitingForRateLimitBlock");
					yield* TestClock.adjust(Duration.millis(elapsedMs));
					expect(yield* runHttpDispatch(undefined, undefined, progress)).toEqual(
						progress.phase.rateLimit,
					);
					expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:2000"]);
					expect(httpEvents(yield* harness.events)).toHaveLength(1);
					expect(yield* harness.clockDurations).toEqual(
						elapsedMs < 2_000 ? [2_000 - elapsedMs] : [],
					);
				}),
		);
	}
	httpCase(
		"settles a stale block without waiting or repeating the retained response",
		{
			staleBlock: true,
			outcomes: [{ status: 429, headers: { "Retry-After": "2" } }],
			resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch()).toMatchObject({
					state: "failure",
					error: { message: "HTTP 429" },
				});
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:2000"]);
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
				expect(yield* harness.clockDurations).toEqual([]);
			}),
	);
});

describe("prepared HTTP hops survive redirect handoff", () => {
	httpCase(
		"admits and executes the same normalized initial request after handoff",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: [
				{ waitMs: 1_001, status: "wait" },
				{ nonce: "initial", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const url = "https://PROVIDER.test:443/data";
				const args: ReadonlyArray<JsonValue> = [
					" post ",
					url,
					{ body: "payload", headers: { Authorization: "Bearer secret" } },
				];
				const deferred = yield* runInlineHttp(url, args);
				const retained = deferred.pending.at(-1);
				assert(retained?._tag === "Http");
				const progress = decodeHttpProgress(retained.progress);
				expect(progress.current).toMatchObject({
					hop: 0,
					method: "POST",
					body: "payload",
					url: `${providerOrigin}/data`,
					headers: { Authorization: "Bearer secret" },
				});
				expect(yield* harness.sent).toEqual([]);
				expect(yield* runHttpDispatch(url, args, progress)).toMatchObject({ state: "success" });
				expect(yield* harness.sent).toMatchObject([
					{
						method: "POST",
						body: "payload",
						url: progress.current.url,
						headers: { authorization: "Bearer secret" },
					},
				]);
				expect(yield* harness.resolvedUrls).toEqual([progress.current.url, progress.current.url]);
				expect((yield* harness.registered).map(({ id }) => id)).toEqual([
					ticketId(0, 0),
					ticketId(0, 0),
				]);
			}),
	);
	for (const status of [301, 302, 303, 307, 308]) {
		for (const crossOrigin of [false, true]) {
			const sourceOrigin = crossOrigin ? openOrigin : providerOrigin;
			const source = `${sourceOrigin}/start`;
			const target = `${providerOrigin}/target`;
			const args: ReadonlyArray<JsonValue> = [
				" post ",
				source.replace(".test/", ".test:443/"),
				{
					body: "payload",
					allowInsecureConnections: true,
					headers: {
						Cookie: "c=1",
						"X-Trace": "trace",
						"Content-Type": "text/plain",
						Authorization: "Bearer secret",
						"Proxy-Authorization": "Basic secret",
					},
				},
			];
			httpCase(
				`retains ${status} ${crossOrigin ? "cross-origin" : "same-origin"} request semantics after resume`,
				{
					resolutions: matchedOnly,
					outcomes: [{ status, headers: { Location: target } }, { status: 200 }],
					polls: [
						...(crossOrigin ? [] : [{ nonce: "source", status: "granted" as const }]),
						{ waitMs: 1_001, status: "wait" },
						{ nonce: "target", status: "granted" },
					],
				},
				() =>
					Effect.gen(function* () {
						const harness = yield* HttpDispatchHarness;
						const deferred = yield* runInlineHttp(source, args);
						const retained = deferred.pending.at(-1);
						assert(retained?._tag === "Http");
						const progress = decodeHttpProgress(retained.progress);
						const rewrite = status === 301 || status === 302 || status === 303;
						expect(retained.progress).toMatchObject({
							phase: { rateLimit: null, _tag: "Admitting" },
							current: {
								hop: 1,
								url: target,
								allowInsecureConnections: true,
								method: rewrite ? "GET" : "POST",
							},
						});
						expect((yield* harness.sent).map(({ url }) => url)).toEqual([source]);
						expect(yield* runHttpDispatch(source, args, progress)).toMatchObject({
							state: "success",
						});
						const sent = yield* harness.sent;
						expect(sent.map(({ url }) => url)).toEqual([source, target]);
						expect(sent[1]).toMatchObject({
							headers: { "x-trace": "trace" },
							method: rewrite ? "GET" : "POST",
							body: rewrite ? null : "payload",
							requestInit: { redirect: "manual", tls: { rejectUnauthorized: false } },
						});
						for (const header of ["cookie", "authorization", "proxy-authorization"]) {
							if (crossOrigin) {
								expect(sent[1]?.headers).not.toHaveProperty(header);
							} else {
								expect(sent[1]?.headers[header]).toBe(sent[0]?.headers[header]);
							}
						}
						if (rewrite) {
							expect(progress.current).not.toHaveProperty("body");
							expect(sent[1]?.headers).not.toHaveProperty("content-type");
						} else {
							expect(sent[1]?.headers["content-type"]).toBe("text/plain");
						}
						expect((yield* harness.resolvedUrls).at(-1)).toBe(progress.current.url);
						expect((yield* harness.registered).at(-1)?.id).toBe(ticketId(progress.current.hop, 0));
					}),
			);
		}
	}
});

for (const args of [
	[],
	["GET", ""],
	["GET", "not a URL"],
	["BREW", `${providerOrigin}/data`],
	["GET", `${providerOrigin}/data`, { headers: { hOsT: "other.test" } }],
] satisfies ReadonlyArray<ReadonlyArray<JsonValue>>) {
	httpCase(
		`rejects invalid initial HTTP arguments before admission: ${JSON.stringify(args)}`,
		{ outcomes: [{ status: 200 }] },
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch(undefined, args)).toMatchObject({ state: "failure" });
				expect(yield* harness.events).toEqual([]);
				expect(yield* harness.activityNames).toEqual([]);
			}),
	);
}

httpCase(
	"skips admission for unmatched HTTP requests and runs once",
	{ outcomes: [{ status: 200 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			expect(httpEvents(yield* harness.events)).toHaveLength(1);
			expect(yield* harness.registered).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-network-1",
			]);
		}),
);

httpCase(
	"reaches the network for a matched request only after its claim is admitted",
	{ resolutions: matchedOnly, outcomes: [{ status: 200 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			expect(yield* harness.registered).toEqual([
				{ lane: "background", id: ticketId(0, 0), plugin: "plugin-id", tenant: "user:user-1" },
			]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
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

httpCase(
	"waits the wake hint inside one admission Activity without re-registering",
	{
		resolutions: matchedOnly,
		outcomes: [{ status: 200 }],
		polls: [
			{ waitMs: 1_000, status: "wait" },
			{ status: "retry" },
			"fail",
			{ nonce: "n", status: "granted" },
		],
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			const fiber = yield* Effect.forkChild(runHttpDispatch());
			yield* TestClock.adjust("1999 millis");
			expect(httpEvents(yield* harness.events)).toEqual([]);
			yield* TestClock.adjust("1 milli");
			yield* Fiber.join(fiber);
			expect(yield* harness.registered).toHaveLength(1);
			expect(yield* harness.clockNames).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-network-1",
			]);
			expect(withPrefix(yield* harness.events, "resolve:")).toEqual([
				`resolve:${providerOrigin}:ok`,
				`resolve:${providerOrigin}:ok`,
			]);
		}),
);

httpCase(
	"cancels the ticket and registers under the live policy when it changes",
	{
		outcomes: [{ status: 200 }],
		resolutions: { [providerOrigin]: [httpPolicy("old"), httpPolicy("new")] },
		polls: [
			{ waitMs: 1_000, status: "wait" },
			{ nonce: "n", status: "granted" },
		],
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatchOver("1 second");
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

httpCase(
	"cancels an interrupted ticket with its last registered policy",
	{
		outcomes: [{ status: 200 }],
		resolutions: { [providerOrigin]: [httpPolicy("old"), httpPolicy("new")] },
		polls: [
			{ waitMs: 1_000, status: "wait" },
			{ nonce: "n", status: "granted" },
		],
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatchOver("1 second");
			harness.instance.interrupted = true;
			yield* Scope.close(harness.instance.scope, Exit.void);
			expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
				`cancel:old:${ticketId(0, 0)}`,
				`cancel:new:${ticketId(0, 0)}`,
			]);
		}),
);

httpCase(
	"cancels the ticket and runs once when the policy becomes unmatched",
	{
		outcomes: [{ status: 200 }],
		polls: [{ waitMs: 1_000, status: "wait" }],
		resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatchOver("1 second");
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect(withPrefix(events, "claim:")).toEqual([]);
			expect(withPrefix(events, "cancel:")).toEqual([`cancel:provider:${ticketId(0, 0)}`]);
		}),
);

httpCase(
	"uses a new deterministic coordination Activity after durable backoff",
	{ outcomes: [{ status: 200 }], resolutions: { [providerOrigin]: ["fail", httpPolicy()] } },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			expect(yield* harness.clockNames).toEqual(["sandbox-http-7-coordination-backoff-0"]);
			expect((yield* harness.activityNames).slice(0, 2)).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-admission-1",
			]);
		}),
);

httpCase(
	"polls again after a rejected claim and re-registers the same ticket",
	{
		resolutions: matchedOnly,
		outcomes: [{ status: 200 }],
		claims: [{ status: "rejected" }, { status: "unknown" }, { status: "admitted" }],
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect((yield* harness.registered).map(({ id }) => id)).toEqual([
				ticketId(0, 0),
				ticketId(0, 0),
			]);
			expect(withPrefix(events, "poll:")).toHaveLength(3);
		}),
);

for (const [label, header, expected] of [
	["delta seconds", { "ReTrY-AfTeR": "7" }, 7_000],
	["HTTP date", { "retry-after": "Thu, 01 Jan 1970 00:00:05 GMT" }, 5_000],
	["malformed fallback", { "retry-after": "1.5" }, 10_000],
] as const) {
	httpCase(
		`uses Retry-After ${label} for the global block`,
		{
			blockObservedAtMs: 1_000,
			outcomes: [{ status: 429, headers: header }],
			resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				expect(yield* runHttpDispatch()).toMatchObject({
					state: "failure",
					error: { message: "HTTP 429" },
				});
				const events = yield* harness.events;
				expect(withPrefix(events, "block:")).toEqual([`block:${expected}`]);
				expect(httpEvents(events)).toHaveLength(1);
				expect(yield* harness.clockDurations).toEqual([expected]);
			}),
	);
}

httpCase(
	"retries repeated matched 429 responses with a new ticket per attempt",
	{
		resolutions: { [providerOrigin]: [httpPolicy(), httpPolicy(), httpPolicy()] },
		outcomes: [
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 200 },
		],
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(3);
			expect(withPrefix(events, "block:")).toEqual(["block:0", "block:0"]);
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

httpCase(
	"denies a non-HTTP destination as a certain failure without a request",
	{ outcomes: [{ status: 200 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch("file:///etc/passwd")).toEqual({
				state: "failure",
				error: {
					data: { code: "destination-denied" },
					message: "httpCall destination is not allowed",
				},
			});
			expect(httpEvents(yield* harness.events)).toEqual([]);
		}),
);

httpCase(
	"returns a non-429 HTTP failure after one attempt",
	{ resolutions: matchedOnly, outcomes: [{ status: 500 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({
				state: "failure",
				error: { message: "HTTP 500" },
			});
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect(withPrefix(events, "block:")).toEqual([]);
		}),
);

describe("fair HTTP tickets preserve durable admission protections", () => {
	httpCase(
		"never dispatches while Redis is unavailable or the policy is overloaded",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: ["fail", "fail", { nonce: "n", status: "granted" }],
			registrations: ["fail", { observedAtMs: 0, status: "overloaded" }, { status: "registered" }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runHttpDispatch());
				yield* TestClock.adjust("4999 millis");
				expect(httpEvents(yield* harness.events)).toEqual([]);
				yield* TestClock.adjust("1 milli");
				expect(yield* Fiber.join(fiber)).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(httpEvents(events)).toHaveLength(1);
				expect(events.indexOf("claim:admitted")).toBe(events.length - 2);
				expect(yield* harness.clockNames).toEqual([]);
			}),
	);

	httpCase(
		"admits a matched request whose options are an explicit null",
		{ resolutions: matchedOnly, outcomes: [{ status: 200 }] },
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const url = `${providerOrigin}/data`;
				expect(yield* runHttpDispatch(url, ["GET", url, null])).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(events.indexOf("claim:admitted")).toBeLessThan(events.indexOf(`http:GET ${url}`));
				expect(yield* harness.registered).toHaveLength(1);
			}),
	);

	httpCase(
		"caps an honoured Retry-After at one hour",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "retry-after": "7200" } }, { status: 200 }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				yield* runHttpDispatch();
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:3600000"]);
				expect(yield* harness.clockDurations).toEqual([3_600_000]);
			}),
	);

	httpCase(
		"journals one admission Activity per attempt however long it waits",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "retry-after": "3600" } }, { status: 200 }],
			polls: [
				{ nonce: "first", status: "granted" },
				...Array.from({ length: 30 }, () => ({ waitMs: 60_000, status: "wait" as const })),
				{ nonce: "second", status: "granted" },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runHttpDispatch());
				yield* TestClock.adjust("2 hours");
				expect(yield* Fiber.join(fiber)).toMatchObject({ state: "success" });
				expect(yield* harness.clockDurations).toEqual([3_600_000]);
				expect(yield* harness.activityNames).toEqual([
					"sandbox-http-7-admission-0",
					"sandbox-http-7-network-1",
					"sandbox-http-7-block-0",
					"sandbox-http-7-admission-1",
					"sandbox-http-7-network-2",
				]);
				expect(withPrefix(yield* harness.events, "poll:")).toHaveLength(32);
			}),
	);

	httpCase(
		"cancels the registered ticket when the workflow is interrupted",
		{ resolutions: matchedOnly, outcomes: [{ status: 200 }] },
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				yield* runHttpDispatch();
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([]);
				harness.instance.interrupted = true;
				yield* Scope.close(harness.instance.scope, Exit.void);
				expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
					`cancel:provider:${ticketId(0, 0)}`,
				]);
			}),
	);

	httpCase(
		"cancels a waiting ticket and suspends when the workflow interrupt arrives",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 200 }],
			polls: [{ waitMs: 60_000, status: "wait" }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runHttpDispatch());
				yield* TestClock.adjust("1 minute");
				yield* harness.requestInterrupt;
				yield* TestClock.adjust("1 minute");
				const exit = yield* Fiber.await(fiber);
				expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
				expect(harness.instance.suspended).toBe(true);
				const events = yield* harness.events;
				expect(httpEvents(events)).toEqual([]);
				expect(withPrefix(events, "cancel:")).toEqual([`cancel:provider:${ticketId(0, 0)}`]);
			}),
	);
});

layer(httpDispatchLayer({ outcomes: [{ status: 200 }], cachedInterruptedAdmission: true }))(
	(test) => {
		test.effect(
			"restores the cleanup binding before suspending a cached interrupted admission",
			() =>
				Effect.gen(function* () {
					const harness = yield* HttpDispatchHarness;
					const fiber = yield* Effect.forkChild(runHttpDispatch());
					const exit = yield* Fiber.await(fiber);
					expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
					harness.instance.interrupted = true;
					yield* Scope.close(harness.instance.scope, Exit.void);
					expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
						`cancel:provider:${ticketId(0, 0)}`,
					]);
					expect(httpEvents(yield* harness.events)).toEqual([]);
				}),
		);
	},
);

httpCase(
	"retains a failed cancellation binding after the origin becomes unmatched",
	{
		cancelFailures: 1,
		outcomes: [{ status: 200 }],
		polls: [{ waitMs: 1_000, status: "wait" }],
		resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatchOver("1 second");
			harness.instance.interrupted = true;
			yield* Scope.close(harness.instance.scope, Exit.void);
			expect(withPrefix(yield* harness.events, "cancel:")).toEqual([
				`cancel:provider:${ticketId(0, 0)}`,
				`cancel:provider:${ticketId(0, 0)}`,
			]);
		}),
);

describe("sandbox HTTP redirects admit every matched hop", () => {
	httpCase(
		"admits the matched hop of an unmatched redirect before requesting it",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 302, headers: { location: `${providerOrigin}/data` } }, { status: 200 }],
		},
		() =>
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

	httpCase(
		"counts the hop cap across durable network activities",
		{
			resolutions: matchedOnly,
			outcomes: [{ status: 307, headers: { location: `${providerOrigin}/loop` } }],
		},
		() =>
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

	httpCase(
		"sends nothing to a redirect target whose policy lookup fails",
		{
			resolutions: { [providerOrigin]: ["fail", "fail", httpPolicy()] },
			outcomes: [{ status: 302, headers: { location: `${providerOrigin}/data` } }, { status: 200 }],
		},
		() =>
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

const interruptedExecutionId = "sandbox-http-interrupted";

const interruptedDispatchLayer = Layer.unwrap(
	Effect.sync(() => {
		const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, interruptedExecutionId);
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
						startedAt: "2026-01-01T00:00:00.000Z",
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

type LifecycleSteps = ScriptHostImplementations["Service"]["lifecycle"];

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
				ScriptExecutionWorkflow,
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
	readonly principal?: ScriptExecutionPrincipal;
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
					value: (results: ReadonlyArray<{ created: number; deleted: number }>) =>
						results.map(({ created, deleted }) => ({ created, deleted })),
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
					itemWrite: (input: { readonly batches: ReadonlyArray<unknown> }) => ({
						items: input.batches,
						result: RelationshipBatchSummary,
						commit: () => () => Effect.die("no commit"),
						applyPolicies: () => Effect.die("no policies"),
						prepare: (_batch: unknown, index: number) =>
							Effect.succeed({
								_tag: "Committed",
								result: { updated: 0, deleted: 0, created: index },
								dispatch: [{ runs: [], blockedReason: null, triggerId: `batch-${index}` }],
							}),
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
							validate: () => Effect.succeed(validated),
							itemWrite: () => ({
								items: [batch],
								result: RelationshipBatchSummary,
								commit: () => () => Effect.die("no commit"),
								prepare: () => Effect.succeed({ pending: { items: [] }, _tag: "PoliciesRequired" }),
								applyPolicies: () =>
									Effect.fail(new SandboxLifecycleHostFailure({ message: "policy-rejected" })),
							}),
						},
					}),
				);
				expect(
					yield* runLifecycleDispatch({ args: [[batch]], capability: "changeUserRelationships" }),
				).toEqual({ state: "failure", error: { message: "policy-rejected" } });
			}),
	);
});
