import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";

import { WorkflowGarbageCollectionRepository } from "./workflow-repository";

export class WorkflowGarbageCollector extends Context.Service<WorkflowGarbageCollector>()(
	"@ryot-app/kernel-backend/modules/garbage-collection/workflows/WorkflowGarbageCollector",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* WorkflowGarbageCollectionRepository;
			const runBatch = Effect.fn("WorkflowGarbageCollector.runBatch")(function* () {
				const now = DateTime.toDate(yield* DateTime.now);
				const expiredTrees = yield* session.transaction(repository.expireTrees(now, 100));
				const executions = yield* repository.listPendingCleanup(1_000);
				for (const execution of executions) {
					yield* repository.clear(execution, now);
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
