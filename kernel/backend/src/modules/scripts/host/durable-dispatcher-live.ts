import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { sandboxDurableHostDispatchStrategy } from "@ryot-app/sandbox/host/host-execution-policy";
import { toSandboxHostError } from "@ryot-app/sandbox/host/invocation";
import { recordSandboxHostCall } from "@ryot-app/sandbox/host/metrics";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Cause, Effect, Layer, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { runLifecycleWriteInline } from "#modules/automations/lifecycle/write-step";
import { isFoldBusy } from "#modules/derived-values/service";
import { EventCreateInput } from "#modules/events/event-create";
import { toSandboxCreateEventsResult } from "#modules/events/script-host";
import { EventsService } from "#modules/events/service";
import { NotificationsService } from "#modules/notifications/service";
import { infrastructureRunError } from "#modules/scripts/executions/run-error";
import {
	dispatchSandboxHostActivity,
	durableHostFailure,
	type HostCallScope,
	hostCallScopeOf,
	prepareSandboxCreateEvents,
	prepareSandboxLifecycleHostInput,
	prepareSandboxSendNotification,
	SandboxDurableHostDispatcher,
} from "#modules/scripts/host/durable-dispatcher";
import { reportSandboxLifecycleWarnings } from "#modules/scripts/host/execution-context";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { SandboxHttpDispatcher } from "#modules/scripts/host/http-dispatcher";
import {
	SandboxLifecycleHostFailure,
	writeInlineLifecycleItems,
} from "#modules/scripts/host/lifecycle-host";
import { makeActivity } from "#platform/workflow/scope";

const lifecycleHostSuccessSchemas = {
	DeleteEvents: sandboxHostContracts.deleteEvents.success,
	UpdateEvents: sandboxHostContracts.updateEvents.success,
	UpsertGlobalEntities: sandboxHostContracts.upsertGlobalEntities.success,
	ChangeUserRelationships: sandboxHostContracts.changeUserRelationships.success,
	UpsertGlobalRelationships: sandboxHostContracts.upsertGlobalRelationships.success,
};

const failureOrRethrow = (cause: Cause.Cause<unknown>) => {
	if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) {
		return Effect.failCause(
			Cause.fromReasons<never>(
				cause.reasons.filter(
					(reason): reason is Cause.Die | Cause.Interrupt => !Cause.isFailReason(reason),
				),
			),
		);
	}
	if (cause.reasons.some((reason) => Cause.isFailReason(reason) && isFoldBusy(reason.error))) {
		return Effect.fail(
			new SandboxRunError({
				kind: "resource-unavailable",
				message: "Script capacity is busy; retry the save",
			}),
		);
	}
	return Effect.succeed(durableHostFailure(unknownToMessage(cause)));
};

type DispatchArguments = Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>;

const recordHostCall = <A extends null | WorkflowDurableResult, E, R>(
	request: DispatchArguments[0],
	effect: Effect.Effect<A, E, R>,
) =>
	effect.pipe(
		Effect.onExit((exit) =>
			exit._tag === "Success" && exit.value === null
				? Effect.void
				: recordSandboxHostCall({
						function: request.args.capability,
						outcome:
							exit._tag === "Success" && exit.value?.state === "success" ? "success" : "failure",
					}),
		),
	);

