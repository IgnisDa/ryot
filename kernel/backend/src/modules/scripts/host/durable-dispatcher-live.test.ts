import { describe, expect } from "bun:test";

import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
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
import { assert } from "@ryot-app/testing/assert";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import type { Scope } from "effect";
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
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { EventsService } from "#modules/events/service";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { NotificationsService } from "#modules/notifications/service";
import {
	type HttpRateLimitAuthorityResolution,
	PluginHttpRateLimitAuthority,
} from "#modules/plugins/catalog/http-rate-limit-authority";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipBatchSummary } from "#modules/relationships/mutation-pipeline";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { emptyScriptsDigest } from "#modules/scripts/authorization/principal.test-support";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxDurableHostDispatcher } from "#modules/scripts/host/durable-dispatcher";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { unusedSandboxHostImplementations } from "#modules/scripts/host/host-implementations.test-support";
import {
	ProviderHttpAdmissionService,
	ProviderHttpAdmissionUnavailable,
} from "#modules/scripts/host/http-admission";
import {
	lifecycleHostFailure,
	SandboxLifecycleHostFailure,
} from "#modules/scripts/host/lifecycle-host";
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
	accountUserId: UserId.make("user-1"),
	executionUserId: UserId.make("user-1"),
	pluginRevisionId: PluginRevisionId.make("plugin-revision"),
	pluginConfigRevisionId: PluginConfigRevisionId.make("plugin-config-revision"),
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
		workflowScripts: {},
		id: subject.pluginId,
		scope: "system" as const,
		userBootstrapScriptSlugs: [],
		scriptsDigest: emptyScriptsDigest,
		revisionId: subject.pluginRevisionId,
		packageId: fixtureManifest().metadata.packageId,
		configRevisionId: subject.pluginConfigRevisionId,
		configSchema: { fields: {}, unknownKeys: "strict" as const },
	},
};

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const unusedAdmission = {
	sending: () => Effect.void,
	block: () => Effect.die("unused"),
	reserve: () => Effect.die("unused"),
};

const dispatcherLayer = (options: {
	readonly script: typeof script;
	readonly engine: WorkflowEngine["Service"];
	readonly httpClient?: HttpClient.HttpClient;
	readonly instance: WorkflowInstance["Service"];
	readonly authority?: SandboxExecutionAuthority["Service"];
	readonly lifecycleExecution?: Layer.Layer<LifecycleExecution>;
	readonly implementations?: ScriptHostImplementations["Service"];
	readonly sendMessage?: NotificationsService["Service"]["sendMessage"];
	readonly resolve?: PluginHttpRateLimitAuthority["Service"]["resolve"];
	readonly admission?: Partial<ProviderHttpAdmissionService["Service"]>;
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
				Layer.succeed(WorkflowInstance, options.instance),
				Layer.mock(EventsService)({}),
				Layer.succeed(NotificationsService, {
					test: () => Effect.die("unused"),
					create: () => Effect.die("unused"),
					update: () => Effect.die("unused"),
					delete: () => Effect.die("unused"),
					sendMessage: options.sendMessage ?? (() => Effect.die("unused")),
				}),
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

type NotificationSendMessage = Parameters<NotificationsService["Service"]["sendMessage"]>[0];

const signalCreated = {
	state: "success" as const,
	value: { wasCreated: true, triggerId: "signal-trigger-1" },
};

const signalArgs = [{ properties: {}, discriminator: "dispatcher", schemaSlug: "fixture.signal" }];

const signalRequest = (index: number) => ({
	index,
	name: "emitSignal",
	kind: "host" as const,
	args: { args: signalArgs, capability: "emitSignal" as const },
});

class RecordedHostWrites extends Context.Service<
	RecordedHostWrites,
	{
		readonly signals: Effect.Effect<number>;
		readonly activities: Effect.Effect<ReadonlyArray<string>>;
		readonly messages: Effect.Effect<ReadonlyArray<NotificationSendMessage>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/durable-dispatcher-live.test/RecordedHostWrites",
) {}

const hostWriteLayer = (options: { readonly authority?: SandboxExecutionAuthority["Service"] }) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const activities = yield* Ref.make<ReadonlyArray<string>>([]);
			const messages = yield* Ref.make<ReadonlyArray<NotificationSendMessage>>([]);
			const signals = yield* Ref.make(0);
			const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, "sandbox-parent");
			const engine = makeWorkflowActivityEngine(instance, {
				activityExecute: (activity) =>
					append(activities, activity.name).pipe(
						Effect.andThen(Effect.exit(activity.execute)),
						Effect.map((exit) => new Workflow.Complete({ exit })),
					),
			});
			return Layer.mergeAll(
				dispatcherLayer({
					engine,
					script,
					instance,
					...options,
					sendMessage: (input) =>
						append(messages, input).pipe(Effect.as({ id: "admitted-notification" })),
					implementations: {
						...implementations,
						automation: {
							...implementations.automation,
							emitSignal: () =>
								Ref.update(signals, (count) => count + 1).pipe(Effect.as(signalCreated.value)),
						},
					},
				}),
				Layer.succeed(RecordedHostWrites, {
					signals: Ref.get(signals),
					messages: Ref.get(messages),
					activities: Ref.get(activities),
				}),
			);
		}),
	);

