import { Context, DateTime, Effect, Layer } from "effect";
import {
	EntityAddress,
	EntityId,
	EntityType,
	MessageStorage,
	ShardId,
} from "effect/unstable/cluster";

import { DatabaseSession } from "#lib/infrastructure/db/session";

import { workflowClockEntityType, workflowEntityPrefix } from "./workflow-models";
import { WorkflowGarbageCollectionRepository } from "./workflow-repository";

export class WorkflowGarbageCollector extends Context.Service<WorkflowGarbageCollector>()(
	"WorkflowGarbageCollector",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const storage = yield* MessageStorage.MessageStorage;
			const repository = yield* WorkflowGarbageCollectionRepository;
			const runBatch = Effect.fn("WorkflowGarbageCollector.runBatch")(function* () {
				const now = DateTime.toDate(yield* DateTime.now);
				const expiredTrees = yield* session.transaction(repository.expireTrees(now, 100));
				const executions = yield* repository.listPendingCleanup(1_000);
				for (const execution of executions) {
					if (execution.shardId === null) {
						return yield* Effect.die("Pending workflow cleanup has no shard identity");
					}
					const address = {
						entityId: EntityId.make(execution.executionId),
						shardId: ShardId.fromString(execution.shardId),
					};
					yield* storage.clearAddress(
						EntityAddress.make({
							...address,
							entityType: EntityType.make(workflowEntityPrefix + execution.workflowName),
						}),
					);
					yield* storage.clearAddress(
						EntityAddress.make({
							...address,
							entityType: EntityType.make(workflowClockEntityType),
						}),
					);
					yield* repository.markCleared(execution, now);
				}
				return { expiredTrees, clearedExecutions: executions.length };
			});
			return { runBatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(WorkflowGarbageCollectionRepository.layer),
	);
}
