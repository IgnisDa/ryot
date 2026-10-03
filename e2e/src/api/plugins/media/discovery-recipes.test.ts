import {
	latestCompletionSuggestionsRecipe,
	trendingLatestMediaRecipe,
} from "@ryot-app/media-plugin/shared/discovery-recipes";
import { Clock, Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

type MediaReference = Parameters<typeof latestCompletionSuggestionsRecipe>[0]["reference"];

const seedTitle = (schemaId: string, name: string, isNsfw: boolean | null = false) => {
	const suffix = crypto.randomUUID();
	return seedMediaEntity({
		userId: null,
		providerId: null,
		name: `${name} ${suffix}`,
		entitySchemaSlug: schemaId,
		properties: { isNsfw, images: [] },
		externalId: `discovery-${schemaId}-${suffix}`,
	});
};

const relationshipSchemaReference = (
	client: Client,
	owner: Parameters<typeof requireRelationshipSchemaBySlug>[2],
	slug: string,
) =>
	listRelationshipSchemas(client, { owner, slugs: [slug] }).pipe(
		Effect.map((schemas) => requireRelationshipSchemaBySlug(schemas, slug, owner).reference),
	);

describe("Latest completion suggestions", () => {
	it.live("reports no source before anything is completed", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findMediaEntitySchema(client, "book");
			const reference: MediaReference = { pluginId, kind: "local" };
			const result = yield* executeRyotQLRecipe(
				client,
				latestCompletionSuggestionsRecipe({ reference, limit: 20 }),
			);
			expect(result).toEqual({ items: [], source: null });
		}),
	);

	it.live("falls back to the latest completion that still has suggestible titles", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema, pluginId } = yield* findMediaEntitySchema(client, "book");
			const reference: MediaReference = { pluginId, kind: "local" };
			const complete = requireEventSchemaBySlug(
				yield* listEventSchemas(client, schema.reference),
				"complete",
			).id;
			const suggestion = yield* relationshipSchemaReference(
				client,
				schema.reference.owner,
				"media-suggestion",
			);
			const [older, exhausted, nsfwOnly, fresh, unknownRating, adult, owned] = yield* Effect.all([
				seedTitle(schema.id, "Older Source"),
				seedTitle(schema.id, "Exhausted Source"),
				seedTitle(schema.id, "NSFW-only Source"),
				seedTitle(schema.id, "Fresh Suggestion"),
				seedTitle(schema.id, "Unrated Suggestion", null),
				seedTitle(schema.id, "Adult Suggestion", true),
				seedTitle(schema.id, "Owned Suggestion"),
			]);
			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: older.id }),
				insertLibraryMembership(client, { mediaEntityId: exhausted.id }),
				insertLibraryMembership(client, { mediaEntityId: nsfwOnly.id }),
				insertLibraryMembership(client, { mediaEntityId: owned.id }),
			]);
			for (const [source, target] of [
				[older, fresh],
				[older, unknownRating],
				[older, adult],
				[older, owned],
				[exhausted, owned],
				[nsfwOnly, adult],
			] as const) {
				yield* insertGlobalRelationship({
					sourceEntityId: source.id,
					targetEntityId: target.id,
					relationshipSchema: suggestion,
				});
			}
			for (const [entity, occurredAt] of [
				[older, "2026-07-01T00:00:00.000Z"],
				[exhausted, "2026-07-02T00:00:00.000Z"],
				[nsfwOnly, "2026-07-03T00:00:00.000Z"],
			] as const) {
				yield* createEventFixture(client, {
					occurredAt,
					entityId: entity.id,
					eventSchemaSlug: complete,
					properties: { completionMode: "unknown" },
				});
			}

			const result = yield* executeRyotQLRecipe(
				client,
				latestCompletionSuggestionsRecipe({ reference, limit: 20 }),
			);
			expect(result.source?.id).toBe(older.id);
			expect(result.items.map((item) => item.id)).toEqual([fresh.id, unknownRating.id]);
		}),
	);
});

describe("Trending latest media", () => {
	it.live("reads each schema's own latest batch and interleaves the schemas by rank", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [{ pluginId, schema: movie }, { schema: show }, { schema: book }] = yield* Effect.all([
				findMediaEntitySchema(client, "movie"),
				findMediaEntitySchema(client, "show"),
				findMediaEntitySchema(client, "book"),
			]);
			const trending = yield* relationshipSchemaReference(
				client,
				movie.reference.owner,
				"media-trending",
			);
			const base = Date.UTC(2900, 0, 1) + (yield* Clock.currentTimeMillis);
			const at = (days: number) => new Date(base + days * 86_400_000).toISOString();
			const [movieOne, movieTwo, staleMovie, showOne, showTwo, adultShow, newestBook] =
				yield* Effect.all([
					seedTitle(movie.id, "Trending Movie One", null),
					seedTitle(movie.id, "Trending Movie Two"),
					seedTitle(movie.id, "Trending Stale Movie"),
					seedTitle(show.id, "Trending Show One"),
					seedTitle(show.id, "Trending Show Two", null),
					seedTitle(show.id, "Trending Adult Show", true),
					seedTitle(book.id, "Trending Newest Book"),
				]);
			yield* Effect.all(
				(
					[
						[movieOne, 1, at(0)],
						[movieTwo, 2, at(0)],
						[staleMovie, 1, at(-2)],
						[showOne, 1, at(-1)],
						[showTwo, 2, at(-1)],
						[adultShow, 3, at(-1)],
						[newestBook, 1, at(1)],
					] as const
				).map(([entity, rank, fetchedAt]) =>
					insertGlobalRelationship({
						sourceEntityId: entity.id,
						targetEntityId: entity.id,
						relationshipSchema: trending,
						properties: { rank, fetchedAt },
					}),
				),
			);

			const result = yield* executeRyotQLRecipe(
				client,
				trendingLatestMediaRecipe({
					limit: 20,
					entitySchemaSlugs: ["movie", "show"],
					reference: { pluginId, kind: "local" },
				}),
			);
			expect(result.items.map((item) => [item.id, item.rank, item.fetchedAt])).toEqual([
				[movieOne.id, 1, at(0)],
				[showOne.id, 1, at(-1)],
				[movieTwo.id, 2, at(0)],
				[showTwo.id, 2, at(-1)],
			]);
		}),
	);
});