layer(hostWriteLayer({}))((test) => {
	test.effect(
		"journals each durable host write as one activity of the script's workflow",
		() =>
			Effect.gen(function* () {
				const executionId = "sandbox-parent";
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
					yield* dispatcher.dispatch(signalRequest(0), payload, principal, executionId),
				).toEqual(signalCreated);
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
				const recorded = yield* RecordedHostWrites;
				expect(yield* recorded.activities).toEqual([
					"sandbox-host-0-emitSignal",
					"sandbox-host-1-sendNotification",
				]);
				expect(yield* recorded.messages).toEqual([
					{
						message: "Ready",
						sourceRunId: runId,
						accountUserId: subject.accountUserId,
						sourceKey: `${runId}-host-1-notification`,
					},
				]);
			}),
		testTimeout,
	);
});

const runInlineWrite = Effect.gen(function* () {
	const dispatcher = yield* SandboxDurableHostDispatcher;
	const pending = yield* Ref.make<ReadonlyArray<SandboxInlineProgress>>([]);
	const result = yield* dispatcher.settleInline(
		[signalRequest(2)],
		{},
		principal,
		"background",
		"inline-parent",
		"2026-08-06T00:00:00.000Z",
		makeSandboxShortWait(),
		(entry) => append(pending, entry),
	);
	return { result, pending: yield* Ref.get(pending) };
});

layer(hostWriteLayer({}))((test) => {
	test.effect("settles a write inline and checkpoints its result without an activity", () =>
		Effect.gen(function* () {
			const settled = yield* runInlineWrite;
			expect(settled.result).toEqual([signalCreated]);
			expect(settled.pending).toMatchObject([{ _tag: "Completed", value: signalCreated }]);
			const recorded = yield* RecordedHostWrites;
			expect(yield* recorded.signals).toBe(1);
			expect(yield* recorded.activities).toEqual([]);
		}),
	);
});

layer(
	hostWriteLayer({
		authority: {
			resolve: () =>
				Effect.fail(new SandboxRunError({ kind: "script-failure", message: "Unavailable" })),
		},
	}),
)((test) => {
	test.effect("defers the run when a write cannot settle inline", () =>
		Effect.gen(function* () {
			expect(yield* runInlineWrite).toEqual({ pending: [], result: null });
			expect(yield* (yield* RecordedHostWrites).signals).toBe(0);
		}),
	);
});

