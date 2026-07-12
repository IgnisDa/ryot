import { DurableQueue, Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { EnsureLibraryMembershipQueue } from "#modules/events/durable-queues";

const EnsureLibraryMembershipWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	executionId: Schema.String,
});

const EnsureLibraryMembershipWorkflow = Workflow.make({
	success: Schema.Void,
	error: DbError,
	name: "EnsureLibraryMembershipWorkflow",
	payload: EnsureLibraryMembershipWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const EnsureLibraryMembershipWorkflowLive = EnsureLibraryMembershipWorkflow.toLayer((payload) =>
	DurableQueue.process(EnsureLibraryMembershipQueue, payload),
);

export type LibraryEntityImportWorkflowOperationsValue = {
	ensureLibraryMembership: (input: {
		userId: UserId;
		entityId: EntityId;
		executionId: string;
	}) => Effect.Effect<void, DbError>;
};

export class LibraryEntityImportWorkflowOperations extends Context.Tag(
	"LibraryEntityImportWorkflowOperations",
)<LibraryEntityImportWorkflowOperations, LibraryEntityImportWorkflowOperationsValue>() {}

export const LibraryEntityImportWorkflowOperationsLive = Layer.effect(
	LibraryEntityImportWorkflowOperations,
	Effect.map(
		WorkflowEngine,
		(engine) =>
			({
				ensureLibraryMembership: (input) =>
					engine
						.execute(EnsureLibraryMembershipWorkflow, {
							payload: input,
							executionId: input.executionId,
						})
						.pipe(withoutWorkflowParent),
			}) satisfies LibraryEntityImportWorkflowOperationsValue,
	),
);

export const LibraryEntityImportOperationWorkflowDefinitionsLive =
	EnsureLibraryMembershipWorkflowLive;
