import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	LifecycleCommand,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { createEventItemSchema, sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Cause, Clock, Duration, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";
import { DurableClock, Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	runLifecycleWriteStepWith,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import {
	PROVIDER_HTTP_TICKET_LIMITS,
	ProviderHttpAdmissionBlockResult,
	type ProviderHttpAdmissionDeclaration,
	ProviderHttpAdmissionService,
	ProviderHttpClaim,
	ProviderHttpPoll,
	ProviderHttpRegistration,
	type ProviderHttpTicket,
	providerHttpTicketId,
} from "#lib/infrastructure/provider-http-admission";
import { recordSandboxHostCall } from "#lib/infrastructure/runtime-metrics";
import {
	SandboxLifecycleHostFailure,
	SandboxLifecycleHostInput,
} from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { SandboxHttpRedirect } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
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
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
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
	dispatchSandboxHttpHop,
	durableHostFailure,
	prepareSandboxCreateEvents,
	prepareSandboxLifecycleHostInput,
	prepareSandboxSendNotification,
	runSandboxDurableHostServiceWorkflow,
	sandboxDurableHttpRequestUrl,
	sandboxDurableHostDispatchStrategy,
	sandboxHttpRedirectClassifier,
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";
import { sandboxSchedulingKey } from "#modules/sandbox/scheduling-key";

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

const HttpNetworkAttempt = Schema.Struct({
	durationMs: Schema.Int,
	responseTimeMs: Schema.Int,
	outcome: Schema.Union([
		Schema.TaggedStruct("completed", { result: workflowDurableResultSchema }),
		SandboxHttpRedirect,
	]),
});

class HttpAdmissionCoordinationError extends Schema.TaggedError<HttpAdmissionCoordinationError>()(
	"HttpAdmissionCoordinationError",
	{ stage: Schema.String },
) {}

type MatchedHttpRateLimit = Extract<HttpRateLimitAuthorityResolution, { readonly matched: true }>;

const OVERLOAD_BACKOFF_MS = 30_000;

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

const admissionFailure = (stage: string) => ({
	ProviderHttpAdmissionUnavailable: coordinationError(stage),
	ProviderHttpAdmissionCorruptState: coordinationError(stage),
});

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

// Delay before a matched origin may be retried after a 429, capped so a provider cannot park the
// policy for longer than the honoured limit.
const retryAfterDelay = (
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
	const limit = PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs;
	const fallback = Math.min(limit, intervalMs);
	if (retryAfter === undefined) {
		return fallback;
	}
	const value = retryAfter.trim();
	if (/^\d+$/.test(value)) {
		return Math.min(limit, Number(value) * 1_000);
	}
	const date =
		/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
			value,
		)
			? Date.parse(value)
			: Number.NaN;
	return Number.isFinite(date) && date >= 0 && new Date(date).toUTCString() === value
		? Math.min(limit, Math.max(0, date - responseTimeMs))
		: fallback;
};

const lifecycleHostSuccessSchemas = {
	DeleteEvents: sandboxHostContracts.deleteEvents.success,
	UpdateEvents: sandboxHostContracts.updateEvents.success,
	UpsertGlobalEntities: sandboxHostContracts.upsertGlobalEntities.success,
	ChangeUserRelationships: sandboxHostContracts.changeUserRelationships.success,
	UpsertGlobalRelationships: sandboxHostContracts.upsertGlobalRelationships.success,
};

export const SandboxDurableHostServiceWorkflowLive = implementWorkflow(
	SandboxDurableHostServiceWorkflow,
	(payload) => runSandboxDurableHostServiceWorkflow(payload),
);

const sleepFor = (name: string, waitMs: number) =>
	waitMs <= 0
		? Effect.void
		: DurableClock.sleep({
				name,
				duration: Duration.millis(waitMs),
				inMemoryThreshold: Duration.millis(1),
			});

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
		const engine = yield* WorkflowEngine;
		const receipts = yield* MutationReceipts.make;
		const httpClient = yield* HttpClient.HttpClient;
		const admission = yield* ProviderHttpAdmissionService;
		const implementations = yield* SandboxHostImplementations;
		const lifecycleExecution = yield* LifecycleExecution;
		const rateLimitAuthority = yield* PluginHttpRateLimitAuthority;
		const classify = sandboxHttpRedirectClassifier(rateLimitAuthority.resolve);
		// Lease expiry is the backstop, so a failed cancel never holds the request back.
		const cancelTicket = (
			name: string,
			executionId: string,
			policy: MatchedHttpRateLimit,
			ticket: ProviderHttpTicket,
		) =>
			makeActivity({
				name,
				success: Schema.Void,
				error: HttpAdmissionCoordinationError,
				execute: admission
					.cancel(admissionDeclaration(policy), ticket)
					.pipe(Effect.catchTags(admissionFailure("cancel"))),
			}).pipe(
				Effect.catchTag("HttpAdmissionCoordinationError", () =>
					Effect.logWarning("sandbox HTTP admission coordination failed").pipe(
						Effect.annotateLogs({
							stage: "cancel",
							status: "failed",
							sandboxWorkflowExecutionId: executionId,
						}),
					),
				),
			);

		// Every matched hop reaches the network only after `claim` returns `admitted` for a ticket
		// bound to this execution, request index, hop and 429 attempt.
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
				let overloadWaitAttempt = 0;
				let coordinationAttempt = 0;
				let registrationAttempt = 0;
				let coordinationFailureStreak = 0;
				let coordinationBackoffAttempt = 0;
				let coordinationFailureActive = false;
				let terminalRateLimit: WorkflowDurableResult | undefined;
				const scheduling = yield* sandboxSchedulingKey({
					payload: { principal, lane: payload.lane },
				}).pipe(
					Effect.mapError(
						(error) =>
							new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
					),
				);

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
								SANDBOX_LIMITS.http.coordinationBackoffMs,
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

				const register = (policy: MatchedHttpRateLimit, ticket: ProviderHttpTicket) =>
					coordinate("register", ProviderHttpRegistration, () =>
						admission
							.register(admissionDeclaration(policy), ticket)
							.pipe(Effect.catchTags(admissionFailure("register"))),
					);

				const poll = (policy: MatchedHttpRateLimit, ticket: ProviderHttpTicket) =>
					coordinate("poll", ProviderHttpPoll, () =>
						admission
							.poll(admissionDeclaration(policy), ticket)
							.pipe(Effect.catchTags(admissionFailure("poll"))),
					);

				const claim = (policy: MatchedHttpRateLimit, ticket: ProviderHttpTicket, nonce: string) =>
					coordinate("claim", ProviderHttpClaim, () =>
						admission
							.claim(admissionDeclaration(policy), ticket, nonce)
							.pipe(Effect.catchTags(admissionFailure("claim"))),
					);

				const block = (policy: MatchedHttpRateLimit, delayMs: number) =>
					coordinate("block", ProviderHttpAdmissionBlockResult, () =>
						admission
							.block(admissionDeclaration(policy), delayMs)
							.pipe(Effect.catchTags(admissionFailure("block"))),
					);

				const cancelNow = (policy: MatchedHttpRateLimit, ticket: ProviderHttpTicket) =>
					cancelTicket(
						`sandbox-http-${request.index}-cancel-${coordinationAttempt++}`,
						executionId,
						policy,
						ticket,
					);

				const cancelOnInterrupt = (policy: MatchedHttpRateLimit, ticket: ProviderHttpTicket) => {
					const name = `sandbox-http-${request.index}-cancel-registration-${registrationAttempt++}`;
					return Workflow.addFinalizer(() =>
						Effect.flatMap(WorkflowInstance, (instance) =>
							instance.interrupted ? cancelTicket(name, executionId, policy, ticket) : Effect.void,
						),
					);
				};

				const admit = (
					initial: MatchedHttpRateLimit,
					url: string,
					identity: { readonly hop: number; readonly attempt: number },
				) =>
					Effect.gen(function* () {
						const ticket: ProviderHttpTicket = {
							...scheduling,
							id: providerHttpTicketId({ ...identity, executionId, requestIndex: request.index }),
						};
						let policy = initial;
						let overloadStreak = 0;
						let guardedKey: string | undefined;
						registration: for (;;) {
							const registered = yield* register(policy, ticket);
							if (registered.status === "overloaded") {
								overloadStreak += 1;
								yield* sleepFor(
									`sandbox-http-${request.index}-overload-wait-${overloadWaitAttempt++}`,
									Math.min(OVERLOAD_BACKOFF_MS, 1_000 * 2 ** Math.min(overloadStreak - 1, 5)),
								);
								const resolution = yield* resolvePolicy(url);
								if (!resolution.matched) {
									return resolution;
								}
								policy = resolution;
								continue registration;
							}
							overloadStreak = 0;
							if (guardedKey !== policy.declaration.key) {
								guardedKey = policy.declaration.key;
								yield* cancelOnInterrupt(policy, ticket);
							}
							let nonce = registered.status === "claimed" ? "claimed" : null;
							for (;;) {
								if (nonce === null) {
									const polled = yield* poll(policy, ticket);
									if (polled.status === "retry") {
										continue;
									}
									if (polled.status === "unknown") {
										break;
									}
									if (polled.status === "wait") {
										yield* Effect.logDebug("sandbox HTTP admission waiting").pipe(
											Effect.annotateLogs({
												stage: "poll",
												status: "waiting",
												waitMs: polled.waitMs,
												origin: bounded(policy.origin, 256),
												sandboxWorkflowExecutionId: executionId,
												policyKey: bounded(policy.declaration.key, 128),
											}),
										);
										yield* sleepFor(
											`sandbox-http-${request.index}-admission-wait-${waitAttempt++}`,
											polled.waitMs,
										);
										const resolution = yield* resolvePolicy(url);
										if (!resolution.matched || !samePolicy(policy, resolution)) {
											yield* cancelNow(policy, ticket);
											if (!resolution.matched) {
												return resolution;
											}
											policy = resolution;
											continue registration;
										}
										continue;
									}
									nonce = polled.status === "granted" ? polled.nonce : "claimed";
								}
								const claimed = yield* claim(policy, ticket, nonce);
								nonce = null;
								if (claimed.status === "admitted") {
									yield* Effect.logTrace("sandbox HTTP admission claimed").pipe(
										Effect.annotateLogs({
											stage: "claim",
											status: "admitted",
											origin: bounded(policy.origin, 256),
											sandboxWorkflowExecutionId: executionId,
											policyKey: bounded(policy.declaration.key, 128),
										}),
									);
									return policy;
								}
								if (claimed.status === "unknown") {
									break;
								}
							}
							const resolution = yield* resolvePolicy(url);
							if (!resolution.matched) {
								return resolution;
							}
							policy = resolution;
						}
					});

				const runNetworkAttempt = (
					policy: MatchedHttpRateLimit | null,
					redirect: SandboxHttpRedirect | null,
				) => {
					networkAttempt += 1;
					const attempt = networkAttempt;
					return makeActivity({
						error: SandboxRunError,
						success: HttpNetworkAttempt,
						name: `sandbox-http-${request.index}-network-${attempt}`,
						execute: Effect.gen(function* () {
							const startedAtMs = yield* Clock.currentTimeMillis;
							const outcome = yield* dispatchSandboxHttpHop(
								request,
								payload.input,
								principal,
								payload.lane,
								executionId,
								startedAt,
								redirect,
								classify,
							).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
							const responseTimeMs = yield* Clock.currentTimeMillis;
							const durationMs = Math.max(0, responseTimeMs - startedAtMs);
							yield* Effect.logWithLevel(
								outcome._tag === "completed" ? networkAttemptLogLevel(outcome.result) : "Debug",
							)("sandbox HTTP network attempt completed").pipe(
								Effect.annotateLogs({
									attempt,
									durationMs,
									stage: "network",
									sandboxWorkflowExecutionId: executionId,
									status: outcome._tag === "completed" ? outcome.result.state : outcome._tag,
									...(policy
										? {
												origin: bounded(policy.origin, 256),
												policyKey: bounded(policy.declaration.key, 128),
											}
										: {}),
								}),
							);
							return { outcome, durationMs, responseTimeMs };
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

				const requestUrl = sandboxDurableHttpRequestUrl(request);
				if (requestUrl === null) {
					const attempted = yield* runNetworkAttempt(null, null);
					return attempted.outcome._tag === "completed"
						? attempted.outcome.result
						: yield* new SandboxRunError({
								kind: "infrastructure",
								message: "Sandbox HTTP request without a URL produced a redirect",
							});
				}

				let url = requestUrl;
				let hop = 0;
				let attempt = 0;
				let redirect: SandboxHttpRedirect | null = null;
				let resolution = yield* resolvePolicy(url);
				for (;;) {
					let policy: MatchedHttpRateLimit | null = null;
					if (resolution.matched) {
						const admitted = yield* admit(resolution, url, { hop, attempt });
						if (admitted.matched) {
							policy = admitted;
						}
					}
					if (policy === null && terminalRateLimit) {
						return terminalRateLimit;
					}
					const attempted: typeof HttpNetworkAttempt.Type = yield* runNetworkAttempt(
						policy,
						redirect,
					);
					if (attempted.outcome._tag === "redirected") {
						redirect = attempted.outcome;
						url = redirect.url;
						hop = redirect.hop;
						attempt = 0;
						terminalRateLimit = undefined;
						resolution = yield* resolvePolicy(url);
						continue;
					}
					const result = attempted.outcome.result;
					if (policy === null) {
						return result;
					}
					const delayMs = retryAfterDelay(
						result,
						attempted.responseTimeMs,
						policy.declaration.intervalMs,
					);
					if (delayMs === null) {
						return result;
					}
					terminalRateLimit = result;
					rateLimitCount += 1;
					yield* Effect.logWarning("sandbox HTTP request rate limited").pipe(
						Effect.annotateLogs({
							waitMs: delayMs,
							stage: "rate-limit",
							status: "rate-limited",
							attempt: rateLimitCount,
							origin: bounded(policy.origin, 256),
							sandboxWorkflowExecutionId: executionId,
							policyKey: bounded(policy.declaration.key, 128),
						}),
					);
					const blocked = yield* block(policy, delayMs);
					if (blocked.status === "blocked") {
						yield* sleepFor(
							`sandbox-http-${request.index}-block-wait-${blockWaitAttempt++}`,
							blocked.blockedUntilMs - blocked.observedAtMs,
						);
					}
					attempt += 1;
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
				const outcome = yield* runLifecycleWriteStepWith(lifecycleExecution, {
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
					execute: prepareSandboxLifecycleHostInput(
						implementations,
						request,
						payload,
						principal,
						executionId,
						startedAt,
					),
				});
				if (prepared._tag === "Failure") {
					return durableHostFailure(prepared.message);
				}
				const steps = implementations.lifecycle;
				const written = yield* Effect.gen(function* () {
					const warnings: Array<AutomationWarning> = [];
					if (prepared._tag === "UpsertGlobalEntities") {
						const outcome = yield* runLifecycleWriteStepWith(lifecycleExecution, {
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
					if (prepared._tag === "UpdateEvents") {
						return { warnings, value: yield* steps.updateEvents.commit(prepared) };
					}
					if (prepared._tag === "DeleteEvents") {
						return { warnings, value: yield* steps.deleteEvents.commit(prepared) };
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
			});

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
						execute: dispatchSandboxHostActivity(
							implementations,
							request,
							payload.input,
							principal,
							payload.lane,
							executionId,
							startedAt,
						),
					});
				}
				if (strategy === "service-workflow") {
					return dispatchAdmittedWorkflow(
						receipts,
						engine,
						SandboxDurableHostServiceWorkflow,
						principal.subject.type === "system" ? null : principal.subject.accountGeneration,
						{
							executionId: `${executionId}-host-service-${request.index}`,
							payload: {
								request,
								startedAt,
								principal,
								sandbox: payload,
								parentExecutionId: executionId,
							},
						},
						(registration) =>
							registration.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({ kind: "infrastructure", message: error.message }),
								),
							),
						(execution) => execution,
					);
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
						const result = yield* dispatchAdmittedWorkflow(
							receipts,
							engine,
							EventCreateWorkflow,
							eventPayload.command.accountGeneration,
							{
								payload: eventPayload,
								executionId: EventCreateWorkflow.idempotencyKey(eventPayload),
							},
							(registration) =>
								registration.pipe(
									Effect.mapError(
										(error) =>
											new SandboxRunError({ kind: "infrastructure", message: error.message }),
									),
								),
							Effect.exit,
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
			settleInline: (requests, context, principal, lane, executionId, startedAt) =>
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
								dispatchSandboxHostActivity(
									implementations,
									request,
									context,
									principal,
									lane,
									executionId,
									startedAt,
								),
							),
						{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
					);
				}).pipe(Effect.orElseSucceed(() => null)),
		};
	}),
);
