import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { createEventItemSchema, sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
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
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { runLifecycleWriteStepWith } from "#modules/automations/lifecycle/write-step";
import { GlobalEntityUpsertResults, PendingGlobalEntityUpsert } from "#modules/entities/service";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import { toSandboxCreateEventsResult } from "#modules/events/script-host";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	NotificationDeliveryWorkflow,
	NotificationDeliveryWorkflowPayload,
} from "#modules/notifications/notification-delivery-workflow";
import { PendingRelationshipMutations } from "#modules/relationships/mutation-pipeline";
import { infrastructureRunError } from "#modules/scripts/executions/run-error";
import {
	dispatchSandboxHostActivity,
	type HostCallScope,
	hostCallScopeOf,
	durableHostFailure,
	prepareSandboxCreateEvents,
	prepareSandboxLifecycleHostInput,
	prepareSandboxSendNotification,
	runSandboxDurableHostServiceWorkflow,
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/scripts/host/durable-dispatcher";
import { reportSandboxLifecycleWarnings } from "#modules/scripts/host/execution-context";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { SandboxHttpDispatcher } from "#modules/scripts/host/http-dispatcher";
import { SandboxHttpProgress } from "#modules/scripts/host/http-progress";
import {
	type LifecycleItemWrite,
	SandboxLifecycleHostFailure,
	SandboxLifecycleHostInput,
} from "#modules/scripts/host/lifecycle-host";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

const PreparedSandboxCreateEvents = Schema.Struct({
	userId: UserId,
	command: DomainLifecycleCommand,
	payload: Schema.Array(createEventItemSchema),
	writeCommand: Schema.optional(DomainLifecycleCommand),
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

const failureOrRethrow = (cause: Cause.Cause<unknown>) =>
	Cause.hasDies(cause) || Cause.hasInterrupts(cause)
		? Effect.failCause(
				Cause.fromReasons<never>(
					cause.reasons.filter(
						(reason): reason is Cause.Die | Cause.Interrupt => !Cause.isFailReason(reason),
					),
				),
			)
		: Effect.succeed(durableHostFailure(unknownToMessage(cause)));

type DispatchArguments = Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>;

const recordHostCall = <A extends WorkflowDurableResult | null, E, R>(
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
) =>
	request.kind === "sleep"
		? request.args.durationMs <= SANDBOX_LIMITS.replay.shortWaitMs
		: sandboxDurableHostDispatchStrategy(request.args.capability) === "activity";

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const submissions = yield* SandboxSubmissionCommands;
		const authority = yield* SandboxExecutionAuthority;
		const receipts = yield* MutationReceipts.make;
		const httpDispatcher = yield* SandboxHttpDispatcher;
		const implementations = yield* ScriptHostImplementations;
		const lifecycleExecution = yield* LifecycleExecution;

		const writeLifecycleItems = Effect.fnUntraced(function* <Item, Result>(
			options: LifecycleItemWrite<Item, Result> & {
				readonly name: string;
				readonly warnings: Array<AutomationWarning>;
			},
		) {
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

		const dispatchLifecycleHost = (request: DispatchArguments[0], scope: HostCallScope) =>
			Effect.gen(function* () {
				const capability = request.args.capability;
				const name = `sandbox-host-${request.index}-${capability}`;
				const prepared = yield* makeActivity({
					name: `${name}-input`,
					error: SandboxRunError,
					success: SandboxLifecycleHostInput,
					execute: prepareSandboxLifecycleHostInput(implementations, request, scope),
				});
				if (prepared._tag === "Failure") {
					return durableHostFailure(prepared.message, prepared.data);
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
							...steps.changeUserRelationships.itemWrite(prepared),
						});
						return { warnings, value: steps.changeUserRelationships.value(summaries) };
					}
					const summaries = yield* writeLifecycleItems({
						name,
						warnings,
						...steps.upsertGlobalRelationships.itemWrite(prepared),
					});
					return { warnings, value: steps.upsertGlobalRelationships.value(summaries) };
				}).pipe(
					Effect.map((outcome) => ({ ...outcome, _tag: "written" as const })),
					Effect.catch((error) =>
						Effect.succeed({ ...toSandboxHostError(error), _tag: "failed" as const }),
					),
				);
				if (written._tag === "failed") {
					return durableHostFailure(written.message, written.data);
				}
				yield* reportSandboxLifecycleWarnings(capability, written.warnings);
				const value = yield* Schema.encodeUnknownEffect(lifecycleHostSuccessSchemas[prepared._tag])(
					written.value,
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					Effect.mapError(infrastructureRunError),
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
			const { startedAt } = payload;
			const scope = hostCallScopeOf(payload, principal, executionId, startedAt);
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
				return dispatchLifecycleHost(request, scope);
			}
			if (strategy === "activity") {
				return makeActivity({
					error: SandboxRunError,
					success: workflowDurableResultSchema,
					name: `sandbox-host-${request.index}-${request.args.capability}`,
					execute: dispatchSandboxHostActivity(implementations, request, scope),
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
					(registration) => registration.pipe(Effect.mapError(infrastructureRunError)),
					(execution) => execution,
				);
			}

			if (strategy === "event-workflow") {
				return Effect.gen(function* () {
					const prepared = yield* makeActivity({
						error: SandboxRunError,
						success: PreparedSandboxCreateEvents,
						name: `prepare-sandbox-create-events-${request.index}`,
						execute: prepareSandboxCreateEvents(request, scope, submissions),
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
						(registration) => registration.pipe(Effect.mapError(infrastructureRunError)),
						Effect.exit,
					);
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
			}

			return Effect.gen(function* () {
				const prepared = yield* makeActivity({
					error: SandboxRunError,
					success: PreparedSandboxSendNotification,
					execute: prepareSandboxSendNotification(request, scope),
					name: `prepare-sandbox-send-notification-${request.index}`,
				});
				const notificationPayload = yield* Schema.decodeEffect(NotificationDeliveryWorkflowPayload)(
					{
						userId: prepared.userId,
						executionId: prepared.executionId,
						request: { kind: "message", message: prepared.message },
					},
				).pipe(
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
					return yield* failureOrRethrow(result.cause);
				}
				return { value: null, state: "success" } satisfies WorkflowDurableResult;
			});
		};

		return {
			dispatch: (request, payload, principal, executionId, progress) =>
				recordHostCall(
					request,
					authority
						.resolve(principal)
						.pipe(
							Effect.andThen(
								dispatchDurableHostCall(request, payload, principal, executionId, progress),
							),
						),
				),
			cancelInline: (executionId, progress) =>
				Effect.forEach(
					progress,
					(entry) =>
						entry._tag === "Http"
							? Effect.flatMap(
									Schema.decodeUnknownEffect(SandboxHttpProgress)(entry.progress),
									(decoded) => httpDispatcher.cancel(executionId, decoded),
								).pipe(Effect.ignore)
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
								yield* authority.resolve(principal);
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
											dispatchSandboxHostActivity(implementations, request, {
												lane,
												context,
												principal,
												startedAt,
												executionId,
											}),
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