class RecordedImportHostInputs extends Context.Service<
	RecordedImportHostInputs,
	{ readonly inputs: Effect.Effect<ReadonlyArray<unknown>> }
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/durable-dispatcher-live.test/RecordedImportHostInputs",
) {}

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
	test.effect(
		"dispatches durable import host calls with their trusted run subject",
		() =>
			Effect.gen(function* () {
				const importRunId = ImportRunId.make("run-1");
				const importSubject = { importRunId, type: "user" as const, userId: UserId.make("user-1") };
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
		testTimeout,
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

type ScriptedResolution = "fail" | HttpRateLimitAuthorityResolution;

type HttpOutcome = Readonly<{ status: number; headers?: Readonly<Record<string, string>> }>;

type CapturedLog = Readonly<{
	message: string;
	logLevel: string;
	annotations: Readonly<Record<string, unknown>>;
}>;

type SentHttpRequest = Readonly<{
	url: string;
	method: string;
	body: null | string;
	requestInit: undefined | RequestInit;
	headers: Readonly<Record<string, string>>;
}>;

class HttpDispatchHarness extends Context.Service<
	HttpDispatchHarness,
	{
		readonly instance: WorkflowInstance["Service"];
		readonly requestInterrupt: Effect.Effect<void>;
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly logs: Effect.Effect<ReadonlyArray<CapturedLog>>;
		readonly clockNames: Effect.Effect<ReadonlyArray<string>>;
		readonly resolvedUrls: Effect.Effect<ReadonlyArray<string>>;
		readonly activityNames: Effect.Effect<ReadonlyArray<string>>;
		readonly sent: Effect.Effect<ReadonlyArray<SentHttpRequest>>;
		readonly clockDurations: Effect.Effect<ReadonlyArray<number>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/durable-dispatcher-live.test/HttpDispatchHarness",
) {}

const httpExecutionId = "sandbox-http-parent";

const nextIndex = (cursor: Ref.Ref<number>) => Ref.getAndUpdate(cursor, (index) => index + 1);

const at = <A>(items: ReadonlyArray<A>, index: number) => items[Math.min(index, items.length - 1)];

const unavailable = new ProviderHttpAdmissionUnavailable({ message: "database unavailable" });

const httpDispatchLayer = (options: {
	readonly blockFailures?: number;
	readonly outcomes: ReadonlyArray<HttpOutcome>;
	readonly reserves?: ReadonlyArray<"fail" | number>;
	readonly resolutions?: Readonly<Record<string, ReadonlyArray<ScriptedResolution>>>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const logs = yield* Ref.make<ReadonlyArray<CapturedLog>>([]);
			const clockNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const activityNames = yield* Ref.make<ReadonlyArray<string>>([]);
			const clockDurations = yield* Ref.make<ReadonlyArray<number>>([]);
			const sent = yield* Ref.make<ReadonlyArray<SentHttpRequest>>([]);
			const resolvedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
			const interruptRequested = yield* Ref.make(false);
			const blockCalls = yield* Ref.make(0);
			const httpCalls = yield* Ref.make(0);
			const reserveIndex = yield* Ref.make(0);
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
			return Layer.mergeAll(
				dispatcherLayer({
					engine,
					resolve,
					instance,
					httpClient: withEgressPolicy(httpClient, publicEgressPolicy),
					script: { ...script, metadata: { ...script.metadata, capabilities: ["httpCall"] } },
					admission: {
						sending: () => Effect.void,
						reserve: () =>
							Effect.gen(function* () {
								const next = options.reserves?.[yield* nextIndex(reserveIndex)] ?? 0;
								yield* record(`reserve:${next}`);
								return next === "fail" ? yield* unavailable : next;
							}),
						block: (_declaration, delayMs) =>
							Effect.gen(function* () {
								yield* record(`block:${delayMs}`);
								if ((yield* nextIndex(blockCalls)) < (options.blockFailures ?? 0)) {
									return yield* unavailable;
								}
								return undefined;
							}),
					},
				}),
				Layer.succeed(HttpDispatchHarness, {
					instance,
					logs: Ref.get(logs),
					sent: Ref.get(sent),
					events: Ref.get(events),
					clockNames: Ref.get(clockNames),
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

const decodeHttpProgress = Schema.decodeUnknownEffect(SandboxHttpProgress);

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

const httpCase = (
	name: string,
	options: Parameters<typeof httpDispatchLayer>[0],
	body: () => Effect.Effect<
		void,
		unknown,
		Scope.Scope | Layer.Success<ReturnType<typeof httpDispatchLayer>>
	>,
) =>
	layer(httpDispatchLayer(options))((test) => {
		test.effect(name, body, testTimeout);
	});

const httpEvents = (events: ReadonlyArray<string>) => withPrefix(events, "http:");

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
		{ reserves: [500], resolutions: matchedOnly, outcomes: [{ status: 200 }] },
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
				expect(events.indexOf("reserve:500")).toBeLessThan(
					events.findIndex((event) => event.startsWith("http:")),
				);
			}),
	);
	httpCase(
		"hands a long admission wait back holding its slot",
		{ reserves: [1_001], resolutions: matchedOnly, outcomes: [{ status: 200 }] },
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const deferred = yield* runInlineHttp();
				expect(deferred.result).toBeNull();
				expect(httpEvents(yield* harness.events)).toEqual([]);
				const progress = deferred.pending.at(-1);
				assert(progress?._tag === "Http");
				expect(progress.progress).toMatchObject({ phase: { slotAtMs: 1_001, _tag: "Admitting" } });
				const resumed = yield* Effect.forkChild(
					runHttpDispatch(undefined, undefined, yield* decodeHttpProgress(progress.progress)),
				);
				yield* TestClock.adjust("1000 millis");
				expect(httpEvents(yield* harness.events)).toEqual([]);
				yield* TestClock.adjust("1 milli");
				expect(yield* Fiber.join(resumed)).toMatchObject({ state: "success" });
				expect(withPrefix(yield* harness.events, "reserve:")).toEqual(["reserve:1001"]);
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
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
			reserves: [0, 100, 100],
			outcomes: [
				{ status: 302, headers: { Location: `${nextOrigin}/target` } },
				{ status: 429, headers: { "Retry-After": "0" } },
				{ status: 200 },
			],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runInlineHttp());
				yield* TestClock.adjust("200 millis");
				expect((yield* Fiber.join(fiber)).result).toMatchObject([{ state: "success" }]);
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
			reserves: [600, 600],
			outcomes: [{ status: 302, headers: { Location: `${nextOrigin}/target` } }, { status: 200 }],
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
					current: { hop: 1, url: `${nextOrigin}/target` },
					phase: { rateLimit: null, slotAtMs: 1_200, _tag: "Admitting" },
				});
				const resumed = yield* Effect.forkChild(
					runHttpDispatch(undefined, undefined, yield* decodeHttpProgress(progress.progress)),
				);
				yield* TestClock.adjust("600 millis");
				expect(yield* Fiber.join(resumed)).toMatchObject({ state: "success" });
				expect(httpEvents(yield* harness.events)).toEqual([
					`http:GET ${providerOrigin}/private?token=secret`,
					`http:GET ${nextOrigin}/target`,
				]);
			}),
	);
	httpCase(
		"resumes a long 429 delay without repeating its response or global block",
		{
			reserves: [0, 2_000],
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
					phase: {
						slotAtMs: 2_000,
						_tag: "Admitting",
						rateLimit: { error: { message: "HTTP 429" } },
					},
				});
				const resumed = yield* Effect.forkChild(
					runHttpDispatch(undefined, undefined, yield* decodeHttpProgress(progress.progress)),
				);
				yield* TestClock.adjust("2 seconds");
				expect(yield* Fiber.join(resumed)).toMatchObject({ state: "success" });
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:2000"]);
				expect(withPrefix(yield* harness.events, "reserve:")).toEqual([
					"reserve:0",
					"reserve:2000",
				]);
				expect(httpEvents(yield* harness.events)).toHaveLength(2);
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
					yield* runHttpDispatch(
						undefined,
						undefined,
						yield* decodeHttpProgress(progress.progress),
					),
				).toMatchObject({ state: "success" });
				expect(httpEvents(yield* harness.events)).toHaveLength(2);
			}),
	);
});

