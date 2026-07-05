import { Activity } from "@effect/workflow";
import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { EntityId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import type { EpisodeResolverService } from "#modules/episode-resolver/service";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import type { ImportMediaEntityGroup } from "./types";
import {
	recordEpisodeResolutionFailure,
	recordEpisodeSchemaMissing,
} from "./writing-failures-workflow";

export const resolveMediaEventTarget = <R>(input: {
	eventIndex: number;
	groupIndex: number;
	itemIndex: number;
	entityId: EntityId;
	entitySchemaSlug: EntitySchemaSlug;
	episodeResolver: EpisodeResolverService;
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
				execute: input.episodeResolver
					.resolveShowEpisode({
						showEntityId: input.entityId,
						userId: input.payload.userId,
						seasonNumber: input.event.episodeLocator.seasonNumber,
						episodeNumber: input.event.episodeLocator.episodeNumber,
					})
					.pipe(Effect.mapError(toWorkflowError)),
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
				execute: input.episodeResolver
					.resolvePodcastEpisode({
						podcastEntityId: input.entityId,
						userId: input.payload.userId,
						episodeNumber: input.event.episodeLocator.episodeNumber,
					})
					.pipe(Effect.mapError(toWorkflowError)),
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
