import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import type { CurrentDb } from "#lib/db";
import { unknownToMessage } from "#lib/errors";
import type { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/failures";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { mediaEntityGroupItemIndex } from "./groups";
import type { ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import {
	EnsureLibraryMembershipOutcome,
	PopulationScript,
	type EntityIdsByKey,
	type ProgressReporter,
	type RunWithDb,
} from "./workflow-shared";
import type { MediaImportWorkflowOperations } from "./workflow-types";

export const populateMediaEntityGroups = Effect.fn("populateMediaEntityGroups")(function* <
	RLoad,
	RResolve,
	RImport,
	RSearch = never,
	RCleanup = never,
>(input: {
	executionId: string;
	runWithDb: RunWithDb;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	payload: Pick<ImportRunJobData, "runId" | "userId">;
	operations: MediaImportWorkflowOperations<RLoad, RResolve, RImport, RSearch, RCleanup>;
	collections: {
		ensureEntityInLibrary: (
			userId: ImportRunJobData["userId"],
			entityId: EntityId,
		) => Effect.Effect<void, unknown>;
	};
	entitiesRepository: {
		findEntitySchemaScriptBySlug: (
			scriptSlug: string,
		) => Effect.Effect<
			{ entitySchemaId: EntitySchemaId; sandboxScriptId: SandboxScriptId } | null,
			unknown,
			CurrentDb
		>;
	};
}) {
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
			execute: input
				.runWithDb(input.entitiesRepository.findEntitySchemaScriptBySlug(ref.scriptSlug))
				.pipe(
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

		const populated = yield* input.operations
			.importEntity({
				userId: input.payload.userId,
				externalId: ref.externalId,
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
					runId: input.payload.runId,
					stage: "provider_details",
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
			execute: input.collections
				.ensureEntityInLibrary(input.payload.userId, populated.right.id)
				.pipe(
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
					runId: input.payload.runId,
					stage: "database_commit",
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