describe("HTTP continuation phase transitions", () => {
	httpCase(
		"returns the retained 429 when policy disappears during a resumed retry admission",
		{
			reserves: [0, 1_001],
			outcomes: [{ status: 429, headers: { "Retry-After": "0" } }],
			resolutions: { [providerOrigin]: [httpPolicy(), httpPolicy(), unmatched()] },
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
				const progress = yield* decodeHttpProgress(retained.progress);
				expect(yield* runHttpDispatch(undefined, undefined, progress)).toEqual<unknown>(
					progress.phase.rateLimit,
				);
				expect(httpEvents(yield* harness.events)).toHaveLength(1);
				expect(withPrefix(yield* harness.events, "block:")).toEqual(["block:0"]);
			}),
	);
});

describe("prepared HTTP hops survive redirect handoff", () => {
	httpCase(
		"admits and executes the same normalized initial request after handoff",
		{ reserves: [1_001], resolutions: matchedOnly, outcomes: [{ status: 200 }] },
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
				const progress = yield* decodeHttpProgress(retained.progress);
				expect(progress.current).toMatchObject({
					hop: 0,
					method: "POST",
					body: "payload",
					url: `${providerOrigin}/data`,
					headers: { Authorization: "Bearer secret" },
				});
				expect(yield* harness.sent).toEqual([]);
				const resumed = yield* Effect.forkChild(runHttpDispatch(url, args, progress));
				yield* TestClock.adjust("1001 millis");
				expect(yield* Fiber.join(resumed)).toMatchObject({ state: "success" });
				expect(yield* harness.sent).toMatchObject([
					{
						method: "POST",
						body: "payload",
						url: progress.current.url,
						headers: { authorization: "Bearer secret" },
					},
				]);
				expect(yield* harness.resolvedUrls).toEqual([progress.current.url, progress.current.url]);
				expect(withPrefix(yield* harness.events, "reserve:")).toEqual(["reserve:1001"]);
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
					reserves: crossOrigin ? [1_001] : [0, 1_001],
					outcomes: [{ status, headers: { Location: target } }, { status: 200 }],
				},
				() =>
					Effect.gen(function* () {
						const harness = yield* HttpDispatchHarness;
						const deferred = yield* runInlineHttp(source, args);
						const retained = deferred.pending.at(-1);
						assert(retained?._tag === "Http");
						const progress = yield* decodeHttpProgress(retained.progress);
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
						const resumed = yield* Effect.forkChild(runHttpDispatch(source, args, progress));
						yield* TestClock.adjust("1001 millis");
						expect(yield* Fiber.join(resumed)).toMatchObject({ state: "success" });
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
			expect(withPrefix(yield* harness.events, "reserve:")).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-network-1",
			]);
		}),
);

