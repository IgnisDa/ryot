import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQL,
	getSavedView,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRows,
	requireRyotQLValue,
	type Client,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginSavedViewReference = Extract<Parameters<typeof getSavedView>[1], { kind: "plugin" }>;

const seed = (
	client: Client,
	slug: string,
	name: string,
	properties: Record<string, unknown> = {},
) =>
	Effect.gen(function* () {
		const { schema, pluginId } = yield* findMediaEntitySchema(client, slug);
		const entity = yield* seedMediaEntity({
			name,
			properties,
			providerId: null,
			entitySchemaSlug: schema.id,
			externalId: `saved-view-sort-${crypto.randomUUID()}`,
		});
		return { ...entity, pluginId, reference: schema.reference };
	});

const savedViewIds = (
	client: Client,
	pluginId: PluginSavedViewReference["pluginId"],
	slug: string,
) =>
	Effect.gen(function* () {
		const view = yield* getSavedView(client, { slug, pluginId, kind: "plugin" });
		const result = yield* executeRyotQL(
			client,
			requirePresent(view.dataSources, "Expected saved-view data sources"),
		);
		return requireRows(result.data.savedView, "savedView").items.map((item) =>
			requireRyotQLValue(item, "entityId"),
		);
	});

describe("Media saved-view sorting", () => {
	it.live(
		"orders media by user updates and library additions, excluding another user's activity",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { client: otherClient } = yield* createAuthenticatedClient();
				const older = yield* seed(client, "book", "Alpha");
				const newer = yield* seed(client, "book", "Zulu");
				yield* insertLibraryMembership(client, { mediaEntityId: older.id });
				yield* insertLibraryMembership(client, { mediaEntityId: newer.id });
				expect(yield* savedViewIds(client, older.pluginId, "all-books")).toEqual([
					newer.id,
					older.id,
				]);

				const { schema: bookSchema } = yield* findMediaEntitySchema(client, "book");
				const schemas = yield* listEventSchemas(client, bookSchema.reference);
				const review = requireEventSchemaBySlug(schemas, "review");
				yield* createEventFixture(client, {
					entityId: older.id,
					eventSchemaSlug: review.id,
					properties: { rating: 80 },
					occurredAt: "2020-01-01T00:00:00.000Z",
				});
				expect(yield* savedViewIds(client, older.pluginId, "all-books")).toEqual([
					older.id,
					newer.id,
				]);
				yield* createEventFixture(otherClient, {
					entityId: newer.id,
					eventSchemaSlug: review.id,
					properties: { rating: 90 },
				});
				expect(yield* savedViewIds(client, older.pluginId, "all-books")).toEqual([
					older.id,
					newer.id,
				]);
			}),
	);

	it.live("uses episode activity when ordering podcasts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const older = yield* seed(client, "podcast", "Alpha");
			const newer = yield* seed(client, "podcast", "Zulu");
			const episode = yield* seed(client, "podcast-episode", "Episode", { episodeNumber: 1 });
			const relationships = yield* listRelationshipSchemas(client, {
				owner: older.reference.owner,
				slugs: ["podcast-to-podcast-episode"],
			});
			yield* insertGlobalRelationship({
				sourceEntityId: older.id,
				targetEntityId: episode.id,
				relationshipSchema: requireRelationshipSchemaBySlug(
					relationships,
					"podcast-to-podcast-episode",
					older.reference.owner,
				).reference,
			});
			yield* insertLibraryMembership(client, { mediaEntityId: older.id });
			yield* insertLibraryMembership(client, { mediaEntityId: newer.id });
			expect(yield* savedViewIds(client, older.pluginId, "all-podcasts")).toEqual([
				newer.id,
				older.id,
			]);
			const { schema: episodeSchema } = yield* findMediaEntitySchema(client, "podcast-episode");
			const events = yield* listEventSchemas(client, episodeSchema.reference);
			yield* createEventFixture(client, {
				entityId: episode.id,
				sessionEntityId: older.id,
				properties: { progressPercent: 50 },
				eventSchemaSlug: requireEventSchemaBySlug(events, "progress").id,
			});
			expect(yield* savedViewIds(client, older.pluginId, "all-podcasts")).toEqual([
				older.id,
				newer.id,
			]);
		}),
	);

	for (const slug of ["person", "company"] as const) {
		it.live(`orders ${slug} views by associated media count`, () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const fewer = yield* seed(client, slug, "Alpha");
				const more = yield* seed(client, slug, "Zulu");
				const movie = yield* seed(client, "movie", "Movie");
				const book = yield* seed(client, "book", "Book");
				yield* insertLibraryMembership(client, { mediaEntityId: fewer.id });
				yield* insertLibraryMembership(client, { mediaEntityId: more.id });
				const schemas = yield* listRelationshipSchemas(client, {
					owner: fewer.reference.owner,
					slugs: [`${slug}-to-movie`, `${slug}-to-book`],
				});
				for (const creator of [fewer, more]) {
					yield* insertGlobalRelationship({
						targetEntityId: movie.id,
						sourceEntityId: creator.id,
						relationshipSchema: requireRelationshipSchemaBySlug(
							schemas,
							`${slug}-to-movie`,
							fewer.reference.owner,
						).reference,
					});
				}
				yield* insertGlobalRelationship({
					sourceEntityId: more.id,
					targetEntityId: book.id,
					relationshipSchema: requireRelationshipSchemaBySlug(
						schemas,
						`${slug}-to-book`,
						more.reference.owner,
					).reference,
				});
				expect(
					yield* savedViewIds(
						client,
						fewer.pluginId,
						slug === "person" ? "all-persons" : "all-companies",
					),
				).toEqual([more.id, fewer.id]);
			}),
		);
	}

	it.live("orders series by numeric part count", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fewer = yield* seed(client, "movie-group", "Alpha", { parts: 2 });
			const more = yield* seed(client, "movie-group", "Zulu", { parts: 10 });
			yield* insertLibraryMembership(client, { mediaEntityId: fewer.id });
			yield* insertLibraryMembership(client, { mediaEntityId: more.id });
			expect(yield* savedViewIds(client, fewer.pluginId, "all-movie-series")).toEqual([
				more.id,
				fewer.id,
			]);
		}),
	);
});
