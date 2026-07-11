import { Activity } from "@effect/workflow";
import type { EntitySchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { EntityId } from "@ryot/contract/schema/brands";
import { invokeOperationRecipe } from "@ryot/plugin-kit/operations";
import { resolveEpisodesRecipe } from "@ryot/plugin-media/operations/recipes";
import type { ResolveEpisodesRef } from "@ryot/plugin-media/operations/schemas";
import { Effect, Schema } from "effect";

import type { OperationsService } from "#modules/plugins/operations-service";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import type { ImportMediaEntityGroup } from "./types";
import {
	recordEpisodeResolutionFailure,
	recordEpisodeSchemaMissing,
} from "./writing-failures-workflow";

const resolveEpisodeEntityId = (input: {
	userId: UserId;
	ref: ResolveEpisodesRef;
	operations: OperationsService;
}) =>
	invokeOperationRecipe(resolveEpisodesRecipe, { refs: [input.ref] }, (request) =>
		input.operations.invokeOperation({ ...request, userId: input.userId }),
	).pipe(
		Effect.map(({ results }) => {
			const entityId = results[0]?.entityId;
			return entityId ? EntityId.make(entityId) : null;
		}),
		Effect.mapError(toWorkflowError),
	);

export const resolveMediaEventTarget = <R>(input: {
	eventIndex: number;
	groupIndex: number;
	itemIndex: number;
	entityId: EntityId;
	operations: OperationsService;
	entitySchemaSlug: EntitySchemaSlug;
	event: ImportMediaEntityGroup["events"][number];
	payload: Pick<ImportRunJobData, "runId" | "userId">;
	getEntitySchemaSlug: (
		entitySchemaSlug: string,
	) => Effect.Effect<EntitySchemaSlug | null, ImportRunError, R>;
	ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
}) =>
	Effect.gen(function* () {
		if (input.event.episodeLocator?.type === "show") {
			const resolvedEpisodeId = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EntityId),
				name: `resolve-show-episode-${input.groupIndex}-${input.eventIndex}`,
				execute: resolveEpisodeEntityId({
					operations: input.operations,
					userId: input.payload.userId,
					ref: {
						kind: "show",
						showEntityId: input.entityId,
						seasonNumber: input.event.episodeLocator.seasonNumber,
						episodeNumber: input.event.episodeLocator.episodeNumber,
					},
				}),
			});

			if (!resolvedEpisodeId) {
				yield* recordEpisodeResolutionFailure({
					event: input.event,
					payload: input.payload,
					ref: input.ref,
					i: input.groupIndex,
					itemIndex: input.itemIndex,
					eventIndex: input.eventIndex,
				});
				return { _tag: "failed" as const };
			}

			const episodeEntitySchemaSlug = yield* input.getEntitySchemaSlug("show-episode");
			if (!episodeEntitySchemaSlug) {
				yield* recordEpisodeSchemaMissing({
					payload: input.payload,
					ref: input.ref,
					i: input.groupIndex,
					itemIndex: input.itemIndex,
					eventIndex: input.eventIndex,
					entitySchemaSlug: "show-episode",
				});
				return { _tag: "failed" as const };
			}

			return {
				_tag: "resolved" as const,
				entityId: resolvedEpisodeId,
				entitySchemaSlug: episodeEntitySchemaSlug,
			};
		}

		if (input.event.episodeLocator?.type === "podcast") {
			const resolvedEpisodeId = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EntityId),
				name: `resolve-podcast-episode-${input.groupIndex}-${input.eventIndex}`,
				execute: resolveEpisodeEntityId({
					operations: input.operations,
					userId: input.payload.userId,
					ref: {
						kind: "podcast",
						podcastEntityId: input.entityId,
						episodeNumber: input.event.episodeLocator.episodeNumber,
					},
				}),
			});

			if (!resolvedEpisodeId) {
				yield* recordEpisodeResolutionFailure({
					event: input.event,
					payload: input.payload,
					ref: input.ref,
					i: input.groupIndex,
					itemIndex: input.itemIndex,
					eventIndex: input.eventIndex,
				});
				return { _tag: "failed" as const };
			}

			const episodeEntitySchemaSlug = yield* input.getEntitySchemaSlug("podcast-episode");
			if (!episodeEntitySchemaSlug) {
				yield* recordEpisodeSchemaMissing({
					payload: input.payload,
					ref: input.ref,
					i: input.groupIndex,
					itemIndex: input.itemIndex,
					eventIndex: input.eventIndex,
					entitySchemaSlug: "podcast-episode",
				});
				return { _tag: "failed" as const };
			}

			return {
				_tag: "resolved" as const,
				entityId: resolvedEpisodeId,
				entitySchemaSlug: episodeEntitySchemaSlug,
			};
		}

		return {
			_tag: "resolved" as const,
			entityId: input.entityId,
			entitySchemaSlug: input.entitySchemaSlug,
		};
	});
