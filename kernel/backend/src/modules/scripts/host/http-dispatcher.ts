import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	type WorkflowDurableCallRequest,
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import type { SandboxShortWait } from "@ryot-app/sandbox/host/short-wait";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { exponentialBackoffMs } from "@ryot-app/ts-utils/backoff";
import { Clock, Context, Duration, Effect, Exit, Layer, Ref, Schema, Scope } from "effect";
import { HttpClient } from "effect/http";
import { DurableClock, Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	type HttpRateLimitAuthorityResolution,
	PluginHttpRateLimitAuthority,
} from "#modules/plugins/catalog/http-rate-limit-authority";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { sandboxSchedulingKey } from "#modules/scripts/executions/scheduling-key";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import type { ScriptExecutionWorkflowPayload } from "#modules/scripts/executions/workflow-payload";
import {
	dispatchSandboxHttpHop,
	hostCallScopeOf,
	prepareSandboxDurableHttpHop,
	sandboxHttpRedirectClassifier,
} from "#modules/scripts/host/durable-dispatcher";
import {
	PROVIDER_HTTP_TICKET_LIMITS,
	ProviderHttpAdmissionBlockResult,
	type ProviderHttpAdmissionDeclaration,
	ProviderHttpAdmissionService,
	type ProviderHttpTicket,
	providerHttpTicketId,
} from "#modules/scripts/host/http-admission";
import {
	type SandboxHttpHop,
	SandboxHttpRedirect,
} from "#modules/scripts/host/runtime-host-functions";
import { workflowInterruptRequested } from "#platform/workflow/interruption";
import { makeActivity } from "#platform/workflow/scope";

import {
	SandboxHttpPolicy,
	type SandboxHttpProgress,
	SandboxHttpRateLimitResult,
} from "./http-progress";

type HostRequest = Extract<WorkflowDurableCallRequest, { readonly kind: "host" }>;

type MatchedHttpRateLimit = Extract<HttpRateLimitAuthorityResolution, { readonly matched: true }>;

type SandboxHttpDispatcherValue = {
	readonly cancel: (executionId: string, progress: SandboxHttpProgress) => Effect.Effect<void>;
	readonly dispatch: (
		request: HostRequest,
		payload: ScriptExecutionWorkflowPayload,
		principal: ScriptExecutionPrincipal,
		executionId: string,
		startedAt: string,
		progress?: SandboxHttpProgress,
	) => Effect.Effect<WorkflowDurableResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	readonly inline: (
		request: HostRequest,
		payload: ScriptExecutionWorkflowPayload,
		principal: ScriptExecutionPrincipal,
		executionId: string,
		startedAt: string,
		wait: SandboxShortWait,
		checkpoint: (progress: SandboxHttpProgress) => Effect.Effect<void>,
	) => Effect.Effect<null | WorkflowDurableResult, SandboxRunError>;
};

const HttpRateLimitResolution = Schema.Union([
	SandboxHttpPolicy,
	Schema.Struct({
		durationMs: Schema.Int,
		matched: Schema.Literal(false),
		origin: Schema.optional(Schema.String),
		reason: Schema.Literals(["invalid-url", "non-http-url", "undeclared-origin"]),
	}),
]);

const HttpAdmission = Schema.Union([
	Schema.TaggedStruct("Settled", {
		resolution: HttpRateLimitResolution,
		cleanupPolicy: Schema.NullOr(SandboxHttpPolicy),
	}),
	Schema.TaggedStruct("Interrupted", { cleanupPolicy: Schema.NullOr(SandboxHttpPolicy) }),
]);

const HttpNetworkAttempt = Schema.Struct({
	durationMs: Schema.Int,
	responseTimeMs: Schema.Int,
	outcome: Schema.Union([
		Schema.TaggedStruct("completed", { result: workflowDurableResultSchema }),
		SandboxHttpRedirect,
	]),
});

type InlineHttpSettlement = {
	readonly wait: SandboxShortWait;
	readonly checkpoint: (progress: SandboxHttpProgress) => Effect.Effect<void>;
};

