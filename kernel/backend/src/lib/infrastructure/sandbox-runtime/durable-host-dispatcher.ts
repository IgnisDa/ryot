import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	LifecycleCommand,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { createEventItemSchema, sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Cause, Effect, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	runLifecycleWriteStepWith,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { recordSandboxHostCall } from "#lib/infrastructure/runtime-metrics";
import { sandboxDurableHostDispatchStrategy } from "#lib/infrastructure/sandbox-runtime/host-execution-policy";
import {
	SandboxLifecycleHostFailure,
	SandboxLifecycleHostInput,
} from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { SandboxHttpDispatcher } from "#lib/infrastructure/sandbox-runtime/http-dispatcher";
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
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	NotificationDeliveryWorkflow,
	NotificationDeliveryWorkflowPayload,
} from "#modules/notifications/notification-delivery-workflow";
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
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";

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

const recordHostCall = <A extends WorkflowDurableResult | null, E, R>(
	request: Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>[0],
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
) =>
	request.kind === "sleep"
		? request.args.durationMs <= SANDBOX_LIMITS.replay.shortWaitMs
		: sandboxDurableHostDispatchStrategy(request.args.capability) === "activity";

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const receipts = yield* MutationReceipts.make;
		const httpDispatcher = yield* SandboxHttpDispatcher;
		const implementations = yield* SandboxHostImplementations;
		const lifecycleExecution = yield* LifecycleExecution;

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
			progress,
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
					return httpDispatcher.dispatch(
						request,
						payload,
						principal,
						executionId,
						startedAt,
						progress,
					);
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

		return {
			dispatch: (request, payload, principal, executionId, progress) =>
				recordHostCall(
					request,
					dispatchDurableHostCall(request, payload, principal, executionId, progress),
				),
			cancelInline: (executionId, progress) =>
				Effect.forEach(
					progress,
					(entry) =>
						entry._tag === "Http"
							? httpDispatcher.cancel(executionId, entry.progress)
							: Effect.void,
					{ discard: true },
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
							{ settled: boolean; value: WorkflowDurableResult | null },
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
								const value = yield* request.args.capability === "httpCall"
									? recordHostCall(
											request,
											httpDispatcher.inline(
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
											),
										)
									: recordHostCall(
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
