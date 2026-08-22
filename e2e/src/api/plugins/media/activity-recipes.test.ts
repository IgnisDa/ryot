import { mediaActivityRecipe } from "@ryot-app/media-plugin/shared/activity-recipes";
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
import { seedMediaEntity } from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const WINDOW = {
	timeZone: "America/New_York",
	from: "2026-01-01T05:00:00.000Z",
	until: "2026-02-01T05:00:00.000Z",
};

const COMPLETE = { completionMode: "unknown" };

const seed = (client: Client, slug: string, properties: Record<string, unknown>) =>
	Effect.gen(function* () {
		const schemaSlug = yield* getBuiltinEntitySchemaSlug(client, slug);
		const eventSchemas = yield* listEventSchemas(client, schemaSlug);
		const suffix = crypto.randomUUID();
		const entity = yield* seedMediaEntity({
			properties,
			userId: null,
			providerId: null,
			entitySchemaSlug: schemaSlug,
			name: `Activity ${slug} ${suffix}`,
			externalId: `activity-${slug}-${suffix}`,
		});
		const log = (eventSlug: string, occurredAt: string, eventProperties: Record<string, unknown>) =>
			createEventFixture(client, {
				occurredAt,
				entityId: entity.id,
				properties: eventProperties,
				eventSchemaSlug: requireEventSchemaBySlug(eventSchemas, eventSlug).id,
			});
		return { log, entity };
	});

const link = (client: Client, source: string, target: string, relationshipSlug: string) =>
	Effect.gen(function* () {
		const schemas = yield* listRelationshipSchemas(client, { slugs: [relationshipSlug] });
		yield* insertGlobalRelationship({
			sourceEntityId: source,
			targetEntityId: target,
			relationshipSchemaSlug: requireRelationshipSchemaBySlug(schemas, relationshipSlug).id,
		});
	});

describe("Media activity recipe", () => {
	it.live("counts figures, local day buckets, and media types within the window", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* seed(client, "movie", { runtime: 120 });
			const book = yield* seed(client, "book", {});
			const show = yield* seed(client, "show", {});
			const season = yield* seed(client, "show-season", { seasonNumber: 1 });
			const episode = yield* seed(client, "show-episode", {
				runtime: 45,
				seasonNumber: 1,
				episodeNumber: 1,
			});
			yield* link(client, show.entity.id, season.entity.id, "show-to-show-season");
			yield* link(client, season.entity.id, episode.entity.id, "show-season-to-show-episode");

			// 03:00Z on Jan 10 is still Jan 9 in New York.
			yield* movie.log("complete", "2026-01-10T03:00:00.000Z", COMPLETE);
			yield* movie.log("progress", "2026-01-09T15:00:00.000Z", { progressPercent: 50 });
			yield* movie.log("review", "2026-01-12T12:00:00.000Z", { rating: 80 });
			yield* book.log("complete", "2026-01-12T12:00:00.000Z", { ...COMPLETE, timeSpent: 30 });
			yield* episode.log("complete", "2026-01-12T13:00:00.000Z", COMPLETE);
			yield* book.log("complete", "2025-12-31T12:00:00.000Z", { ...COMPLETE, timeSpent: 999 });

			const activity = yield* executeRyotQLRecipe(client, mediaActivityRecipe(WINDOW));

			expect(activity.figures).toEqual({ reviews: 1, finished: 2, minutes: 195 });
			expect(activity.days).toEqual([
				{ events: 2, day: "2026-01-09T05:00:00.000Z" },
				{ events: 2, day: "2026-01-12T05:00:00.000Z" },
			]);
			expect(activity.mediaTypes).toEqual([
				{ events: 2, slug: "movie", label: "Movie" },
				{ events: 1, slug: "book", label: "Book" },
				{ events: 1, slug: "show", label: "Show" },
			]);
		}),
	);
});
