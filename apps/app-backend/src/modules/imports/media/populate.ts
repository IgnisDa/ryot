import { Effect, Either } from "effect";

import { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import { CollectionsService } from "~/modules/collections/service";
import { populateGlobalEntity } from "~/modules/entities/population";
import { EntitiesRepository } from "~/modules/entities/repository";

import { recordImportRunFailure } from "../runtime/failures";
import { mediaEntityGroupItemIndex } from "./groups";
import { type ImportMediaEntityGroup, importEntityRefKey } from "./types";

export const populateMediaEntityRefs = (input: {
	runId: string;
	userId: string;
	entityGroups: ImportMediaEntityGroup[];
	onProgress: (processed: number) => Effect.Effect<void, DbError>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const collections = yield* CollectionsService;
		const entitiesRepository = yield* EntitiesRepository;

		const entityIdsByKey = new Map<string, string>();
		let populateFailures = 0;

		for (let i = 0; i < input.entityGroups.length; i++) {
			const group = input.entityGroups[i];
			const ref = group?.entityRef;
			if (!group || ref?.kind !== "resolved") {
				yield* input.onProgress(i + 1);
				continue;
			}

			const itemIndex = mediaEntityGroupItemIndex(group, i);

			const script = yield* runWithDb(
				entitiesRepository.findEntitySchemaScriptBySlug(ref.scriptSlug),
			);
			if (!script) {
				populateFailures++;
				yield* recordImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					sourceLabel: ref.sourceLabel,
					stage: "input_transformation",
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
					message: `Sandbox script not found for slug: ${ref.scriptSlug}`,
				});
				yield* input.onProgress(i + 1);
				continue;
			}

			const populated = yield* populateGlobalEntity({
				userId: input.userId,
				externalId: ref.externalId,
				scriptId: script.sandboxScriptId,
				entitySchemaId: script.entitySchemaId,
				executionId: `${input.runId}_sandbox_entity_${i}`,
			}).pipe(Effect.either);

			if (Either.isLeft(populated)) {
				populateFailures++;
				yield* recordImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					stage: "provider_details",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					message: populated.left.message,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
				yield* input.onProgress(i + 1);
				continue;
			}

			const library = yield* collections
				.ensureEntityInLibrary(input.userId, populated.right.id)
				.pipe(Effect.either);
			if (Either.isLeft(library)) {
				populateFailures++;
				yield* recordImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					message: library.left.message,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
				yield* input.onProgress(i + 1);
				continue;
			}

			entityIdsByKey.set(importEntityRefKey(ref), populated.right.id);
			yield* input.onProgress(i + 1);
		}

		return { entityIdsByKey, populateFailures };
	});
