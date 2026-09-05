import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Duration, Effect, Layer, Option, Queue, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

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
			const database = yield* Database;
			const engine = yield* WorkflowEngine;
			const repository = yield* ProviderImportAdmissionRepository;
			const limit = config.sandbox.importConcurrency;
			const wakeups = yield* Queue.sliding<void>(1);
			const wake = Queue.offer(wakeups, undefined).pipe(Effect.asVoid);

			const start = (row: { id: string; payload: unknown }) =>
				decodePayload(row.payload).pipe(
					Effect.flatMap((payload) =>
						engine.execute(EntityImportWorkflow, { payload, discard: true, executionId: row.id }),
					),
				);

			/**
			 * Settles finished imports, restarts admitted imports whose workflow never started, and admits
			 * queued imports into free slots. Every step is idempotent, so each replica may run it.
			 */
			const reconcile = Effect.gen(function* () {
				const running = yield* repository.listRunning();
				const finished: string[] = [];
				for (const row of running) {
					const result = yield* engine.poll(EntityImportWorkflow, row.id);
					if (Option.isNone(result)) {
						yield* start(row);
					} else if (result.value._tag === "Complete") {
						finished.push(row.id);
					}
				}
				const admitted = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						repository
							.admit({ limit, finished })
							.pipe(Effect.provideService(Database, transaction)),
					),
				);
				yield* Effect.forEach(admitted, start, { discard: true });
				return yield* repository.hasPending();
			}).pipe(Effect.provideService(Database, database));

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
				const outcome = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						repository
							.enqueue({
								payload: encoded,
								userId: input.userId,
								id: input.payload.executionId,
								externalId: input.payload.externalId,
								providerId: input.payload.providerId,
								backlogLimit: PROVIDER_IMPORT_USER_BACKLOG_LIMIT,
								entitySchemaSlug: input.payload.entitySchemaSlug,
							})
							.pipe(Effect.provideService(Database, transaction)),
					),
				);
				if (outcome.status === "queued") {
					yield* wake;
				}
				return outcome;
			});

			const status = (input: { id: string; userId: UserId }) =>
				repository.find(input).pipe(
					Effect.map((row) => row?.status ?? null),
					Effect.provideService(Database, database),
				);

			/** A queued import is removed before it starts; an admitted one is interrupted. */
			const cancel = Effect.fn("ProviderImportAdmission.cancel")(function* (input: {
				id: string;
				userId: UserId;
			}) {
				const removed = yield* repository
					.cancelQueued(input)
					.pipe(Effect.provideService(Database, database));
				if (!removed) {
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
