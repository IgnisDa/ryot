import type { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Duration, Effect, FiberMap, Layer, Option, Queue, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { WorkflowExecutionNotifications } from "#lib/infrastructure/workflow-execution-notifications";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { ProviderImportAdmissionRepository } from "./admission-repository";
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
				payload: ProviderEntityImportWorkflowPayload;
				userId: UserId;
			}) {
				const encoded = yield* encodePayload(input.payload).pipe(Effect.orDie);
				const outcome = yield* session.transaction(
					repository.enqueue({
						payload: encoded,
						userId: input.userId,
						id: input.payload.executionId,
						externalId: input.payload.externalId,
						providerId: input.payload.providerId,
						backlogLimit: PROVIDER_IMPORT_USER_BACKLOG_LIMIT,
						entitySchemaSlug: input.payload.entitySchemaSlug,
					}),
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
