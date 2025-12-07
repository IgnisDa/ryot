import { Activity, Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { Effect } from "effect";

import { CollectionsService } from "#modules/collections/service";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";

export const LibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "LibraryEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

export const runLibraryEntityImportWorkflow = Effect.fn("runLibraryEntityImportWorkflow")(
	function* (payload: EntityImportPayload, executionId: string) {
		const engine = yield* WorkflowEngine;
		const collections = yield* CollectionsService;
		const populationExecutionId = `${executionId}-provider-population`;
		const entity = yield* engine.execute(ProviderEntityPopulationWorkflow, {
			executionId: populationExecutionId,
			payload: {
				mode: "ensure",
				userId: payload.userId,
				scriptId: payload.scriptId,
				externalId: payload.externalId,
				executionId: populationExecutionId,
				entitySchemaId: payload.entitySchemaId,
			},
		});

		yield* Activity.make({
			name: "ensure-library-membership",
			execute: payload.userId
				? collections.ensureEntityInLibrary(payload.userId, entity.id).pipe(dieOnDbError)
				: Effect.die("LibraryEntityImportWorkflow: userId is required"),
		});

		return entity;
	},
);

const LibraryEntityImportWorkflowLive = LibraryEntityImportWorkflow.toLayer(
	runLibraryEntityImportWorkflow,
);
export const LibraryEntityImportWorkflowDefinitionsLive = LibraryEntityImportWorkflowLive;
