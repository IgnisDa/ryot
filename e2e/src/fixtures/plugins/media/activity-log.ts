import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	MediaActivityLogInput,
	MediaActivityLogOutput,
} from "@ryot-app/media-plugin/shared/media-activity-operations";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { getEntity } from "~/fixtures/kernel/entities";
import { insertGlobalRelationship } from "~/fixtures/kernel/entity-graph";
import { invokeEncodedOperation, invokeOperation } from "~/fixtures/kernel/operations";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";
import { assertPresent } from "~/support/assertions";

import { findMediaEntitySchema } from "./entity-schemas";
import { insertLibraryMembership, seedMediaEntity } from "./media";

const mediaActivityLogRecipe = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaActivityLogInput,
	output: MediaActivityLogOutput,
	operationSlug: "media-activity-log",
});

export const logMediaActivity = (client: Client, input: MediaActivityLogInput) =>
	invokeOperation(client, mediaActivityLogRecipe, input, { idempotencyKey: input.submissionId });

export const logMediaActivityUnchecked = (
	client: Client,
	submissionId: string,
	payload: JsonValue,
) =>
	invokeEncodedOperation(client, mediaActivityLogRecipe, payload, { idempotencyKey: submissionId });

export const mediaReferenceForEntity = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = yield* getEntity(client, entityId);
		assertPresent(entity.entitySchemaPluginId, "Expected a plugin-owned media entity");
		return { kind: "local", pluginId: entity.entitySchemaPluginId } as const;
	});

const AIRED = "2020-01-01";
const UNAIRED = "2999-01-01";

type SeededEpisodeSpec = {
	readonly seasonNumber: number;
	readonly episodeNumber: number;
	readonly aired?: boolean;
};

export const seedActivityShow = (
	client: Client,
	input: {
		readonly episodes: readonly SeededEpisodeSpec[];
		readonly productionStatus?: string | null;
	},
) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const [show, season, episode] = yield* Effect.all([
			findMediaEntitySchema(client, "show"),
			findMediaEntitySchema(client, "show-season"),
			findMediaEntitySchema(client, "show-episode"),
		]);
		const relationships = yield* listRelationshipSchemas(client, {
			owner: show.schema.reference.owner,
			slugs: ["show-to-show-season", "show-season-to-show-episode"],
		});
		const showToSeason = requireRelationshipSchemaBySlug(
			relationships,
			"show-to-show-season",
			show.schema.reference.owner,
		).reference;
		const seasonToEpisode = requireRelationshipSchemaBySlug(
			relationships,
			"show-season-to-show-episode",
			show.schema.reference.owner,
		).reference;
		const seasonNumbers = [...new Set(input.episodes.map((spec) => spec.seasonNumber))].sort(
			(left, right) => left - right,
		);
		const showEntity = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			entitySchemaSlug: show.schema.id,
			name: `Activity Log Show ${suffix}`,
			externalId: `activity-log-show-${suffix}`,
			properties: {
				totalEpisodes: input.episodes.length,
				productionStatus: input.productionStatus ?? null,
				totalSeasons: seasonNumbers.filter((number) => number > 0).length,
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: showEntity.id });
		const seasons = new Map<number, string>();
		for (const seasonNumber of seasonNumbers) {
			const seasonEntity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				properties: { seasonNumber },
				entitySchemaSlug: season.schema.id,
				name: `Season ${seasonNumber} ${suffix}`,
				externalId: `activity-log-season-${seasonNumber}-${suffix}`,
			});
			seasons.set(seasonNumber, seasonEntity.id);
			yield* insertGlobalRelationship({
				sourceEntityId: showEntity.id,
				targetEntityId: seasonEntity.id,
				relationshipSchema: showToSeason,
			});
		}
		const episodes = new Map<string, string>();
		for (const spec of input.episodes) {
			const seasonId = seasons.get(spec.seasonNumber);
			assertPresent(seasonId, "Expected a seeded season");
			const episodeEntity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: episode.schema.id,
				name: `S${spec.seasonNumber}E${spec.episodeNumber} ${suffix}`,
				externalId: `activity-log-episode-${spec.seasonNumber}-${spec.episodeNumber}-${suffix}`,
				properties: {
					seasonNumber: spec.seasonNumber,
					episodeNumber: spec.episodeNumber,
					publishDate: spec.aired === false ? UNAIRED : AIRED,
				},
			});
			episodes.set(`${spec.seasonNumber}:${spec.episodeNumber}`, episodeEntity.id);
			yield* insertGlobalRelationship({
				sourceEntityId: seasonId,
				targetEntityId: episodeEntity.id,
				relationshipSchema: seasonToEpisode,
			});
		}
		const episodeId = (seasonNumber: number, episodeNumber: number) => {
			const id = episodes.get(`${seasonNumber}:${episodeNumber}`);
			assertPresent(id, `Missing seeded S${seasonNumber}E${episodeNumber}`);
			return id;
		};
		return { episodeId, seasonIds: seasons, showId: showEntity.id };
	});

export const seedActivityPodcast = (client: Client, input: { readonly episodeCount: number }) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const [podcast, episode] = yield* Effect.all([
			findMediaEntitySchema(client, "podcast"),
			findMediaEntitySchema(client, "podcast-episode"),
		]);
		const relationships = yield* listRelationshipSchemas(client, {
			owner: podcast.schema.reference.owner,
			slugs: ["podcast-to-podcast-episode"],
		});
		const relationshipSchema = requireRelationshipSchemaBySlug(
			relationships,
			"podcast-to-podcast-episode",
			podcast.schema.reference.owner,
		).reference;
		const podcastEntity = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			entitySchemaSlug: podcast.schema.id,
			name: `Activity Log Podcast ${suffix}`,
			externalId: `activity-log-podcast-${suffix}`,
			properties: { totalEpisodes: input.episodeCount },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: podcastEntity.id });
		const episodeIds: string[] = [];
		for (let episodeNumber = 1; episodeNumber <= input.episodeCount; episodeNumber += 1) {
			const episodeEntity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: episode.schema.id,
				properties: { episodeNumber, publishDate: AIRED },
				name: `Podcast Episode ${episodeNumber} ${suffix}`,
				externalId: `activity-log-podcast-episode-${episodeNumber}-${suffix}`,
			});
			episodeIds.push(episodeEntity.id);
			yield* insertGlobalRelationship({
				relationshipSchema,
				sourceEntityId: podcastEntity.id,
				targetEntityId: episodeEntity.id,
			});
		}
		return { episodeIds, podcastId: podcastEntity.id };
	});
