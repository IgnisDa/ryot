import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError } from "@ryot/contract/errors";
import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { EnsureLibraryMembershipQueue } from "#modules/events/durable-queues";

export type LibraryEntityImportWorkflowOperationsValue = {
	ensureLibraryMembership: (input: {
		userId: UserId;
		entityId: EntityId;
		executionId: string;
	}) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
};

export class LibraryEntityImportWorkflowOperations extends Context.Tag(
	"LibraryEntityImportWorkflowOperations",
)<LibraryEntityImportWorkflowOperations, LibraryEntityImportWorkflowOperationsValue>() {}

export const LibraryEntityImportWorkflowOperationsLive = Layer.effect(
	LibraryEntityImportWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				ensureLibraryMembership: (input) =>
					DurableQueue.process(EnsureLibraryMembershipQueue, input).pipe(
						Effect.asVoid,
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies LibraryEntityImportWorkflowOperationsValue,
	),
);
