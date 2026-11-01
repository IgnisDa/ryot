import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQL,
	getSavedView,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	pollUntil,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRows,
	requireRyotQLValue,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	queryInMediaLibraryRelationship,
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
			externalId: `saved-view-sort-${yield* randomUuid}`,
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
	it.live("orders media by lifecycle activity, ignoring reviews and another user's activity", () =>
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
			const progress = requireEventSchemaBySlug(schemas, "progress");
			yield* createEventFixture(client, {
				entityId: older.id,
				eventSchemaSlug: review.id,
				properties: { rating: 80 },
				occurredAt: "2020-01-01T00:00:00.000Z",
			});
			expect(yield* savedViewIds(client, older.pluginId, "all-books")).toEqual([
				newer.id,
				older.id,
			]);
			yield* createEventFixture(client, {
				entityId: older.id,
				eventSchemaSlug: progress.id,
				properties: { progressPercent: 40 },
			});
			expect(
				yield* pollUntil(
					"progress moves the older book first",
					savedViewIds(client, older.pluginId, "all-books").pipe(
						Effect.map((ids) => (ids[0] === older.id ? ids : null)),
					),
				),
			).toEqual([older.id, newer.id]);
			yield* createEventFixture(otherClient, {
				entityId: newer.id,
				eventSchemaSlug: progress.id,
				properties: { progressPercent: 60 },
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
			const podcastIds = yield* savedViewIds(client, older.pluginId, "all-podcasts");
			expect(podcastIds).toHaveLength(2);
			expect(podcastIds).toEqual(expect.arrayContaining([newer.id, older.id]));
			const { schema: episodeSchema } = yield* findMediaEntitySchema(client, "podcast-episode");
			const events = yield* listEventSchemas(client, episodeSchema.reference);
			yield* createEventFixture(client, {
				entityId: episode.id,
				sessionEntityId: older.id,
				properties: { progressPercent: 50 },
				eventSchemaSlug: requireEventSchemaBySlug(events, "progress").id,
			});
			expect(
				yield* pollUntil(
					"episode progress moves the older podcast first",
					savedViewIds(client, older.pluginId, "all-podcasts").pipe(
						Effect.map((ids) => (ids[0] === older.id ? ids : null)),
					),
				),
			).toEqual([older.id, newer.id]);
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
						slug === "person" ? "all-people" : "all-companies",
					),
				).toEqual([more.id, fewer.id]);
			}),
		);
	}

	it.live("includes people credited on the user's saved media without adding memberships", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: otherClient } = yield* createAuthenticatedClient();
			const savedPerson = yield* seed(client, "person", "Saved person");
			const creditedPerson = yield* seed(client, "person", "Credited person");
			const duplicateCreditPerson = yield* seed(client, "person", "Multi-title person");
			const outsider = yield* seed(client, "person", "Other user's credited person");
			const mySavedTitle = yield* seed(client, "movie", "My saved title");
			const mySecondSavedTitle = yield* seed(client, "movie", "My second saved title");
			const otherUsersSavedTitle = yield* seed(client, "movie", "Other user's saved title");
			const { pluginId: otherPluginId } = yield* findMediaEntitySchema(otherClient, "person");

			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: savedPerson.id }),
				insertLibraryMembership(client, { mediaEntityId: mySavedTitle.id }),
				insertLibraryMembership(client, { mediaEntityId: mySecondSavedTitle.id }),
				insertLibraryMembership(otherClient, { mediaEntityId: otherUsersSavedTitle.id }),
			]);

			const personSchema = yield* findMediaEntitySchema(client, "person");
			const personToMovie = requireRelationshipSchemaBySlug(
				yield* listRelationshipSchemas(client, {
					slugs: ["person-to-movie"],
					owner: personSchema.schema.reference.owner,
				}),
				"person-to-movie",
				personSchema.schema.reference.owner,
			).reference;
			yield* Effect.all([
				insertGlobalRelationship({
					targetEntityId: mySavedTitle.id,
					sourceEntityId: creditedPerson.id,
					relationshipSchema: personToMovie,
				}),
				insertGlobalRelationship({
					targetEntityId: mySavedTitle.id,
					relationshipSchema: personToMovie,
					sourceEntityId: duplicateCreditPerson.id,
				}),
				insertGlobalRelationship({
					relationshipSchema: personToMovie,
					targetEntityId: mySecondSavedTitle.id,
					sourceEntityId: duplicateCreditPerson.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: outsider.id,
					relationshipSchema: personToMovie,
					targetEntityId: otherUsersSavedTitle.id,
				}),
			]);

			const userOnePeople = yield* savedViewIds(client, savedPerson.pluginId, "all-people");
			expect(userOnePeople).toHaveLength(3);
			expect(userOnePeople).toEqual(
				expect.arrayContaining([savedPerson.id, creditedPerson.id, duplicateCreditPerson.id]),
			);
			const userTwoPeople = yield* savedViewIds(otherClient, otherPluginId, "all-people");
			expect(userTwoPeople).toEqual([outsider.id]);

			const creditedMembership = yield* queryInMediaLibraryRelationship(
				client,
				creditedPerson.id,
				"person",
			);
			expect(
				creditedMembership.data.entity?.type === "rows" ? creditedMembership.data.entity.items : [],
			).toEqual([]);
			const duplicateCreditMembership = yield* queryInMediaLibraryRelationship(
				client,
				duplicateCreditPerson.id,
				"person",
			);
			expect(
				duplicateCreditMembership.data.entity?.type === "rows"
					? duplicateCreditMembership.data.entity.items
					: [],
			).toEqual([]);
		}),
	);

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
