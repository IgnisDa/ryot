import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Cause, Duration, Effect, Exit, Layer, Logger, References } from "effect";
import type { Logger as LoggerType } from "effect/Logger";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import {
	type ProviderHttpAdmissionConfirmation,
	ProviderHttpAdmissionService,
	type ProviderHttpAdmissionToken,
} from "#lib/infrastructure/provider-http-admission";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
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
const implementations: SandboxHostImplementations["Service"] = {
	automation: { emitSignal: unused, sendNotification: unused },
	runtime: {
		httpCall: unused,
		getCachedValue: unused,
		setCachedValue: unused,
		claimPersistentValue: unused,
	},
	additional: {
		createEvents: unused,
		executeRyotql: unused,
		getPluginConfig: unused,
		getSystemConfig: unused,
		getEntitySchemas: unused,
		listEventSchemas: unused,
		listIntegrations: unused,
		getUserPreferences: unused,
		ensureUserEntities: unused,
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
		kind: "automation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
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

it.effect("dispatches workflow-owned capabilities through their deterministic child owners", () => {
	const executionId = "sandbox-parent";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const executions: Array<{
		workflow: unknown;
		options: Parameters<WorkflowEngine["Service"]["execute"]>[1];
	}> = [];
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (workflow, options) => {
			executions.push({ options, workflow });
			return Effect.succeed(
				workflow.name === SandboxDurableHostServiceWorkflow.name
					? { state: "success", value: { wasCreated: true, triggerId: "signal-trigger-1" } }
					: options.executionId,
			);
		},
	});
	const layer = SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(SandboxHostImplementations, implementations),
				Layer.mock(PluginHttpRateLimitAuthority)({ resolve: () => Effect.die("unused") }),
				Layer.mock(ProviderHttpAdmissionService)({
					block: () => Effect.die("unused"),
					confirm: () => Effect.die("unused"),
					reserve: () => Effect.die("unused"),
				}),
				Layer.mock(SandboxRepository)({ getScript: () => Effect.succeed(script) }),
			),
		),
	);
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

	return Effect.gen(function* () {
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
		expect(executions).toMatchObject([
			{
				workflow: SandboxDurableHostServiceWorkflow,
				options: { executionId: "sandbox-parent-host-service-0" },
			},
			{
				workflow: NotificationDeliveryWorkflow,
				options: { discard: true, executionId: "automation-run-1-host-1-notification" },
			},
		]);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
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

const makeHttpHarness = (options: {
	readonly resolveFailures?: number;
	readonly blockObservedAtMs?: number;
	readonly outcomes: ReadonlyArray<HttpOutcome>;
	readonly resolutions: ReadonlyArray<HttpRateLimitAuthorityResolution>;
	readonly confirmations?: ReadonlyArray<ProviderHttpAdmissionConfirmation>;
	readonly reservations?: ReadonlyArray<
		Pick<ProviderHttpAdmissionToken, "eligibleAtMs" | "observedAtMs">
	>;
}) => {
	const blocks: number[] = [];
	const logs: CapturedLog[] = [];
	const clockNames: string[] = [];
	const activityNames: string[] = [];
	const clockDurations: number[] = [];
	const reservationKeys: string[] = [];
	let calls = 0;
	let confirms = 0;
	let resolutionIndex = 0;
	let reservationIndex = 0;
	let confirmationIndex = 0;
	let remainingResolveFailures = options.resolveFailures ?? 0;
	const logger = Logger.make<unknown, void>(
		(entry: Parameters<LoggerType<unknown, unknown>["log"]>[0]) => {
			logs.push({
				logLevel: entry.logLevel,
				message: String(entry.message),
				annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
			});
		},
	);
	const executionId = "sandbox-http-parent";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	let engine: WorkflowEngine["Service"];
	engine = makeWorkflowActivityEngine(instance, {
		deferredResult: () => Effect.succeedSome(Exit.void),
		scheduleClock: (_workflow, scheduled) =>
			Effect.sync(() => {
				clockNames.push(scheduled.clock.name);
				clockDurations.push(Duration.toMillis(scheduled.clock.duration));
			}),
		activityExecute: (activity) =>
			Effect.gen(function* () {
				activityNames.push(activity.name);
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);
				return new Workflow.Complete({ exit });
			}),
	});
	const httpScript = { ...script, metadata: { ...script.metadata, capabilities: ["httpCall"] } };
	const httpImplementations: SandboxHostImplementations["Service"] = {
		...implementations,
		runtime: {
			...implementations.runtime,
			httpCall: () =>
				Effect.suspend(() => {
					const outcome = options.outcomes[Math.min(calls++, options.outcomes.length - 1)];
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
	const layer = SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(SandboxHostImplementations, httpImplementations),
				Layer.mock(SandboxRepository)({ getScript: () => Effect.succeed(httpScript) }),
				Layer.mock(PluginHttpRateLimitAuthority)({
					resolve: () => {
						if (remainingResolveFailures-- > 0) {
							return Effect.fail(new DbError({ message: "database unavailable" }));
						}
						const resolution =
							options.resolutions[Math.min(resolutionIndex++, options.resolutions.length - 1)];
						return resolution ? Effect.succeed(resolution) : Effect.die("missing resolution");
					},
				}),
				Layer.mock(ProviderHttpAdmissionService)({
					confirm: () => {
						confirms += 1;
						return Effect.succeed(
							options.confirmations?.[
								Math.min(confirmationIndex++, options.confirmations.length - 1)
							] ?? { status: "admitted" as const },
						);
					},
					block: (_declaration, blockedUntilMs) => {
						blocks.push(blockedUntilMs);
						return Effect.succeed({
							blockedUntilMs,
							status: "blocked" as const,
							observedAtMs: options.blockObservedAtMs ?? 0,
						});
					},
					reserve: (declaration) => {
						reservationKeys.push(declaration.key);
						const reservation = options.reservations?.[
							Math.min(reservationIndex++, options.reservations.length - 1)
						] ?? { eligibleAtMs: 10_000, observedAtMs: 10_000 };
						return Effect.succeed({ ...reservation, declarationHash: declaration.hash });
					},
				}),
			),
		),
	);
	const run = Effect.gen(function* () {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		return yield* dispatcher.dispatch(
			{
				index: 7,
				kind: "host",
				name: "httpCall",
				args: {
					capability: "httpCall",
					args: ["GET", "https://provider.test/private?token=secret"],
				},
			},
			{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: principal.subject },
			principal,
			executionId,
		);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				layer,
				Logger.layer([logger]),
				Layer.succeed(References.MinimumLogLevel, "Trace"),
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
			),
		),
	);
	return {
		run,
		logs,
		blocks,
		clockNames,
		activityNames,
		clockDurations,
		reservationKeys,
		get calls() {
			return calls;
		},
		get confirms() {
			return confirms;
		},
	};
};

it.effect("skips admission for unmatched HTTP requests and runs once", () => {
	const harness = makeHttpHarness({ resolutions: [unmatched], outcomes: [{ status: 200 }] });
	return Effect.gen(function* () {
		expect(yield* harness.run).toMatchObject({ state: "success" });
		expect(harness.calls).toBe(1);
		expect(harness.reservationKeys).toEqual([]);
		expect(harness.activityNames).toEqual(["sandbox-http-7-resolve-0", "sandbox-http-7-network-1"]);
	});
});

it.effect("admits an immediate matched reservation", () => {
	const harness = makeHttpHarness({ outcomes: [{ status: 200 }], resolutions: [httpPolicy()] });
	return Effect.gen(function* () {
		expect(yield* harness.run).toMatchObject({ state: "success" });
		expect(harness.reservationKeys).toEqual(["provider"]);
		expect(harness.confirms).toBe(0);
		expect(harness.clockNames).toEqual([]);
		expect(harness.logs).toEqual(
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
		const serializedLogs = harness.logs
			.flatMap(({ message, annotations }) =>
				[message].concat(Object.values(annotations).map(String)),
			)
			.join(" ");
		expect(serializedLogs).not.toContain("private");
		expect(serializedLogs).not.toContain("secret");
		expect(serializedLogs).not.toContain("sensitive response body");
	});
});

it.effect("sleeps, re-resolves, and confirms a future reservation", () => {
	const policy = httpPolicy();
	const harness = makeHttpHarness({
		outcomes: [{ status: 200 }],
		resolutions: [policy, policy],
		reservations: [{ eligibleAtMs: 5_000, observedAtMs: 4_000 }],
	});
	return Effect.gen(function* () {
		yield* harness.run;
		expect(harness.reservationKeys).toEqual(["provider"]);
		expect(harness.confirms).toBe(1);
		expect(harness.clockNames).toEqual(["sandbox-http-7-admission-wait-0"]);
		expect(harness.clockDurations).toEqual([1_000]);
	});
});

it.effect("discards a waited slot when the live policy changes", () => {
	const harness = makeHttpHarness({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy("old"), httpPolicy("new")],
		reservations: [
			{ eligibleAtMs: 5_000, observedAtMs: 4_000 },
			{ eligibleAtMs: 6_000, observedAtMs: 6_000 },
		],
	});
	return Effect.gen(function* () {
		yield* harness.run;
		expect(harness.reservationKeys).toEqual(["old", "new"]);
		expect(harness.confirms).toBe(0);
	});
});

it.effect("runs once without confirmation when policy becomes unmatched during a wait", () => {
	const harness = makeHttpHarness({
		outcomes: [{ status: 200 }],
		resolutions: [httpPolicy(), unmatched],
		reservations: [{ eligibleAtMs: 5_000, observedAtMs: 4_000 }],
	});
	return Effect.gen(function* () {
		yield* harness.run;
		expect(harness.calls).toBe(1);
		expect(harness.confirms).toBe(0);
		expect(harness.reservationKeys).toEqual(["provider"]);
	});
});

it.effect("uses a new deterministic coordination Activity after durable backoff", () => {
	const harness = makeHttpHarness({
		resolveFailures: 1,
		resolutions: [httpPolicy()],
		outcomes: [{ status: 200 }],
	});
	return Effect.gen(function* () {
		yield* harness.run;
		expect(harness.clockNames).toEqual(["sandbox-http-7-coordination-backoff-0"]);
		expect(harness.activityNames.slice(0, 2)).toEqual([
			"sandbox-http-7-resolve-0",
			"sandbox-http-7-resolve-1",
		]);
	});
});

it.effect("repeats later confirmation without taking a second reservation", () => {
	const policy = httpPolicy();
	const harness = makeHttpHarness({
		outcomes: [{ status: 200 }],
		resolutions: [policy, policy],
		reservations: [{ observedAtMs: 0, eligibleAtMs: 1_000 }],
		confirmations: [
			{ status: "later", eligibleAtMs: 5_000, observedAtMs: 2_000 },
			{ status: "admitted" },
		],
	});
	return Effect.gen(function* () {
		yield* harness.run;
		expect(harness.reservationKeys).toEqual(["provider"]);
		expect(harness.confirms).toBe(2);
		expect(harness.clockNames).toEqual([
			"sandbox-http-7-admission-wait-0",
			"sandbox-http-7-admission-wait-1",
		]);
		expect(harness.clockDurations).toEqual([1_000, 3_000]);
	});
});

for (const [label, header, expected] of [
	["delta seconds", { "ReTrY-AfTeR": "7" }, 7_000],
	["HTTP date", { "retry-after": "Thu, 01 Jan 1970 00:00:05 GMT" }, 5_000],
	["malformed fallback", { "retry-after": "1.5" }, 10_000],
] as const) {
	it.effect(`uses Retry-After ${label} for the global block`, () => {
		const policy = httpPolicy();
		const harness = makeHttpHarness({
			blockObservedAtMs: 1_000,
			resolutions: [policy, unmatched],
			outcomes: [{ status: 429, headers: header }],
		});
		return Effect.gen(function* () {
			expect(yield* harness.run).toMatchObject({
				state: "failure",
				error: { message: "HTTP 429" },
			});
			expect(harness.blocks).toEqual([expected]);
			expect(harness.calls).toBe(1);
			expect(harness.clockDurations).toEqual([expected - 1_000]);
		});
	});
}

it.effect("retries repeated matched 429 responses without a fixed cap", () => {
	const policy = httpPolicy();
	const harness = makeHttpHarness({
		resolutions: [policy, policy, policy],
		outcomes: [
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 200 },
		],
	});
	return Effect.gen(function* () {
		expect(yield* harness.run).toMatchObject({ state: "success" });
		expect(harness.calls).toBe(3);
		expect(harness.blocks).toEqual([0, 0]);
		expect(harness.activityNames.filter((name) => name.includes("-network-"))).toEqual([
			"sandbox-http-7-network-1",
			"sandbox-http-7-network-2",
			"sandbox-http-7-network-3",
		]);
		expect(harness.activityNames.join(" ")).not.toContain("private");
		expect(harness.activityNames.join(" ")).not.toContain("secret");
	});
});

