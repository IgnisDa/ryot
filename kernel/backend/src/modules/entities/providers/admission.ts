import { DbError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Duration, Effect, FiberMap, Layer, Option, Queue, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

import { ProviderImportAdmissionRepository } from "./admission-repository";
import { preRegisterProviderDetails } from "./details-principal";
import { EntityImportWorkflow } from "./entity-import-workflow";
import { ProviderEntityImportWorkflowPayload } from "./schemas";

/** Queued plus running root imports one user may hold; later submissions are rejected as retryable. */
export const PROVIDER_IMPORT_USER_BACKLOG_LIMIT = 50;

const BUSY_INTERVAL = Duration.seconds(1);
const IDLE_INTERVAL = Duration.seconds(30);

const encodePayload = Schema.encodeEffect(ProviderEntityImportWorkflowPayload);
const decodePayload = Schema.decodeUnknownEffect(ProviderEntityImportWorkflowPayload);

export class ProviderImportAdmission extends Context.Service<ProviderImportAdmission>()(
	"ProviderImportAdmission",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const session = yield* DatabaseSession;
			const engine = yield* WorkflowEngine;
			const repository = yield* ProviderImportAdmissionRepository;
			const receipts = yield* MutationReceipts.make;
			const sandbox = yield* ScriptExecutionService;
			const runtime = yield* PluginRuntimeResolver;
			const checks = yield* DomainWriteChecks;
			const notifications = yield* WorkflowExecutionNotifications;
			const completionWaiters = yield* FiberMap.make<string, void>();
			const limit = config.sandbox.importConcurrency;
			const wakeups = yield* Queue.sliding<void>(1);
			const wake = Queue.offer(wakeups, undefined).pipe(Effect.asVoid);

			const start = (row: { id: string; payload: unknown }) =>
				decodePayload(row.payload).pipe(
					Effect.flatMap((payload) =>
						dispatchAdmittedWorkflow(
							receipts,
							engine,
							EntityImportWorkflow,
							payload.command.accountGeneration,
							{ payload, discard: true, executionId: row.id },
							(admission) => admission,
							(execution) => execution,
						),
					),
				);

			const watchCompletion = Effect.fn("ProviderImportAdmission.watchCompletion")(function* (row: {
				id: string;
				payload: unknown;
			}) {
				yield* FiberMap.run(
					completionWaiters,
					row.id,
					Effect.scoped(
						Effect.gen(function* () {
							const awaitHint = yield* notifications.listen({
								executionId: row.id,
								workflowName: EntityImportWorkflow._tag,
							});
							const result = yield* engine.poll(EntityImportWorkflow, row.id);
							if (Option.isNone(result) || result.value._tag !== "Complete") {
								yield* awaitHint;
							}
							yield* wake;
						}),
					).pipe(
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterruptsOnly(cause),
							(cause) => Effect.logError("provider import completion watch failed", cause),
						),
					),
					{ onlyIfMissing: true },
				);
			});

			/**
			 * Settles finished imports, restarts admitted imports whose workflow never started, and admits
			 * queued imports into free slots. Every step is idempotent, so each replica may run it.
			 */
			const reconcile = Effect.gen(function* () {
				const running = yield* repository.listRunning();
				const runningIds = new Set(running.map(({ id }) => id));
				for (const [id] of Array.from(completionWaiters)) {
					if (!runningIds.has(id)) {
						yield* FiberMap.remove(completionWaiters, id);
					}
				}
				const finished: string[] = [];
				for (const row of running) {
					yield* watchCompletion(row);
					const result = yield* engine.poll(EntityImportWorkflow, row.id);
					if (Option.isNone(result)) {
						yield* start(row);
					} else if (result.value._tag === "Complete") {
						finished.push(row.id);
					}
				}
				const admitted = yield* session.transaction(repository.admit({ limit, finished }));
				for (const id of finished) {
					yield* FiberMap.remove(completionWaiters, id);
				}
				for (const row of admitted) {
					yield* notifications.publish({
						executionId: row.id,
						workflowName: EntityImportWorkflow._tag,
					});
					yield* start(row);
					yield* watchCompletion(row);
				}
				return yield* repository.hasPending();
			});

			const run = Effect.gen(function* () {
				const busy = yield* reconcile.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("provider import admission failed", cause).pipe(Effect.as(true)),
					),
				);
				yield* Queue.take(wakeups).pipe(Effect.timeoutOption(busy ? BUSY_INTERVAL : IDLE_INTERVAL));
			}).pipe(Effect.forever);

			const submit = Effect.fn("ProviderImportAdmission.submit")(function* (input: {
				userId: UserId;
				payload: ProviderEntityImportWorkflowPayload;
			}) {
				const generation = input.payload.command.accountGeneration;
				if (!generation || generation.userId !== input.userId) {
					return yield* new DbError({
						message: "Provider import account authority is unavailable",
					});
				}
				const pin = yield* preRegisterProviderDetails(
					{ sandbox, pluginRuntime: runtime },
					{
						userId: input.userId,
						accountGeneration: generation,
						pluginId: input.payload.pluginId,
						providerId: input.payload.providerId,
						executionId: input.payload.executionId,
					},
				).pipe(Effect.mapError((error) => new DbError({ message: error.message })));
				const outcome = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* runtime.lockCatalog();
							const provider = yield* checks.checkProvider(
								input.payload.providerId,
								definitionOwner(input.payload.pluginId),
							);
							if (
								provider.rootEntitySchemaSlug !== input.payload.entitySchemaSlug ||
								(pin.pluginRevision.scope === "user" && input.payload.entityScope.type !== "user")
							) {
								return yield* new DbError({
									message: "Provider import owner or scope is unavailable",
								});
							}
							const payload = {
								...input.payload,
								command: { ...input.payload.command, writeContext: pin.principal },
							};
							yield* checks
								.check(
									payload.command,
									definitionOwner(payload.pluginId),
									payload.entityScope.type === "user" ? input.userId : null,
									true,
								)
								.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
							const encoded = yield* encodePayload(payload).pipe(Effect.orDie);
							const admitted = yield* repository.enqueue({
								payload: encoded,
								userId: input.userId,
								id: payload.executionId,
								externalId: payload.externalId,
								providerId: payload.providerId,
								entitySchemaSlug: payload.entitySchemaSlug,
								backlogLimit: PROVIDER_IMPORT_USER_BACKLOG_LIMIT,
							});
							if (
								admitted.status !== "queued" &&
								!(admitted.status === "duplicate" && admitted.id === payload.executionId)
							) {
								yield* sandbox.releaseWorkflowRegistration(payload.executionId);
							}
							return admitted;
						}),
					)
					.pipe(
						Effect.onError(() =>
							sandbox.releaseWorkflowRegistration(input.payload.executionId).pipe(Effect.orDie),
						),
					);
				if (outcome.status === "queued") {
					yield* wake;
				}
				return outcome;
			});

			const status = (input: { id: string; userId: UserId }) =>
				repository.find(input).pipe(Effect.map((row) => row?.status ?? null));

			/** A queued import is removed before it starts; an admitted one is interrupted. */
			const cancel = Effect.fn("ProviderImportAdmission.cancel")(function* (input: {
				id: string;
				userId: UserId;
			}) {
				const removed = yield* repository.cancelQueued(input);
				if (removed) {
					yield* sandbox.releaseWorkflowRegistration(input.id);
				}
				const admitted = removed ? null : yield* repository.find(input);
				if (admitted) {
					yield* engine.interrupt(EntityImportWorkflow, input.id);
				}
				yield* wake;
			});

			return { run, cancel, status, submit, reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ProviderImportAdmissionRepository.layer),
	);

	static readonly liveLayer = Layer.effectDiscard(
		Effect.flatMap(this, (admission) => Effect.forkScoped(admission.run)),
	).pipe(Layer.provideMerge(this.layer));
}