class SandboxHttpInlineDeferred extends Schema.TaggedError<
	SandboxHttpInlineDeferred,
	{ readonly brand: unique symbol }
>()("SandboxHttpInlineDeferred", {}) {}

class HttpAdmissionCoordinationError extends Schema.TaggedError<
	HttpAdmissionCoordinationError,
	{ readonly brand: unique symbol }
>()("HttpAdmissionCoordinationError", { stage: Schema.String }) {}

const bounded = (value: string, length: number) => value.slice(0, length);

const policyLogFields = (policy: MatchedHttpRateLimit) => ({
	origin: bounded(policy.origin, 256),
	policyKey: bounded(policy.declaration.key, 128),
});

const resolutionLogFields = (resolution: HttpRateLimitAuthorityResolution) => {
	if (resolution.matched) {
		return policyLogFields(resolution);
	}
	return resolution.origin ? { origin: bounded(resolution.origin, 256) } : {};
};

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

const coordinator = <PauseE, PauseR>(
	executionId: string,
	pause: (backoffMs: number) => Effect.Effect<void, PauseE, PauseR>,
) => {
	let failureStreak = 0;
	let failureActive = false;
	return <A, R>(
		stage: string,
		run: () => Effect.Effect<A, SandboxHttpInlineDeferred | HttpAdmissionCoordinationError, R>,
	) =>
		Effect.gen(function* () {
			for (;;) {
				const outcome = yield* run().pipe(
					Effect.map((value) => ({ value, success: true as const })),
					Effect.catchTag("HttpAdmissionCoordinationError", (error) =>
						Effect.succeed({ error, success: false as const }),
					),
				);
				if (outcome.success) {
					if (failureActive) {
						yield* Effect.logInfo("sandbox HTTP admission coordination recovered").pipe(
							Effect.annotateLogs({
								status: "recovered",
								stage: bounded(stage, 32),
								sandboxWorkflowExecutionId: executionId,
							}),
						);
					}
					failureStreak = 0;
					failureActive = false;
					return outcome.value;
				}
				failureStreak += 1;
				if (!failureActive) {
					failureActive = true;
					yield* Effect.logWarning("sandbox HTTP admission coordination failed").pipe(
						Effect.annotateLogs({
							status: "failed",
							sandboxWorkflowExecutionId: executionId,
							stage: bounded(outcome.error.stage, 32),
						}),
					);
				}
				yield* pause(
					exponentialBackoffMs(failureStreak, SANDBOX_LIMITS.http.coordinationBackoffMs),
				);
			}
		});
};

const cancelFailed = (executionId: string) =>
	Effect.logWarning("sandbox HTTP admission coordination failed").pipe(
		Effect.annotateLogs({
			stage: "cancel",
			status: "failed",
			sandboxWorkflowExecutionId: executionId,
		}),
	);

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