httpCase(
	"reaches the network for a matched request only after it reserves a slot",
	{ resolutions: matchedOnly, outcomes: [{ status: 200 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			expect(yield* runHttpDispatch()).toMatchObject({ state: "success" });
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-network-1",
			]);
			const events = yield* harness.events;
			expect(events.indexOf("reserve:0")).toBeLessThan(
				events.findIndex((event) => event.startsWith("http:")),
			);
			expect(yield* harness.clockNames).toEqual([]);
			const logs = yield* harness.logs;
			expect(logs).toEqual<unknown>(
				arrayContaining([
					objectContaining({
						logLevel: "Trace",
						message: "sandbox HTTP policy resolution completed",
						annotations: objectContaining({
							status: "matched",
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
	"waits for its slot inside one admission Activity",
	{ reserves: [2_000], resolutions: matchedOnly, outcomes: [{ status: 200 }] },
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			const fiber = yield* Effect.forkChild(runHttpDispatch());
			yield* TestClock.adjust("1999 millis");
			expect(httpEvents(yield* harness.events)).toEqual([]);
			yield* TestClock.adjust("1 milli");
			yield* Fiber.join(fiber);
			expect(yield* harness.clockNames).toEqual([]);
			expect(yield* harness.activityNames).toEqual([
				"sandbox-http-7-admission-0",
				"sandbox-http-7-network-1",
			]);
			expect(withPrefix(yield* harness.events, "reserve:")).toEqual(["reserve:2000"]);
		}),
);

httpCase(
	"runs once without a slot when the policy becomes unmatched after a reservation fails",
	{
		reserves: ["fail"],
		outcomes: [{ status: 200 }],
		resolutions: { [providerOrigin]: [httpPolicy(), unmatched()] },
	},
	() =>
		Effect.gen(function* () {
			const harness = yield* HttpDispatchHarness;
			yield* runHttpDispatch();
			const events = yield* harness.events;
			expect(httpEvents(events)).toHaveLength(1);
			expect(withPrefix(events, "reserve:")).toEqual(["reserve:fail"]);
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

for (const [label, header, expected] of [
	["delta seconds", { "ReTrY-AfTeR": "7" }, 7_000],
	["HTTP date", { "retry-after": "Thu, 01 Jan 1970 00:00:05 GMT" }, 5_000],
	["malformed fallback", { "retry-after": "1.5" }, 10_000],
] as const) {
	httpCase(
		`uses Retry-After ${label} for the global block`,
		{
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
			}),
	);
}

httpCase(
	"retries repeated matched 429 responses with a new slot per attempt",
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
			expect(withPrefix(events, "reserve:")).toHaveLength(3);
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

describe("HTTP admission preserves durable protections", () => {
	httpCase(
		"never dispatches while admission is unavailable",
		{ resolutions: matchedOnly, outcomes: [{ status: 200 }], reserves: ["fail", "fail", 0] },
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runHttpDispatch());
				yield* TestClock.adjust("1 hour");
				expect(yield* Fiber.join(fiber)).toMatchObject({ state: "success" });
				const events = yield* harness.events;
				expect(httpEvents(events)).toHaveLength(1);
				expect(events.indexOf("reserve:0")).toBeLessThan(
					events.findIndex((event) => event.startsWith("http:")),
				);
				expect(withPrefix(events, "reserve:")).toEqual([
					"reserve:fail",
					"reserve:fail",
					"reserve:0",
				]);
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
				expect(events.indexOf("reserve:0")).toBeLessThan(events.indexOf(`http:GET ${url}`));
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
			}),
	);

	httpCase(
		"journals one admission Activity per attempt however long it waits",
		{
			reserves: [0, 3_600_000],
			resolutions: matchedOnly,
			outcomes: [{ status: 429, headers: { "retry-after": "3600" } }, { status: 200 }],
		},
		() =>
			Effect.gen(function* () {
				const harness = yield* HttpDispatchHarness;
				const fiber = yield* Effect.forkChild(runHttpDispatch());
				yield* TestClock.adjust("2 hours");
				expect(yield* Fiber.join(fiber)).toMatchObject({ state: "success" });
				expect(yield* harness.activityNames).toEqual([
					"sandbox-http-7-admission-0",
					"sandbox-http-7-network-1",
					"sandbox-http-7-block-0",
					"sandbox-http-7-admission-1",
					"sandbox-http-7-network-2",
				]);
			}),
	);
});

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
				expect(events.indexOf("reserve:0")).toBeLessThan(
					events.indexOf(`http:GET ${providerOrigin}/data`),
				);
				expect(withPrefix(events, "reserve:")).toEqual(["reserve:0"]);
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
				expect(withPrefix(yield* harness.events, "reserve:")).toHaveLength(5);
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
				expect(events.slice(0, target)).toEqual<unknown>(
					arrayContaining([
						`resolve:${providerOrigin}:fail`,
						`resolve:${providerOrigin}:fail`,
						"reserve:0",
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
	test.effect(
		"does not swallow coordination interruption",
		() =>
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
		testTimeout,
	);
});

const lifecycleCapabilities = [
	"changeUserRelationships",
	"upsertGlobalEntities",
	"updateEvents",
] as const;
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
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/durable-dispatcher-live.test/LifecycleDispatchHarness",
) {}

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

const runLifecycleWrite = (options: {
	readonly args: ReadonlyArray<JsonValue>;
	readonly principal?: ScriptExecutionPrincipal;
	readonly capability: (typeof lifecycleCapabilities)[number];
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

layer(
	lifecycleDispatchLayer({
		lifecycle: () =>
			lifecycleSteps({
				updateEvents: {
					commit: () =>
						Effect.fail(
							lifecycleHostFailure(new DbError({ message: "Busy", code: "RYOT_FOLD_BUSY" })),
						),
					validate: () =>
						Effect.succeed({
							items: [],
							_tag: "UpdateEvents",
							userId: subject.executionUserId,
							command: {
								causation,
								itemIdentity: "updateEvents",
								occurredAt: lifecyclePayload.startedAt,
							},
						}),
				},
			}),
	}),
)((test) => {
	test.effect("defers a rolled-back lifecycle write without checkpointing a capacity failure", () =>
		Effect.gen(function* () {
			const dispatcher = yield* SandboxDurableHostDispatcher;
			const pending = yield* Ref.make<ReadonlyArray<SandboxInlineProgress>>([]);
			const result = yield* dispatcher.settleInline(
				[
					{
						index: 0,
						kind: "host",
						name: "updateEvents",
						args: { args: [[]], capability: "updateEvents" },
					},
				],
				{},
				lifecyclePrincipal,
				"interactive",
				"busy-parent",
				lifecyclePayload.startedAt,
				makeSandboxShortWait(),
				(entry) => append(pending, entry),
			);
			expect(result).toBeNull();
			expect(yield* Ref.get(pending)).toEqual([]);
			expect(yield* (yield* LifecycleDispatchHarness).recorded).toEqual([]);
		}),
	);
});

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
	test.effect(
		"writes each relationship batch in turn and dispatches between them",
		() =>
			Effect.gen(function* () {
				const harness = yield* LifecycleDispatchHarness;
				const result = yield* runLifecycleWrite({
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
					"sandbox-host-4-changeUserRelationships",
					"dispatch:1",
					"dispatch:1",
				]);
				expect(
					(yield* harness.logs).filter((message) => message.includes("automation warnings")),
				).toHaveLength(1);
			}),
		testTimeout,
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
	test.effect(
		"runs a global entity upsert's policies before dispatching its after hooks",
		() =>
			Effect.gen(function* () {
				const providerPrincipal = {
					...lifecyclePrincipal,
					subject: { type: "system" as const },
					providerId: SandboxProviderId.make("provider-1"),
					metadata: { ...lifecycleScript.metadata, kind: "script" as const },
				};
				const result = yield* runLifecycleWrite({
					args: [[]],
					principal: providerPrincipal,
					capability: "upsertGlobalEntities",
				});
				expect(result).toEqual({ state: "success", value: [{ status: "skipped" }] });
				expect(yield* (yield* LifecycleDispatchHarness).recorded).toEqual([
					"sandbox-host-4-upsertGlobalEntities",
					"policies",
					"dispatch:1",
				]);
			}),
		testTimeout,
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
					yield* runLifecycleWrite({ args: [], capability: "changeUserRelationships" }),
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
					yield* runLifecycleWrite({ args: [[batch]], capability: "changeUserRelationships" }),
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
					yield* runLifecycleWrite({ args: [[batch]], capability: "changeUserRelationships" }),
				).toEqual({ state: "failure", error: { message: "policy-rejected" } });
			}),
		testTimeout,
	);
});
