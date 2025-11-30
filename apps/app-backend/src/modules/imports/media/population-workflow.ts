import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { mediaEntityGroupItemIndex } from "./groups";
import {
	EnsureLibraryMembershipOutcome,
	PopulationScript,
	type EntityIdsByKey,
	type ProgressReporter,
} from "./shared-workflow";
import type { ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";

export const populateMediaEntityGroups = Effect.fn("populateMediaEntityGroups")(function* (input: {
	executionId: string;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	payload: Pick<ImportRunJobData, "runId" | "userId">;
}) {
	const runWithDb = yield* DbRunner;
	const collections = yield* CollectionsService;
	const entitiesRepository = yield* EntitiesRepository;
	const operations = yield* MediaImportWorkflowOperations;
	const entityIdsByKey: EntityIdsByKey = new Map();
	let failures = 0;

	for (let i = 0; i < input.entityGroups.length; i += 1) {
		const group = input.entityGroups[i];
		const ref = group?.entityRef;
		if (!group || ref?.kind !== "resolved") {
			yield* input.reportProgress(i + 1);
			continue;
		}

		const itemIndex = mediaEntityGroupItemIndex(group, i);
		const script = yield* Activity.make({
			error: ImportRunError,
			name: `load-population-script-${i}`,
			success: Schema.NullOr(PopulationScript),
			execute: runWithDb(
				entitiesRepository.findEntitySchemaSandboxScriptBySlug(ref.scriptSlug),
			).pipe(
				Effect.map((found) =>
					found
						? { entitySchemaId: found.entitySchemaId, sandboxScriptId: found.sandboxScriptId }
						: null,
				),
				Effect.mapError(toWorkflowError),
			),
		});

		if (!script) {
			failures += 1;
			yield* Activity.make({
				error: ImportRunError,
				name: `record-populate-script-failure-${i}`,
				execute: recordImportRunFailure({
					itemIndex,
					context: null,
					runId: input.payload.runId,
					sourceLabel: ref.sourceLabel,
					stage: "input_transformation",
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
					message: `Sandbox script not found for slug: ${ref.scriptSlug}`,
				}).pipe(Effect.mapError(toWorkflowError)),
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		const populated = yield* operations
			.importEntity({
				externalId: ref.externalId,
				userId: input.payload.userId,
				scriptId: script.sandboxScriptId,
				activityPrefix: `populate-${i}-`,
				entitySchemaId: script.entitySchemaId,
				executionId: `${input.executionId}-entity-${i}`,
			})
			.pipe(Effect.either);

		if (populated._tag === "Left") {
			failures += 1;
			yield* Activity.make({
				error: ImportRunError,
				name: `record-populate-failure-${i}`,
				execute: recordImportRunFailure({
					itemIndex,
					context: null,
					stage: "provider_details",
					runId: input.payload.runId,
					sourceLabel: ref.sourceLabel,
					message: populated.left.message,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				}).pipe(Effect.mapError(toWorkflowError)),
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		const libraryMembership = yield* Activity.make({
			name: `ensure-library-membership-${i}`,
			success: EnsureLibraryMembershipOutcome,
			execute: collections.ensureEntityInLibrary(input.payload.userId, populated.right.id).pipe(
				Effect.as({ message: null }),
				Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
			),
		});
		if (libraryMembership.message) {
			failures += 1;
			yield* Activity.make({
				error: ImportRunError,
				name: `record-library-membership-failure-${i}`,
				execute: recordImportRunFailure({
					itemIndex,
					context: null,
					stage: "database_commit",
					runId: input.payload.runId,
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					message: libraryMembership.message,
					entitySchemaSlug: ref.entitySchemaSlug,
				}).pipe(Effect.mapError(toWorkflowError)),
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		entityIdsByKey.set(importEntityRefKey(ref), populated.right.id);
		yield* input.reportProgress(i + 1);
	}

	return { failures, entityIdsByKey };
});