const retryAfterDelay = (
	result: typeof SandboxHttpRateLimitResult.Type,
	responseTimeMs: number,
	intervalMs: number,
) => {
	const data = result.error.data;
	const headers = data.headers;
	let retryAfter: string | undefined;
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === "retry-after") {
			retryAfter = value;
			break;
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

const sleepFor = (name: string, waitMs: number) =>
	waitMs <= 0
		? Effect.void
		: DurableClock.sleep({
				name,
				duration: Duration.millis(waitMs),
				inMemoryThreshold: Duration.millis(1),
			});

const makeSandboxHttpDispatcher = Effect.gen(function* () {
	const executionAuthority = yield* SandboxExecutionAuthority;
	const engine = yield* WorkflowEngine;
	const httpClient = yield* HttpClient.HttpClient;
	const admission = yield* ProviderHttpAdmissionService;
	const rateLimitAuthority = yield* PluginHttpRateLimitAuthority;
	const classify = sandboxHttpRedirectClassifier(rateLimitAuthority.resolve);
	const cancelAdmission = (
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) => admission.cancel(declaration, ticket).pipe(Effect.catchTags(admissionFailure("cancel")));
	// Lease expiry is the backstop, so a failed cancel never holds the request back.
	const cancelTicket = (
		name: string,
		executionId: string,
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) =>
		makeActivity({
			name,
			success: Schema.Void,
			error: HttpAdmissionCoordinationError,
			execute: cancelAdmission(declaration, ticket),
		}).pipe(Effect.catchTag("HttpAdmissionCoordinationError", () => cancelFailed(executionId)));
	const cancelNow = (
		executionId: string,
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) =>
		cancelAdmission(declaration, ticket).pipe(
			Effect.catchTag("HttpAdmissionCoordinationError", () => cancelFailed(executionId)),
		);
	const cancelProgress = (executionId: string, progress: SandboxHttpProgress) =>
		progress.cleanup
			? cancelNow(executionId, progress.cleanup.declaration, progress.cleanup.ticket)
			: Effect.void;
	const resolveNow = (executionId: string, url: string) =>
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
			Effect.tap((resolution) =>
				Effect.logTrace("sandbox HTTP policy resolution completed").pipe(
					Effect.annotateLogs({
						stage: "resolve",
						durationMs: resolution.durationMs,
						sandboxWorkflowExecutionId: executionId,
						status: resolution.matched ? "matched" : resolution.reason,
						...resolutionLogFields(resolution),
					}),
				),
			),
		);

	const run = Effect.fnUntraced(function* (
		request: HostRequest,
		payload: ScriptExecutionWorkflowPayload,
		principal: ScriptExecutionPrincipal,
		executionId: string,
		startedAt: string,
		progress?: SandboxHttpProgress,
		inline?: InlineHttpSettlement,
	) {
		let rateLimitCount = 0;
		const scope = hostCallScopeOf(payload, principal, executionId, startedAt);
		let state: SandboxHttpProgress;
		if (progress) {
			state = progress;
		} else {
			const prepared = yield* prepareSandboxDurableHttpHop(request, scope);
			if (prepared._tag === "completed") {
				return prepared.result;
			}
			state = {
				attempt: 0,
				cleanup: null,
				networkAttempt: 0,
				blockWaitAttempt: 0,
				admissionAttempt: 0,
				coordinationAttempt: 0,
				registrationAttempt: 0,
				current: prepared.current,
				coordinationBackoffAttempt: 0,
				phase: { rateLimit: null, _tag: "Admitting" },
			};
		}
		const next = (
			counter:
				| "admissionAttempt"
				| "blockWaitAttempt"
				| "coordinationAttempt"
				| "registrationAttempt"
				| "coordinationBackoffAttempt",
		) => {
			const value = state[counter];
			state = { ...state, [counter]: value + 1 };
			return value;
		};
		const save = () => inline?.checkpoint(state) ?? Effect.void;
		const pause = Effect.fnUntraced(function* (durationMs: number) {
			yield* save();
			if (inline) {
				if (!(yield* inline.wait.wait(Math.max(0, durationMs)))) {
					return yield* new SandboxHttpInlineDeferred();
				}
			} else {
				yield* Effect.sleep(Duration.millis(Math.max(0, durationMs)));
			}
			return undefined;
		});
		const scheduling = yield* sandboxSchedulingKey({
			payload: { principal, lane: payload.lane },
		}).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
			),
		);

		const coordinateDurably = coordinator(executionId, (backoffMs) =>
			inline
				? pause(backoffMs)
				: DurableClock.sleep({
						duration: Duration.millis(backoffMs),
						inMemoryThreshold: Duration.millis(1),
						name: `sandbox-http-${request.index}-coordination-backoff-${next("coordinationBackoffAttempt")}`,
					}),
		);

		const step = <Success extends Schema.Top, Failure extends Schema.Top>(operation: {
			readonly name: string;
			readonly error: Failure;
			readonly success: Success;
			readonly execute: Effect.Effect<Success["Type"], Failure["Type"]>;
		}) => (inline ? operation.execute : makeActivity(operation));

		const coordinate = <Success extends Schema.Top>(
			stage: string,
			success: Success,
			execute: () => Effect.Effect<Success["Type"], HttpAdmissionCoordinationError>,
		) =>
			coordinateDurably(stage, () =>
				step({
					success,
					execute: execute(),
					error: HttpAdmissionCoordinationError,
					name: `sandbox-http-${request.index}-${stage}-${next("coordinationAttempt")}`,
				}),
			);

		const block = (declaration: ProviderHttpAdmissionDeclaration, delayMs: number) =>
			coordinate("block", ProviderHttpAdmissionBlockResult, () =>
				admission.block(declaration, delayMs).pipe(Effect.catchTags(admissionFailure("block"))),
			);
		const finishBlock = Effect.fnUntraced(function* (
			phase: Extract<SandboxHttpProgress["phase"], { readonly _tag: "ApplyingRateLimitBlock" }>,
		) {
			const blocked = yield* block(phase.declaration, phase.delayMs);
			state = { ...state, attempt: state.attempt + 1 };
			if (blocked.status === "blocked") {
				const durationMs = blocked.blockedUntilMs - blocked.observedAtMs;
				state = {
					...state,
					phase: {
						rateLimit: phase.rateLimit,
						_tag: "WaitingForRateLimitBlock",
						blockedUntilMs: (yield* Clock.currentTimeMillis) + durationMs,
					},
				};
				const name = `sandbox-http-${request.index}-block-wait-${next("blockWaitAttempt")}`;
				yield* inline ? pause(durationMs) : sleepFor(name, durationMs);
			}
			state = { ...state, phase: { _tag: "Admitting", rateLimit: phase.rateLimit } };
		});

		const cancelOnInterrupt = (
			policy: Ref.Ref<null | MatchedHttpRateLimit>,
			ticket: ProviderHttpTicket,
		) => {
			if (inline) {
				return Effect.void;
			}
			const name = `sandbox-http-${request.index}-cancel-registration-${next("registrationAttempt")}`;
			return Workflow.addFinalizer(() =>
				Effect.flatMap(WorkflowInstance, (instance) =>
					instance.interrupted
						? Effect.flatMap(Ref.get(policy), (current) =>
								current
									? cancelTicket(name, executionId, admissionDeclaration(current), ticket)
									: Effect.void,
							)
						: Effect.void,
				),
			);
		};

		// Waits stay in memory: a suspended workflow replays its journal on every wake, and the
		// grant lease is shorter than that replay under load. A re-executed admission is safe
		// because registration is idempotent and a claimed ticket stays claimed.
		const admitInMemory = (
			initial: typeof SandboxHttpPolicy.Type,
			url: string,
			ticket: ProviderHttpTicket,
			activePolicy: Ref.Ref<null | MatchedHttpRateLimit>,
		) =>
			Effect.suspend(() => {
				let policy = initial;
				const coordinateNow = coordinator(executionId, pause);
				const resolve = () => coordinateNow("resolve", () => resolveNow(executionId, url));
				const cancelIfInterrupted = () =>
					workflowInterruptRequested.pipe(
						Effect.tap((requested) =>
							requested
								? cancelNow(executionId, admissionDeclaration(policy), ticket)
								: Effect.void,
						),
					);
				return Effect.gen(function* () {
					let overloadStreak = 0;
					registration: for (;;) {
						yield* Ref.set(activePolicy, policy);
						state = { ...state, cleanup: { ticket, declaration: admissionDeclaration(policy) } };
						yield* save();
						if (yield* cancelIfInterrupted()) {
							return { cleanupPolicy: policy, _tag: "Interrupted" as const };
						}
						const registered = yield* coordinateNow("register", () =>
							admission
								.register(admissionDeclaration(policy), ticket)
								.pipe(Effect.catchTags(admissionFailure("register"))),
						);
						if (registered.status === "overloaded") {
							overloadStreak += 1;
							yield* pause(
								exponentialBackoffMs(overloadStreak, SANDBOX_LIMITS.http.coordinationBackoffMs),
							);
							const resolution = yield* resolve();
							if (!resolution.matched) {
								return { resolution, cleanupPolicy: policy, _tag: "Settled" as const };
							}
							policy = resolution;
							continue registration;
						}
						overloadStreak = 0;
						let nonce = registered.status === "claimed" ? "claimed" : null;
						for (;;) {
							if (nonce === null) {
								if (yield* cancelIfInterrupted()) {
									return { cleanupPolicy: policy, _tag: "Interrupted" as const };
								}
								const polled = yield* coordinateNow("poll", () =>
									admission
										.poll(admissionDeclaration(policy), ticket)
										.pipe(Effect.catchTags(admissionFailure("poll"))),
								);
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
											...policyLogFields(policy),
											waitMs: polled.waitMs,
											sandboxWorkflowExecutionId: executionId,
										}),
									);
									yield* pause(polled.waitMs);
									const resolution = yield* resolve();
									if (!resolution.matched || !samePolicy(policy, resolution)) {
										yield* cancelNow(executionId, admissionDeclaration(policy), ticket);
										if (!resolution.matched) {
											return { resolution, cleanupPolicy: policy, _tag: "Settled" as const };
										}
										policy = resolution;
										continue registration;
									}
									continue;
								}
								nonce = polled.status === "granted" ? polled.nonce : "claimed";
							}
							const current = policy;
							const grant = nonce;
							const claimed = yield* coordinateNow("claim", () =>
								admission
									.claim(admissionDeclaration(current), ticket, grant)
									.pipe(Effect.catchTags(admissionFailure("claim"))),
							);
							nonce = null;
							if (claimed.status === "admitted") {
								yield* Effect.logTrace("sandbox HTTP admission claimed").pipe(
									Effect.annotateLogs({
										...policyLogFields(policy),
										stage: "claim",
										status: "admitted",
										sandboxWorkflowExecutionId: executionId,
									}),
								);
								return { resolution: policy, cleanupPolicy: policy, _tag: "Settled" as const };
							}
							if (claimed.status === "unknown") {
								break;
							}
						}
						const resolution = yield* resolve();
						if (!resolution.matched) {
							return { resolution, cleanupPolicy: policy, _tag: "Settled" as const };
						}
						policy = resolution;
					}
				});
			});

		const admit = (current: SandboxHttpHop, attempt: number) =>
			Effect.gen(function* () {
				const ticket: ProviderHttpTicket = {
					...scheduling,
					id: providerHttpTicketId({
						attempt,
						executionId,
						hop: current.hop,
						requestIndex: request.index,
					}),
				};
				const activePolicy = yield* Ref.make<null | MatchedHttpRateLimit>(null);
				yield* cancelOnInterrupt(activePolicy, ticket);
				const admitted = yield* coordinateDurably("admission", () => {
					const name = `sandbox-http-${request.index}-admission-${next("admissionAttempt")}`;
					const execute = Effect.gen(function* () {
						const resolution = yield* resolveNow(executionId, current.url);
						return resolution.matched
							? yield* admitInMemory(resolution, current.url, ticket, activePolicy)
							: { resolution, cleanupPolicy: null, _tag: "Settled" as const };
					});
					return inline
						? execute
						: makeActivity({
								name,
								success: HttpAdmission,
								error: HttpAdmissionCoordinationError,
								execute: execute.pipe(Effect.catchTag("SandboxHttpInlineDeferred", Effect.die)),
							});
				});
				yield* Ref.set(activePolicy, admitted.cleanupPolicy);
				if (admitted._tag === "Interrupted") {
					if (inline) {
						return yield* new SandboxHttpInlineDeferred();
					}
					return yield* Workflow.suspend(yield* WorkflowInstance);
				}
				return admitted;
			});

		const runNetworkAttempt = (policy: null | MatchedHttpRateLimit, current: SandboxHttpHop) => {
			state = { ...state, networkAttempt: state.networkAttempt + 1 };
			const attempt = state.networkAttempt;
			return step({
				error: SandboxRunError,
				success: HttpNetworkAttempt,
				name: `sandbox-http-${request.index}-network-${attempt}`,
				execute: Effect.gen(function* () {
					yield* executionAuthority.resolve(principal);
					const startedAtMs = yield* Clock.currentTimeMillis;
					const outcome = yield* dispatchSandboxHttpHop(request, scope, current, classify).pipe(
						Effect.provideService(HttpClient.HttpClient, httpClient),
					);
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
							...(policy ? policyLogFields(policy) : {}),
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

		for (;;) {
			yield* save();
			const phase = state.phase;
			if (phase._tag === "ApplyingRateLimitBlock") {
				yield* finishBlock(phase);
				continue;
			}
			if (phase._tag === "WaitingForRateLimitBlock") {
				yield* sleepFor(
					`sandbox-http-${request.index}-block-resume`,
					phase.blockedUntilMs - (yield* Clock.currentTimeMillis),
				);
				state = { ...state, phase: { _tag: "Admitting", rateLimit: phase.rateLimit } };
				continue;
			}
			const current = state.current;
			let policy: null | MatchedHttpRateLimit = null;
			const admitted = yield* admit(current, state.attempt);
			if (admitted.resolution.matched) {
				policy = admitted.resolution;
			}
			if (policy === null && phase.rateLimit) {
				return phase.rateLimit;
			}
			const attempted: typeof HttpNetworkAttempt.Type = yield* runNetworkAttempt(policy, current);
			if (attempted.outcome._tag === "redirected") {
				state = {
					...state,
					attempt: 0,
					current: attempted.outcome.next,
					phase: { rateLimit: null, _tag: "Admitting" },
				};
				continue;
			}
			const result = attempted.outcome.result;
			if (policy === null || !Schema.is(SandboxHttpRateLimitResult)(result)) {
				return result;
			}
			const delayMs = retryAfterDelay(
				result,
				attempted.responseTimeMs,
				policy.declaration.intervalMs,
			);
			rateLimitCount += 1;
			yield* Effect.logWarning("sandbox HTTP request rate limited").pipe(
				Effect.annotateLogs({
					waitMs: delayMs,
					stage: "rate-limit",
					status: "rate-limited",
					...policyLogFields(policy),
					attempt: rateLimitCount,
					sandboxWorkflowExecutionId: executionId,
				}),
			);
			state = {
				...state,
				phase: {
					delayMs,
					rateLimit: result,
					_tag: "ApplyingRateLimitBlock",
					declaration: admissionDeclaration(policy),
				},
			};
		}
	});

	return {
		cancel: cancelProgress,
		dispatch: (...args: Parameters<SandboxHttpDispatcherValue["dispatch"]>) =>
			run(...args).pipe(Effect.catchTag("SandboxHttpInlineDeferred", Effect.die)),
		inline: (request, payload, principal, executionId, startedAt, wait, checkpoint) =>
			Effect.scoped(
				Effect.gen(function* () {
					const scope = yield* Effect.acquireRelease(Scope.make(), (resource) =>
						Scope.close(resource, Exit.void),
					);
					// This view supplies only the persisted parent interrupt lookup; live calls do not run workflow activities.
					const identity = WorkflowInstance.initial(ScriptExecutionWorkflow, executionId, {
						scope,
					});
					let latest: undefined | SandboxHttpProgress;
					return yield* run(request, payload, principal, executionId, startedAt, undefined, {
						wait,
						checkpoint: (state) =>
							Effect.sync(() => {
								latest = state;
							}).pipe(Effect.andThen(checkpoint(state))),
					}).pipe(
						Effect.catchTag("SandboxHttpInlineDeferred", () => Effect.succeed(null)),
						Effect.onInterrupt(() => (latest ? cancelProgress(executionId, latest) : Effect.void)),
						Effect.provideService(WorkflowInstance, identity),
						Effect.provideService(WorkflowEngine, engine),
					);
				}),
			),
	} satisfies SandboxHttpDispatcherValue;
});

export class SandboxHttpDispatcher extends Context.Service<
	SandboxHttpDispatcher,
	SandboxHttpDispatcherValue
>()("SandboxHttpDispatcher", { make: makeSandboxHttpDispatcher }) {
	static readonly layer = Layer.effect(this, this.make);
}
