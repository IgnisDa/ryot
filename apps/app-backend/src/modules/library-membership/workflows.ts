import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { Effect } from "effect";

import { CollectionsService } from "#modules/collections/service";
import { EntityImportPayload, runEntityImportWorkflow } from "#modules/entity-import/workflows";

export const LibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "LibraryEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const LibraryEntityImportWorkflowLive = LibraryEntityImportWorkflow.toLayer(
	(payload, executionId) =>
		Effect.gen(function* () {
			const collections = yield* CollectionsService;
			const entity = yield* runEntityImportWorkflow(payload, executionId);

			yield* Activity.make({
				name: "ensure-library-membership",
				execute: payload.userId
					? collections.ensureEntityInLibrary(payload.userId, entity.id).pipe(dieOnDbError)
					: Effect.die("LibraryEntityImportWorkflow: userId is required"),
			});

			return entity;
		}),
);

export const LibraryEntityImportWorkflowDefinitionsLive = LibraryEntityImportWorkflowLive;
