import { showsAiringSoonRecipe } from "@ryot-app/media-plugin/shared/airing-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import {
	insertLibraryMembership,
	insertMediaMonitoring,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const AIRED = "2020-01-01";

const today = new Date();

const dayOffset = (days: number) =>
	new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))
		.toISOString()
		.slice(0, 10);

const loadShowSchemas = (client: Client) =>
	Effect.gen(function* () {
		const loaded = yield* Effect.all({
			showSchemaId: getBuiltinEntitySchemaSlug(client, "show"),
			seasonSchemaId: getBuiltinEntitySchemaSlug(client, "show-season"),
			episodeSchemaId: getBuiltinEntitySchemaSlug(client, "show-episode"),
			relationshipSchemas: listRelationshipSchemas(client, {
				slugs: ["show-to-show-season", "show-season-to-show-episode"],
			}),
		});
		const episodeEvents = yield* listEventSchemas(client, loaded.episodeSchemaId);
		return {
			...loaded,
			episodeComplete: requireEventSchemaBySlug(episodeEvents, "complete").id,
			showToSeason: requireRelationshipSchemaBySlug(
				loaded.relationshipSchemas,
				"show-to-show-season",
			).id,
			seasonToEpisode: requireRelationshipSchemaBySlug(
				loaded.relationshipSchemas,
				"show-season-to-show-episode",
			).id,
		};
	});

type ShowSchemas = Effect.Success<ReturnType<typeof loadShowSchemas>>;

/** A show in the library whose season 1 episodes carry `publishDates` in order. */
const seedAiringShow = (client: Client, schemas: ShowSchemas, publishDates: readonly string[]) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const show = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: `Airing Show ${suffix}`,
			externalId: `airing-show-${suffix}`,
			entitySchemaSlug: schemas.showSchemaId,
			properties: { productionStatus: "Continuing" },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: show.id });
		const season = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: `Season 1 ${suffix}`,
			properties: { seasonNumber: 1 },
			externalId: `airing-season-${suffix}`,
			entitySchemaSlug: schemas.seasonSchemaId,
		});
		yield* insertGlobalRelationship({
			sourceEntityId: show.id,
			targetEntityId: season.id,
			relationshipSchemaSlug: schemas.showToSeason,
		});
		const episodes = yield* Effect.forEach(publishDates, (publishDate, index) =>
			Effect.gen(function* () {
				const episode = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					name: `E${index + 1} ${suffix}`,
					entitySchemaSlug: schemas.episodeSchemaId,
					externalId: `airing-episode-${index + 1}-${suffix}`,
					properties: { publishDate, seasonNumber: 1, episodeNumber: index + 1 },
				});
				yield* insertGlobalRelationship({
					sourceEntityId: season.id,
					targetEntityId: episode.id,
					relationshipSchemaSlug: schemas.seasonToEpisode,
				});
				return episode;
			}),
		);
		return { show, episodes };
	});

const watch = (client: Client, schemas: ShowSchemas, episodeId: string) =>
	createEventFixture(client, {
		entityId: episodeId,
		occurredAt: "2026-01-01T00:00:00.000Z",
		eventSchemaSlug: schemas.episodeComplete,
		properties: { completionMode: "unknown" },
	});

const episodeId = (
	fixture: { readonly episodes: readonly { readonly id: string }[] },
	n: number,
) => {
	const found = fixture.episodes[n - 1];
	if (found === undefined) {
		throw new Error(`Expected episode ${n}`);
	}
	return found.id;
};

describe("Shows airing soon", () => {
	it.live("returns one tile per followed show at its soonest unwatched episode in the window", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadShowSchemas(client);
			const [caughtUp, monitored, untracked, outOfWindow, allWatched, airsToday] =
				yield* Effect.all([
					seedAiringShow(client, schemas, [
						AIRED,
						dayOffset(3),
						dayOffset(3),
						dayOffset(3),
						dayOffset(5),
					]),
					seedAiringShow(client, schemas, [dayOffset(1)]),
					seedAiringShow(client, schemas, [dayOffset(2)]),
					seedAiringShow(client, schemas, [AIRED, AIRED, dayOffset(20)]),
					seedAiringShow(client, schemas, [dayOffset(4)]),
					seedAiringShow(client, schemas, [AIRED, dayOffset(0)]),
				]);
			yield* insertMediaMonitoring(client, monitored.show.id);
			for (const watched of [
				episodeId(caughtUp, 1),
				episodeId(caughtUp, 2),
				episodeId(outOfWindow, 1),
				episodeId(allWatched, 1),
				episodeId(airsToday, 1),
			]) {
				yield* watch(client, schemas, watched);
			}

			const airing = yield* executeRyotQLRecipe(
				client,
				showsAiringSoonRecipe({ limit: 20, from: dayOffset(0), until: dayOffset(14) }),
			);

			expect(
				airing.map((tile) => [
					tile.entity.id,
					tile.episode.id,
					tile.episode.publishDate,
					tile.sameDayCount,
				]),
			).toEqual([
				[airsToday.show.id, episodeId(airsToday, 2), dayOffset(0), 1],
				[monitored.show.id, episodeId(monitored, 1), dayOffset(1), 1],
				[caughtUp.show.id, episodeId(caughtUp, 3), dayOffset(3), 2],
			]);
			expect(airing.map((tile) => tile.entity.id)).not.toContain(untracked.show.id);
		}),
	);
});
