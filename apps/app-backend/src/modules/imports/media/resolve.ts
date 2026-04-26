import { Effect, Either } from "effect";

import { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import { resolveGlobalEntityExternalId } from "~/modules/entities/population";
import { EntitiesRepository } from "~/modules/entities/repository";

import { recordImportRunFailure } from "../runtime/failures";
import { mediaEntityGroupItemIndex } from "./groups";
import { getResolutionCandidates } from "./resolution-candidates";
import type { ImportMediaEntityGroup } from "./types";

export const resolveMediaEntityRefs = (input: {
	runId: string;
	userId: string;
	entityGroups: ImportMediaEntityGroup[];
	onProgress: (processed: number) => Effect.Effect<void, DbError>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entitiesRepository = yield* EntitiesRepository;

		let resolveFailures = 0;

		for (let i = 0; i < input.entityGroups.length; i++) {
			const group = input.entityGroups[i];
			const ref = group?.entityRef;
			if (!group || !ref || ref.kind === "resolved") {
				yield* input.onProgress(i + 1);
				continue;
			}

			const candidates = getResolutionCandidates({
				identifierType: ref.identifierType,
				entitySchemaSlug: ref.entitySchemaSlug,
			});
			if (candidates.length === 0) {
				resolveFailures++;
				yield* recordImportRunFailure({
					runId: input.runId,
					stage: "provider_resolution",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.identifierValue,
					entitySchemaSlug: ref.entitySchemaSlug,
					context: { identifierType: ref.identifierType },
					itemIndex: mediaEntityGroupItemIndex(group, i),
					message: `No providers configured to resolve ${ref.identifierType}`,
				});
				yield* input.onProgress(i + 1);
				continue;
			}

			const lookupErrors: string[] = [];
			let resolved = false;

			for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
				const scriptSlug = candidates[candidateIndex];
				if (!scriptSlug) {
					continue;
				}

				const script = yield* runWithDb(
					entitiesRepository.findEntitySchemaScriptBySlug(scriptSlug),
				);
				if (!script) {
					lookupErrors.push(`${scriptSlug}: sandbox script not found`);
					continue;
				}

				const result = yield* resolveGlobalEntityExternalId({
					userId: input.userId,
					value: ref.identifierValue,
					scriptId: script.sandboxScriptId,
					identifierType: ref.identifierType,
					executionId: `${input.runId}_sandbox_resolve_${i}_${candidateIndex}`,
				}).pipe(Effect.either);

				if (Either.isLeft(result)) {
					lookupErrors.push(`${scriptSlug}: ${result.left.message}`);
					continue;
				}

				if (result.right.externalId) {
					group.entityRef = {
						scriptSlug,
						kind: "resolved",
						sourceLabel: ref.sourceLabel,
						externalId: result.right.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
					};
					resolved = true;
					break;
				}
			}

			if (!resolved) {
				resolveFailures++;
				yield* recordImportRunFailure({
					runId: input.runId,
					stage: "provider_resolution",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.identifierValue,
					entitySchemaSlug: ref.entitySchemaSlug,
					itemIndex: mediaEntityGroupItemIndex(group, i),
					context: lookupErrors.length > 0 ? { errors: lookupErrors } : null,
					message:
						lookupErrors.length > 0
							? lookupErrors.join("; ")
							: `Could not resolve ${ref.identifierType} to a supported provider`,
				});
			}

			yield* input.onProgress(i + 1);
		}

		return { resolveFailures };
	});
