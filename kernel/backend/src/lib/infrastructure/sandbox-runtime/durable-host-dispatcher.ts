import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { createEventItemSchema, sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Cause, Clock, Duration, Effect, Layer, Schema } from "effect";
import { DurableClock } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import {
	runLifecycleWriteStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import {
	ProviderHttpAdmissionBlockResult,
	ProviderHttpAdmissionConfirmation,
	type ProviderHttpAdmissionDeclaration,
	ProviderHttpAdmissionService,
	ProviderHttpAdmissionToken,
} from "#lib/infrastructure/provider-http-admission";
import { recordSandboxHostCall } from "#lib/infrastructure/runtime-metrics";
import {
	SandboxLifecycleHostFailure,
	SandboxLifecycleHostInput,
} from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	reportSandboxLifecycleWarnings,
	toSandboxHostError,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { GlobalEntityUpsertResults, PendingGlobalEntityUpsert } from "#modules/entities/service";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import {
	NotificationDeliveryWorkflow,
	NotificationDeliveryWorkflowPayload,
} from "#modules/notifications/notification-delivery-workflow";
import {
	PluginHttpRateLimitAuthority,
	type HttpRateLimitAuthorityResolution,
} from "#modules/plugins/http-rate-limit-authority";
import {
	PendingRelationshipMutations,
	RelationshipBatchSummary,
	RelationshipReconciliationSummary,
} from "#modules/relationships/mutation-pipeline";
import {
	dispatchSandboxHostActivity,
	durableHostFailure,
	prepareSandboxCreateEvents,
	prepareSandboxLifecycleHostInput,
	prepareSandboxSendNotification,
	runSandboxDurableHostServiceWorkflow,
	sandboxDurableHttpRequestUrl,
	sandboxDurableHostDispatchStrategy,
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";
import { SandboxRepository } from "#modules/sandbox/repository";

const PreparedSandboxCreateEvents = Schema.Struct({
	userId: UserId,
	command: LifecycleCommand,
	payload: Schema.Array(createEventItemSchema),
});

const PreparedSandboxSendNotification = Schema.Struct({
	userId: UserId,
	message: Schema.String,
	executionId: Schema.String,
});

const HttpRateLimitResolution = Schema.Union([
	Schema.Struct({
		hash: Schema.String,
		origin: Schema.String,
		durationMs: Schema.Int,
		matched: Schema.Literal(true),
		declaration: PluginHttpRateLimit,
	}),
	Schema.Struct({
		durationMs: Schema.Int,
		matched: Schema.Literal(false),
		origin: Schema.optional(Schema.String),
		reason: Schema.Literals(["invalid-url", "non-http-url", "undeclared-origin"]),
	}),
]);

const AdmissionReservation = Schema.Struct({
	durationMs: Schema.Int,
	token: ProviderHttpAdmissionToken,
});

const HttpNetworkAttempt = Schema.Struct({
	durationMs: Schema.Int,
	responseTimeMs: Schema.Int,
	result: workflowDurableResultSchema,
});

class HttpAdmissionCoordinationError extends Schema.TaggedError<HttpAdmissionCoordinationError>()(
	"HttpAdmissionCoordinationError",
	{ stage: Schema.String },
) {}

type MatchedHttpRateLimit = Extract<HttpRateLimitAuthorityResolution, { readonly matched: true }>;

const bounded = (value: string, length: number) => value.slice(0, length);

const admissionDeclaration = (policy: MatchedHttpRateLimit): ProviderHttpAdmissionDeclaration => ({
	hash: policy.hash,
	key: policy.declaration.key,
	requests: policy.declaration.requests,
	intervalMs: policy.declaration.intervalMs,
});

const samePolicy = (left: MatchedHttpRateLimit, right: MatchedHttpRateLimit) =>
	left.hash === right.hash &&
	left.declaration.key === right.declaration.key &&
	left.declaration.requests === right.declaration.requests &&
	left.declaration.intervalMs === right.declaration.intervalMs &&
	left.declaration.origins.length === right.declaration.origins.length &&
	left.declaration.origins.every((origin, index) => origin === right.declaration.origins[index]);

const coordinationError = (stage: string) => () => new HttpAdmissionCoordinationError({ stage });

const networkAttemptLogLevel = (result: WorkflowDurableResult) => {
	if (result.state === "success") {
		return "Debug" as const;
	}
	const status =
		result.error.data && typeof result.error.data === "object"
			? Reflect.get(result.error.data, "status")
			: undefined;
	if (typeof status === "number") {
		return status >= 500 ? ("Warn" as const) : ("Debug" as const);
	}
	return "Error" as const;
};

const retryAfterTimestamp = (
	result: WorkflowDurableResult,
	responseTimeMs: number,
	intervalMs: number,
) => {
	if (result.state !== "failure" || result.error.message !== "HTTP 429") {
		return null;
	}
	const data = result.error.data;
	if (!data || typeof data !== "object" || Reflect.get(data, "status") !== 429) {
		return null;
	}
	const headers = Reflect.get(data, "headers");
	let retryAfter: string | undefined;
	if (headers && typeof headers === "object" && !Array.isArray(headers)) {
		for (const [name, value] of Object.entries(headers)) {
			if (name.toLowerCase() === "retry-after" && typeof value === "string") {
				retryAfter = value;
				break;
			}
		}
	}
	const fallback = Math.min(Number.MAX_SAFE_INTEGER, responseTimeMs + intervalMs);
	if (retryAfter === undefined) {
		return fallback;
	}
	const value = retryAfter.trim();
	if (/^\d+$/.test(value)) {
		const seconds = Number(value);
		return Number.isSafeInteger(seconds) &&
			seconds <= (Number.MAX_SAFE_INTEGER - responseTimeMs) / 1_000
			? responseTimeMs + seconds * 1_000
			: fallback;
	}
	const date =
		/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
			value,
		)
			? Date.parse(value)
			: Number.NaN;
	return Number.isFinite(date) &&
		date >= 0 &&
		Number.isSafeInteger(date) &&
		new Date(date).toUTCString() === value
		? Math.max(responseTimeMs, date)
		: fallback;
};

const lifecycleHostSuccessSchemas = {
	UpsertGlobalEntities: sandboxHostContracts.upsertGlobalEntities.success,
	ChangeUserRelationships: sandboxHostContracts.changeUserRelationships.success,
	UpsertGlobalRelationships: sandboxHostContracts.upsertGlobalRelationships.success,
};

export const SandboxDurableHostServiceWorkflowLive = implementWorkflow(
	SandboxDurableHostServiceWorkflow,
	(payload) => runSandboxDurableHostServiceWorkflow(payload),
);

const sleepUntil = (name: string, timestamp: number, observedAtMs: number) => {
	const waitMs = Math.max(0, timestamp - observedAtMs);
	return waitMs === 0
		? Effect.void
		: DurableClock.sleep({
				name,
				duration: Duration.millis(waitMs),
				inMemoryThreshold: Duration.millis(1),
			});
};

const recordHostCall = <E, R>(
	request: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[0],
	effect: Effect.Effect<WorkflowDurableResult, E, R>,
) =>
	effect.pipe(
		Effect.onExit((exit) =>
			recordSandboxHostCall({
				function: request.args.capability,
				outcome: exit._tag === "Success" && exit.value.state === "success" ? "success" : "failure",
			}),
		),
	);

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const database = yield* Database;
		const engine = yield* WorkflowEngine;
		const repository = yield* SandboxRepository;
		const admission = yield* ProviderHttpAdmissionService;
		const implementations = yield* SandboxHostImplementations;
		const lifecycleExecution = yield* LifecycleExecution;
		const rateLimitAuthority = yield* PluginHttpRateLimitAuthority;
		const provideDispatchServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				Effect.provideService(Database, database),
				Effect.provideService(SandboxRepository, repository),
				Effect.provideService(SandboxHostImplementations, implementations),
			);
		const dispatchHttp = (
			request: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[0],
			payload: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[1],
			principal: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[2],
			executionId: string,
			startedAt: string,
		) =>
			Effect.gen(function* () {
				let waitAttempt = 0;
				let rateLimitCount = 0;
				let networkAttempt = 0;
				let blockWaitAttempt = 0;
				let coordinationAttempt = 0;
				let coordinationFailureStreak = 0;
				let coordinationBackoffAttempt = 0;
				let coordinationFailureActive = false;
				let terminalRateLimit: WorkflowDurableResult | undefined;

				const coordinate = <Success extends Schema.Top>(
					stage: string,
					success: Success,
					execute: () => Effect.Effect<Success["Type"], HttpAdmissionCoordinationError>,
				) =>
					Effect.gen(function* () {
						for (;;) {
							const activityAttempt = coordinationAttempt++;
							const outcome = yield* makeActivity({
								success,
								execute: execute(),
								error: HttpAdmissionCoordinationError,
								name: `sandbox-http-${request.index}-${stage}-${activityAttempt}`,
							}).pipe(
								Effect.map((value) => ({ value, success: true as const })),
								Effect.catchTag("HttpAdmissionCoordinationError", (error) =>
									Effect.succeed({ error, success: false as const }),
								),
							);
							if (outcome.success) {
								if (coordinationFailureActive) {
									yield* Effect.logInfo("sandbox HTTP admission coordination recovered").pipe(
										Effect.annotateLogs({
											status: "recovered",
											stage: bounded(stage, 32),
											sandboxWorkflowExecutionId: executionId,
										}),
									);
								}
								coordinationFailureStreak = 0;
								coordinationFailureActive = false;
								return outcome.value;
							}
							coordinationFailureStreak += 1;
							if (!coordinationFailureActive) {
								coordinationFailureActive = true;
								yield* Effect.logWarning("sandbox HTTP admission coordination failed").pipe(
									Effect.annotateLogs({
										status: "failed",
										sandboxWorkflowExecutionId: executionId,
										stage: bounded(outcome.error.stage, 32),
									}),
								);
							}
							const backoffMs = Math.min(
								30_000,
								1_000 * 2 ** Math.min(coordinationFailureStreak - 1, 5),
							);
							yield* DurableClock.sleep({
								duration: Duration.millis(backoffMs),
								inMemoryThreshold: Duration.millis(1),
								name: `sandbox-http-${request.index}-coordination-backoff-${coordinationBackoffAttempt++}`,
							});
						}
					});

				const resolvePolicy = (url: string) =>
					coordinate("resolve", HttpRateLimitResolution, () =>
						Effect.gen(function* () {
							const startedAtMs = yield* Clock.currentTimeMillis;
							const resolution = yield* rateLimitAuthority.resolve(url);
							return {
								...resolution,
								durationMs: Math.max(0, (yield* Clock.currentTimeMillis) - startedAtMs),
							};
						}).pipe(
							Effect.catchTags({
								DbError: coordinationError("resolve"),
								PluginValidationError: coordinationError("resolve"),
							}),
						),
					).pipe(
						Effect.tap((resolution) =>
							Effect.logTrace("sandbox HTTP policy resolution completed").pipe(
								Effect.annotateLogs({
									stage: "resolve",
									durationMs: resolution.durationMs,
									sandboxWorkflowExecutionId: executionId,
									status: resolution.matched ? "matched" : resolution.reason,
									...(resolution.origin ? { origin: bounded(resolution.origin, 256) } : {}),
									...(resolution.matched
										? { policyKey: bounded(resolution.declaration.key, 128) }
										: {}),
								}),
							),
						),
					);

				const reserve = (policy: MatchedHttpRateLimit) =>
					coordinate("reserve", AdmissionReservation, () =>
						Effect.gen(function* () {
							const startedAtMs = yield* Clock.currentTimeMillis;
							const token = yield* admission.reserve(admissionDeclaration(policy));
							const finishedAtMs = yield* Clock.currentTimeMillis;
							return { token, durationMs: Math.max(0, finishedAtMs - startedAtMs) };
						}).pipe(
							Effect.catchTags({
								ProviderHttpAdmissionUnavailable: coordinationError("reserve"),
								ProviderHttpAdmissionCorruptState: coordinationError("reserve"),
							}),
						),
					);

				const confirm = (policy: MatchedHttpRateLimit, token: ProviderHttpAdmissionToken) =>
					coordinate("confirm", ProviderHttpAdmissionConfirmation, () =>
						admission
							.confirm(admissionDeclaration(policy), token)
							.pipe(
								Effect.catchTags({
									ProviderHttpAdmissionUnavailable: coordinationError("confirm"),
									ProviderHttpAdmissionCorruptState: coordinationError("confirm"),
								}),
							),
					);

				const block = (policy: MatchedHttpRateLimit, blockedUntilMs: number) =>
					coordinate("block", ProviderHttpAdmissionBlockResult, () =>
						admission
							.block(admissionDeclaration(policy), blockedUntilMs)
							.pipe(
								Effect.catchTags({
									ProviderHttpAdmissionUnavailable: coordinationError("block"),
									ProviderHttpAdmissionCorruptState: coordinationError("block"),
								}),
							),
					);

				const runNetworkAttempt = (policy: MatchedHttpRateLimit | null) => {
					networkAttempt += 1;
					const attempt = networkAttempt;
					return makeActivity({
						error: SandboxRunError,
						success: HttpNetworkAttempt,
						name: `sandbox-http-${request.index}-network-${attempt}`,
						execute: Effect.gen(function* () {
							const startedAtMs = yield* Clock.currentTimeMillis;
							const result = yield* provideDispatchServices(
								dispatchSandboxHostActivity(
									request,
									payload.input,
									principal,
									executionId,
									startedAt,
								),
							);
							const responseTimeMs = yield* Clock.currentTimeMillis;
							const durationMs = Math.max(0, responseTimeMs - startedAtMs);
							yield* Effect.logWithLevel(networkAttemptLogLevel(result))(
								"sandbox HTTP network attempt completed",
							).pipe(
								Effect.annotateLogs({
									attempt,
									durationMs,
									stage: "network",
									status: result.state,
									sandboxWorkflowExecutionId: executionId,
									...(policy
										? {
												origin: bounded(policy.origin, 256),
												policyKey: bounded(policy.declaration.key, 128),
											}
										: {}),
								}),
							);
							return { result, durationMs, responseTimeMs };
						}).pipe(
							Effect.withSpan("sandbox.http.network-attempt", {
								attributes: policy
									? {
											attempt,
											"policy.origin": bounded(policy.origin, 256),
											"policy.key": bounded(policy.declaration.key, 128),
										}
									: { attempt },
							}),
						),
					});
				};

				const url = sandboxDurableHttpRequestUrl(request);
				if (url === null) {
					return (yield* runNetworkAttempt(null)).result;
				}

				let resolution = yield* resolvePolicy(url);
				admissionLoop: for (;;) {
					if (!resolution.matched) {
						return terminalRateLimit ?? (yield* runNetworkAttempt(null)).result;
					}
					const policy = resolution;
					const reservation = yield* reserve(policy);
					const reservationWaitMs = Math.max(
						0,
						reservation.token.eligibleAtMs - reservation.token.observedAtMs,
					);
					yield* Effect.logWithLevel(reservationWaitMs === 0 ? "Trace" : "Debug")(
						"sandbox HTTP admission reserved",
					).pipe(
						Effect.annotateLogs({
							stage: "reserve",
							waitMs: reservationWaitMs,
							durationMs: reservation.durationMs,
							origin: bounded(policy.origin, 256),
							sandboxWorkflowExecutionId: executionId,
							policyKey: bounded(policy.declaration.key, 128),
							status: reservationWaitMs === 0 ? "immediate" : "delayed",
						}),
					);
					if (reservationWaitMs > 0) {
						yield* sleepUntil(
							`sandbox-http-${request.index}-admission-wait-${waitAttempt++}`,
							reservation.token.eligibleAtMs,
							reservation.token.observedAtMs,
						);
						resolution = yield* resolvePolicy(url);
						if (!resolution.matched) {
							return terminalRateLimit ?? (yield* runNetworkAttempt(null)).result;
						}
						if (!samePolicy(policy, resolution)) {
							continue admissionLoop;
						}
						for (;;) {
							const confirmed = yield* confirm(policy, reservation.token);
							if (confirmed.status === "admitted") {
								break;
							}
							if (confirmed.status === "stale") {
								resolution = yield* resolvePolicy(url);
								continue admissionLoop;
							}
							yield* sleepUntil(
								`sandbox-http-${request.index}-admission-wait-${waitAttempt++}`,
								confirmed.eligibleAtMs,
								confirmed.observedAtMs,
							);
							resolution = yield* resolvePolicy(url);
							if (!resolution.matched) {
								return terminalRateLimit ?? (yield* runNetworkAttempt(null)).result;
							}
							if (!samePolicy(policy, resolution)) {
								continue admissionLoop;
							}
						}
					}

					const attempted = yield* runNetworkAttempt(policy);
					const blockedUntilMs = retryAfterTimestamp(
						attempted.result,
						attempted.responseTimeMs,
						policy.declaration.intervalMs,
					);
					if (blockedUntilMs === null) {
						return attempted.result;
					}
					terminalRateLimit = attempted.result;
					rateLimitCount += 1;
					yield* Effect.logWarning("sandbox HTTP request rate limited").pipe(
						Effect.annotateLogs({
							stage: "rate-limit",
							status: "rate-limited",
							attempt: rateLimitCount,
							origin: bounded(policy.origin, 256),
							sandboxWorkflowExecutionId: executionId,
							policyKey: bounded(policy.declaration.key, 128),
							waitMs: Math.max(0, blockedUntilMs - attempted.responseTimeMs),
						}),
					);
					const blocked = yield* block(policy, blockedUntilMs);
					if (blocked.status === "stale") {
						resolution = yield* resolvePolicy(url);
						continue admissionLoop;
					}
					yield* sleepUntil(
						`sandbox-http-${request.index}-block-wait-${blockWaitAttempt++}`,
						blocked.blockedUntilMs,
						blocked.observedAtMs,
					);
					resolution = yield* resolvePolicy(url);
				}
			});

		const writeLifecycleItems = Effect.fnUntraced(function* <Item, Result>(options: {
			readonly name: string;
			readonly items: ReadonlyArray<Item>;
			readonly warnings: Array<AutomationWarning>;
			readonly result: Schema.Codec<Result, unknown>;
			readonly applyPolicies: (
				pending: PendingRelationshipMutations,
			) => Effect.Effect<PendingRelationshipMutations, SandboxLifecycleHostFailure>;
			readonly prepare: (
				item: Item,
				index: number,
			) => Effect.Effect<
				LifecyclePreparedStep<Result, PendingRelationshipMutations>,
				SandboxLifecycleHostFailure
			>;
			readonly commit: (
				item: Item,
			) => (
				pending: PendingRelationshipMutations,
			) => Effect.Effect<
				LifecyclePreparedStep<Result, PendingRelationshipMutations>,
				SandboxLifecycleHostFailure
			>;
		}) {
			const results = [];
			for (const [index, item] of options.items.entries()) {
				const outcome = yield* runLifecycleWriteStep({
					result: options.result,
					commit: options.commit(item),
					name: `${options.name}-${index}`,
					error: SandboxLifecycleHostFailure,
					applyPolicies: options.applyPolicies,
					pending: PendingRelationshipMutations,
					prepare: options.prepare(item, index),
				});
				options.warnings.push(...outcome.warnings);
				results.push(outcome.result);
			}
			return results;
		});

		const dispatchLifecycleHost = (
			request: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[0],
			payload: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[1],
			principal: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[2],
			executionId: string,
			startedAt: string,
		) =>
			Effect.gen(function* () {
				const capability = request.args.capability;
				const name = `sandbox-host-${request.index}-${capability}`;
				const prepared = yield* makeActivity({
					name: `${name}-input`,
					error: SandboxRunError,
					success: SandboxLifecycleHostInput,
					execute: provideDispatchServices(
						prepareSandboxLifecycleHostInput(request, payload, principal, executionId, startedAt),
					),
				});
				if (prepared._tag === "Failure") {
					return durableHostFailure(prepared.message);
				}
				const steps = implementations.lifecycle;
				const written = yield* Effect.gen(function* () {
					const warnings: Array<AutomationWarning> = [];
					if (prepared._tag === "UpsertGlobalEntities") {
						const outcome = yield* runLifecycleWriteStep({
							name: `${name}-0`,
							result: GlobalEntityUpsertResults,
							pending: PendingGlobalEntityUpsert,
							error: SandboxLifecycleHostFailure,
							applyPolicies: steps.upsertGlobalEntities.applyPolicies,
							commit: (pending) => steps.upsertGlobalEntities.commit(prepared, pending),
							prepare: steps.upsertGlobalEntities.prepare(prepared, {
								planned: [],
								accepted: null,
							}),
						});
						warnings.push(...outcome.warnings);
						return { warnings, value: steps.upsertGlobalEntities.value(outcome.result) };
					}
					if (prepared._tag === "ChangeUserRelationships") {
						const summaries = yield* writeLifecycleItems({
							name,
							warnings,
							items: prepared.batches,
							result: RelationshipBatchSummary,
							commit: () => steps.changeUserRelationships.commit,
							applyPolicies: steps.changeUserRelationships.applyPolicies,
							prepare: (batch, index) =>
								steps.changeUserRelationships.prepare(prepared, batch, index),
						});
						return { warnings, value: steps.changeUserRelationships.value(summaries) };
					}
					const summaries = yield* writeLifecycleItems({
						name,
						warnings,
						items: prepared.groups,
						result: RelationshipReconciliationSummary,
						applyPolicies: steps.upsertGlobalRelationships.applyPolicies,
						commit: (group) => (pending) => steps.upsertGlobalRelationships.commit(group, pending),
						prepare: (group, index) =>
							steps.upsertGlobalRelationships.prepare(prepared, group, index),
					});
					return { warnings, value: steps.upsertGlobalRelationships.value(summaries) };
				}).pipe(
					Effect.map((outcome) => ({ ...outcome, _tag: "written" as const })),
					Effect.catch((error) =>
						Effect.succeed({ _tag: "failed" as const, message: toSandboxHostError(error).message }),
					),
				);
				if (written._tag === "failed") {
					return durableHostFailure(written.message);
				}
				yield* reportSandboxLifecycleWarnings(capability, written.warnings);
				const value = yield* Schema.encodeUnknownEffect(lifecycleHostSuccessSchemas[prepared._tag])(
					written.value,
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					Effect.mapError(
						(error) =>
							new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
					),
				);
				return { value, state: "success" } satisfies WorkflowDurableResult;
			}).pipe(Effect.provideService(LifecycleExecution, lifecycleExecution));

		const dispatchDurableHostCall: SandboxDurableHostDispatcher["Service"]["dispatch"] = (
			request,
			payload,
			principal,
			executionId,
		) => {
			{
				const startedAt = payload.startedAt ?? "";
				const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
				if (!strategy) {
					return Effect.fail(
						new SandboxRunError({
							kind: "script-failure",
							message: `Sandbox durable host capability is not dispatchable: ${request.args.capability}`,
						}),
					);
				}
				if (strategy === "diagnostic") {
					return Effect.fail(
						new SandboxRunError({
							kind: "script-failure",
							message: `Sandbox diagnostic capability must not enter the durable journal: ${request.args.capability}`,
						}),
					);
				}
				if (request.args.capability === "httpCall") {
					return dispatchHttp(request, payload, principal, executionId, startedAt);
				}
				if (strategy === "lifecycle-workflow") {
					return dispatchLifecycleHost(request, payload, principal, executionId, startedAt);
				}
				if (strategy === "activity") {
					return makeActivity({
						error: SandboxRunError,
						success: workflowDurableResultSchema,
						name: `sandbox-host-${request.index}-${request.args.capability}`,
						execute: provideDispatchServices(
							dispatchSandboxHostActivity(
								request,
								payload.input,
								principal,
								executionId,
								startedAt,
							),
						),
					});
				}
				if (strategy === "service-workflow") {
					return engine.execute(SandboxDurableHostServiceWorkflow, {
						executionId: `${executionId}-host-service-${request.index}`,
						payload: {
							request,
							startedAt,
							principal,
							sandbox: payload,
							parentExecutionId: executionId,
						},
					});
				}

				if (strategy === "event-workflow") {
					return Effect.gen(function* () {
						const prepared = yield* makeActivity({
							error: SandboxRunError,
							success: PreparedSandboxCreateEvents,
							name: `prepare-sandbox-create-events-${request.index}`,
							execute: prepareSandboxCreateEvents(
								request,
								payload,
								principal,
								executionId,
								startedAt,
							).pipe(
								Effect.provideService(Database, database),
								Effect.provideService(SandboxRepository, repository),
							),
						});
						const eventPayload = yield* Schema.decodeEffect(EventCreateWorkflowPayload)(
							prepared,
						).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid createEvents payload: ${unknownToMessage(error)}`,
									}),
							),
						);
						const result = yield* Effect.exit(
							engine.execute(EventCreateWorkflow, {
								payload: eventPayload,
								executionId: EventCreateWorkflow.idempotencyKey(eventPayload),
							}),
						);
						if (result._tag === "Failure") {
							if (Cause.hasDies(result.cause) || Cause.hasInterrupts(result.cause)) {
								return yield* Effect.failCause(
									Cause.fromReasons<never>(
										result.cause.reasons.filter(
											(reason): reason is Cause.Die | Cause.Interrupt =>
												!Cause.isFailReason(reason),
										),
									),
								);
							}
							return durableHostFailure(unknownToMessage(result.cause));
						}
						yield* reportSandboxLifecycleWarnings("createEvents", result.value.warnings);
						return result.value.failure
							? durableHostFailure(`Event creation failed: ${result.value.failure.reason.code}`)
							: ({
									state: "success",
									value: { count: result.value.count },
								} satisfies WorkflowDurableResult);
					});
				}

				return Effect.gen(function* () {
					const prepared = yield* makeActivity({
						error: SandboxRunError,
						success: PreparedSandboxSendNotification,
						name: `prepare-sandbox-send-notification-${request.index}`,
						execute: prepareSandboxSendNotification(
							request,
							payload,
							principal,
							executionId,
							startedAt,
						).pipe(
							Effect.provideService(Database, database),
							Effect.provideService(SandboxRepository, repository),
						),
					});
					const notificationPayload = yield* Schema.decodeEffect(
						NotificationDeliveryWorkflowPayload,
					)({
						userId: prepared.userId,
						executionId: prepared.executionId,
						request: { kind: "message", message: prepared.message },
					}).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({
									kind: "invalid-input",
									message: `Invalid sendNotification payload: ${unknownToMessage(error)}`,
								}),
						),
					);
					const result = yield* Effect.exit(
						engine.execute(NotificationDeliveryWorkflow, {
							discard: true,
							payload: notificationPayload,
							executionId: notificationPayload.executionId,
						}),
					);
					if (result._tag === "Failure") {
						if (Cause.hasDies(result.cause) || Cause.hasInterrupts(result.cause)) {
							return yield* Effect.failCause(
								Cause.fromReasons<never>(
									result.cause.reasons.filter(
										(reason): reason is Cause.Die | Cause.Interrupt => !Cause.isFailReason(reason),
									),
								),
							);
						}
						return durableHostFailure(unknownToMessage(result.cause));
					}
					return { value: null, state: "success" } satisfies WorkflowDurableResult;
				});
			}
		};

		// Only an origin proven unmatched runs inline: matched origins need durable admission sleeps.
		const settlesInline = (
			request: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[0],
		) => {
			if (sandboxDurableHostDispatchStrategy(request.args.capability) !== "activity") {
				return Effect.succeed(false);
			}
			const url =
				request.args.capability === "httpCall" ? sandboxDurableHttpRequestUrl(request) : null;
			return url === null
				? Effect.succeed(true)
				: rateLimitAuthority.resolve(url).pipe(
						Effect.map((resolution) => !resolution.matched),
						Effect.orElseSucceed(() => false),
					);
		};

		return {
			dispatch: (request, payload, principal, executionId) =>
				recordHostCall(request, dispatchDurableHostCall(request, payload, principal, executionId)),
			settleInline: (requests, context, principal, executionId, startedAt) =>
				Effect.gen(function* () {
					const eligible = yield* Effect.forEach(requests, settlesInline);
					if (!eligible.every(Boolean)) {
						return null;
					}
					return yield* Effect.forEach(
						requests,
						(request) =>
							recordHostCall(
								request,
								provideDispatchServices(
									dispatchSandboxHostActivity(request, context, principal, executionId, startedAt),
								),
							),
						{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
					);
				}).pipe(Effect.orElseSucceed(() => null)),
		};
	}),
);