it.effect("returns a non-429 HTTP failure after one attempt", () => {
	const harness = makeHttpHarness({ resolutions: [httpPolicy()], outcomes: [{ status: 500 }] });
	return Effect.gen(function* () {
		expect(yield* harness.run).toMatchObject({ state: "failure", error: { message: "HTTP 500" } });
		expect(harness.calls).toBe(1);
		expect(harness.blocks).toEqual([]);
	});
});

it.effect("does not swallow coordination interruption", () => {
	const executionId = "sandbox-http-interrupted";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, { activityExecute: () => Effect.interrupt });
	const layer = SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(SandboxHostImplementations, implementations),
				Layer.mock(SandboxRepository)({
					getScript: () =>
						Effect.succeed({
							...script,
							metadata: { ...script.metadata, capabilities: ["httpCall"] },
						}),
				}),
				Layer.mock(PluginHttpRateLimitAuthority)({ resolve: () => Effect.succeed(unmatched) }),
				Layer.mock(ProviderHttpAdmissionService)({
					block: () => Effect.die("unused"),
					confirm: () => Effect.die("unused"),
					reserve: () => Effect.die("unused"),
				}),
			),
		),
	);
	return Effect.gen(function* () {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		const exit = yield* Effect.exit(
			dispatcher.dispatch(
				{
					index: 0,
					kind: "host",
					name: "httpCall",
					args: { capability: "httpCall", args: ["GET", "https://provider.test"] },
				},
				{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: principal.subject },
				principal,
				executionId,
			),
		);
		expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});
