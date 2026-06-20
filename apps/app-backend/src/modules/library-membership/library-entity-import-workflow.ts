import { Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { Effect, Schema } from "effect";

import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";

import { LibraryEntityImportWorkflowOperations } from "./operations-workflow";

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

export const runLibraryEntityImportWorkflow = Effect.fn("runLibraryEntityImportWorkflow")(
	function* (payload: EntityImportPayload, executionId: string) {
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
					scriptId: payload.scriptId,
					externalId: payload.externalId,
					executionId: populationExecutionId,
					entitySchemaId: payload.entitySchemaId,
				},
			})
			.pipe(
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
);

const LibraryEntityImportWorkflowLive = LibraryEntityImportWorkflow.toLayer(
	runLibraryEntityImportWorkflow,
);
export const LibraryEntityImportWorkflowDefinitionsLive = LibraryEntityImportWorkflowLive;
