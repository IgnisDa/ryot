import { Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { Effect, Layer, Schema } from "effect";

import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";

import {
	LibraryEntityImportOperationWorkflowDefinitionsLive,
	LibraryEntityImportWorkflowOperations,
} from "./operations-workflow";

export class LibraryEntityImportError extends Schema.TaggedError<LibraryEntityImportError>()(
	"LibraryEntityImportError",
	{
		message: Schema.String,
		stage: Schema.Literal("population", "membership"),
	},
) {}

export const LibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: LibraryEntityImportError,
	payload: EntityImportPayload,
	name: "LibraryEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

export const runLibraryEntityImportWorkflow = Effect.fn("LibraryEntityImportWorkflow")(
	function* (payload: EntityImportPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			providerId: payload.providerId,
			externalId: payload.externalId,
			entitySchemaSlug: payload.entitySchemaSlug,
			...(payload.userId ? { userId: payload.userId } : {}),
		});
		const engine = yield* WorkflowEngine;
		const operations = yield* LibraryEntityImportWorkflowOperations;

		const userId = payload.userId;
		if (!userId) {
			return yield* Effect.die("LibraryEntityImportWorkflow: userId is required");
		}

		const populationExecutionId = `${executionId}-provider-population`;
		const entity = yield* engine
			.execute(ProviderEntityPopulationWorkflow, {
				executionId: populationExecutionId,
				payload: {
					userId,
					mode: "ensure",
					origin: payload.origin,
					providerId: payload.providerId,
					externalId: payload.externalId,
					executionId: populationExecutionId,
					entitySchemaSlug: payload.entitySchemaSlug,
				},
			})
			.pipe(
				withoutWorkflowParent,
				Effect.mapError(
					(error) => new LibraryEntityImportError({ stage: "population", message: error.message }),
				),
			);

		yield* operations
			.ensureLibraryMembership({
				userId,
				entityId: entity.id,
				executionId: `${executionId}-membership`,
			})
			.pipe(
				Effect.mapError(
					(error) => new LibraryEntityImportError({ stage: "membership", message: error.message }),
				),
			);

		return entity;
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "LibraryEntityImportWorkflow" }),
);

const LibraryEntityImportWorkflowLive = LibraryEntityImportWorkflow.toLayer(
	runLibraryEntityImportWorkflow,
);
export const LibraryEntityImportWorkflowDefinitionsLive = Layer.mergeAll(
	LibraryEntityImportWorkflowLive,
	LibraryEntityImportOperationWorkflowDefinitionsLive,
);
