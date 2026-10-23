import { showsAiringSoonRecipe } from "@ryot-app/media-plugin/shared/airing-recipes";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	listEventSchemas,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import { findMediaEntitySchema, insertMediaMonitoring, seedShow } from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const AIRED = "2020-01-01";

const today = new Date();

const dayOffset = (days: number) =>
	new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))
		.toISOString()
		.slice(0, 10);

const loadShowSchemas = (client: Client) =>
	Effect.gen(function* () {
		const [show, episode] = yield* Effect.all([
			findMediaEntitySchema(client, "show"),
			findMediaEntitySchema(client, "show-episode"),
		]);
		const episodeEvents = yield* listEventSchemas(client, episode.schema.reference);
		return {
			pluginId: show.pluginId,
			episodeComplete: requireEventSchemaBySlug(episodeEvents, "complete").id,
		};
	});

type ShowSchemas = Effect.Success<ReturnType<typeof loadShowSchemas>>;

/** A library show whose season 1 episodes carry `publishDates` in order. */
const airingShow = (publishDates: readonly string[]) => ({
	properties: { productionStatus: "Continuing" },
	seasons: [
		{
			seasonNumber: 1,
			episodes: publishDates.map((publishDate, index) => ({
				publishDate,
				episodeNumber: index + 1,
			})),
		},
	],
});

const watch = (client: Client, schemas: ShowSchemas, episodeId: string) =>
	createEventFixture(client, {
		entityId: episodeId,
		properties: { dateUnknown: true },
		occurredAt: "2026-01-01T00:00:00.000Z",
		eventSchemaSlug: schemas.episodeComplete,
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
					seedShow(
						client,
						airingShow([AIRED, dayOffset(3), dayOffset(3), dayOffset(3), dayOffset(5)]),
					),
					seedShow(client, airingShow([dayOffset(1)])),
					seedShow(client, airingShow([dayOffset(2)])),
					seedShow(client, airingShow([AIRED, AIRED, dayOffset(20)])),
					seedShow(client, airingShow([dayOffset(4)])),
					seedShow(client, airingShow([AIRED, dayOffset(0)])),
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
				showsAiringSoonRecipe({
					limit: 20,
					from: dayOffset(0),
					until: dayOffset(14),
					reference: { kind: "local", pluginId: schemas.pluginId },
				}),
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