const settlesInline = (
	request: Parameters<SandboxDurableHostDispatcher["Service"]["settleInline"]>[0][number],
) => {
	if (request.kind === "sleep") {
		return request.args.durationMs <= SANDBOX_LIMITS.replay.shortWaitMs;
	}
	const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
	return strategy !== null && strategy !== "diagnostic";
};

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const authority = yield* SandboxExecutionAuthority;
		const httpDispatcher = yield* SandboxHttpDispatcher;
		const implementations = yield* ScriptHostImplementations;
		const lifecycleExecution = yield* LifecycleExecution;
		const notifications = yield* NotificationsService;
		const events = yield* EventsService;

		const dispatchLifecycleHost = (request: DispatchArguments[0], scope: HostCallScope) =>
			Effect.gen(function* () {
				const capability = request.args.capability;
				const prepared = yield* prepareSandboxLifecycleHostInput(implementations, request, scope);
				if (prepared._tag === "Failure") {
					return durableHostFailure(prepared.message, prepared.data);
				}
				const steps = implementations.lifecycle;
				const written = yield* Effect.gen(function* () {
					if (prepared._tag === "UpsertGlobalEntities") {
						const outcome = yield* runLifecycleWriteInline(lifecycleExecution, {
							applyPolicies: steps.upsertGlobalEntities.applyPolicies,
							commit: (pending) => steps.upsertGlobalEntities.commit(prepared, pending),
							prepare: steps.upsertGlobalEntities.prepare(prepared, {
								planned: [],
								accepted: null,
							}),
						});
						yield* reportSandboxLifecycleWarnings(capability, outcome.warnings);
						return steps.upsertGlobalEntities.value(outcome.result);
					}
					if (prepared._tag === "UpdateEvents") {
						return yield* steps.updateEvents.commit(prepared);
					}
					if (prepared._tag === "DeleteEvents") {
						return yield* steps.deleteEvents.commit(prepared);
					}
					if (prepared._tag === "ChangeUserRelationships") {
						return steps.changeUserRelationships.value(
							yield* writeInlineLifecycleItems(lifecycleExecution, {
								capability,
								...steps.changeUserRelationships.itemWrite(prepared),
							}),
						);
					}
					return steps.upsertGlobalRelationships.value(
						yield* writeInlineLifecycleItems(lifecycleExecution, {
							capability,
							...steps.upsertGlobalRelationships.itemWrite(prepared),
						}),
					);
				}).pipe(
					Effect.map((value) => ({ value, _tag: "written" as const })),
					Effect.catch((error) =>
						error instanceof SandboxLifecycleHostFailure && error.capacityDeferred
							? Effect.fail(
									new SandboxRunError({
										kind: "resource-unavailable",
										message: "Script capacity is busy; retry the save",
									}),
								)
							: Effect.succeed({ ...toSandboxHostError(error), _tag: "failed" as const }),
					),
				);
				if (written._tag === "failed") {
					return durableHostFailure(written.message, written.data);
				}
				const value = yield* Schema.encodeUnknownEffect(lifecycleHostSuccessSchemas[prepared._tag])(
					written.value,
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					Effect.mapError(infrastructureRunError),
				);
				return { value, state: "success" } satisfies WorkflowDurableResult;
			});

		const createEventsHostCall = (request: DispatchArguments[0], scope: HostCallScope) =>
			Effect.gen(function* () {
				const prepared = yield* prepareSandboxCreateEvents(request, scope);
				const eventPayload = yield* Schema.decodeEffect(EventCreateInput)(prepared).pipe(
					Effect.mapError(
						(error) =>
							new SandboxRunError({
								kind: "invalid-input",
								message: `Invalid createEvents payload: ${unknownToMessage(error)}`,
							}),
					),
				);
				const result = yield* events.create(eventPayload).pipe(Effect.exit);
				if (result._tag === "Failure") {
					return yield* failureOrRethrow(result.cause);
				}
				return yield* toSandboxCreateEventsResult(result.value).pipe(
					Effect.match({
						onFailure: (error) => durableHostFailure(error.message, error.data),
						onSuccess: (value) => ({ value, state: "success" }) satisfies WorkflowDurableResult,
					}),
				);
			});

		const sendNotificationHostCall = (request: DispatchArguments[0], scope: HostCallScope) =>
			Effect.gen(function* () {
				const prepared = yield* prepareSandboxSendNotification(request, scope);
				const result = yield* Effect.exit(notifications.sendMessage(prepared));
				if (result._tag === "Failure") {
					return yield* failureOrRethrow(result.cause);
				}
				return { value: null, state: "success" } satisfies WorkflowDurableResult;
			});

		const runHostCall = (request: DispatchArguments[0], scope: HostCallScope) => {
			const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
			if (strategy === "lifecycle") {
				return dispatchLifecycleHost(request, scope);
			}
			if (strategy === "events") {
				return createEventsHostCall(request, scope);
			}
			if (strategy === "notification") {
				return sendNotificationHostCall(request, scope);
			}
			return dispatchSandboxHostActivity(implementations, request, scope);
		};

		const dispatchDurableHostCall: SandboxDurableHostDispatcher["Service"]["dispatch"] = (
			request,
			payload,
			principal,
			executionId,
			progress,
		) => {
			const { startedAt } = payload;
			const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
			if (strategy === null || strategy === "diagnostic") {
				return Effect.fail(
					new SandboxRunError({
						kind: "script-failure",
						message:
							strategy === null
								? `Sandbox durable host capability is not dispatchable: ${request.args.capability}`
								: `Sandbox diagnostic capability must not enter the durable journal: ${request.args.capability}`,
					}),
				);
			}
			const resolved = authority.resolve(principal);
			if (request.args.capability === "httpCall") {
				return Effect.andThen(
					resolved,
					httpDispatcher.dispatch(request, payload, principal, executionId, startedAt, progress),
				);
			}
			return Effect.andThen(
				resolved,
				makeActivity({
					error: SandboxRunError,
					success: workflowDurableResultSchema,
					name: `sandbox-host-${request.index}-${request.args.capability}`,
					execute: runHostCall(
						request,
						hostCallScopeOf(payload, principal, executionId, startedAt),
					),
				}),
			);
		};

		return {
			dispatch: (request, payload, principal, executionId, progress) =>
				recordHostCall(
					request,
					dispatchDurableHostCall(request, payload, principal, executionId, progress),
				),
			settleInline: (
				requests,
				context,
				principal,
				lane,
				executionId,
				startedAt,
				wait,
				checkpoint,
			) =>
				Effect.gen(function* () {
					if (!requests.every(settlesInline)) {
						return null;
					}
					const input = yield* Schema.decodeUnknownEffect(jsonValueSchema)(context).pipe(
						Effect.orDie,
					);
					const results = yield* Effect.forEach(
						requests,
						(
							request,
						): Effect.Effect<
							{ settled: boolean; value: null | WorkflowDurableResult },
							SandboxRunError
						> =>
							Effect.gen(function* () {
								if (request.kind === "sleep") {
									const settled = yield* wait.wait(request.args.durationMs);
									if (settled) {
										yield* checkpoint({ request, value: null, _tag: "Completed" });
									}
									return { settled, value: null };
								}
								const scope = { lane, context, principal, startedAt, executionId };
								const value = yield* recordHostCall(
									request,
									Effect.andThen(
										authority.resolve(principal),
										request.args.capability === "httpCall"
											? httpDispatcher.inline(
													request,
													{
														lane,
														input,
														executionId,
														resolutionMode: "exact",
														subject: principal.subject,
														scriptId: principal.scriptId,
													},
													principal,
													executionId,
													startedAt,
													wait,
													(progress) => checkpoint({ request, progress, _tag: "Http" }),
												)
											: runHostCall(request, scope),
									),
								);
								if (value === null) {
									return { value, settled: false };
								}
								const json = yield* Schema.decodeUnknownEffect(jsonValueSchema)(value).pipe(
									Effect.orDie,
								);
								yield* checkpoint({ request, value: json, _tag: "Completed" });
								return { value, settled: true };
							}),
						{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
					);
					return results.every((result) => result.settled)
						? results.map((result) => result.value)
						: null;
				}).pipe(Effect.orElseSucceed(() => null)),
		};
	}),
).pipe(Layer.provide(SandboxHttpDispatcher.layer));
