import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { linkedFilterChoicesRecipe } from "@ryot-app/ryotql-recipes/filters";
import { entityBrowserRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { DateTime, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	executeRyotQLRecipe,
	getSavedView,
	insertGlobalRelationship,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { seedGlobalMediaGenres } from "~/fixtures/plugins/media/genres";
import {
	assertCondition,
	assertPresent,
	requirePresent,
	resultToEffect,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Media genres", () => {
	it.live("filters media by genres and keeps relationship choices private", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { pluginId, schema: movieSchema } = yield* findMediaEntitySchema(userA.client, "movie");
			const { schema: genreSchema } = yield* findMediaEntitySchema(userA.client, "genre");
			const view = yield* getSavedView(userA.client, {
				pluginId,
				kind: "plugin",
				slug: "all-movies",
			});
			const settings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(
				view.settings,
			);
			const genreFilter = requirePresent(
				settings.filterFields?.find(({ key }) => key === "genres"),
				"Movie saved view has no genre relationship filter",
			);
			assertCondition(
				genreFilter.kind === "relationship",
				"Movie genre filter is not a relationship filter",
			);
			const source = requirePresent(view.dataSources, "Movie saved view has no data source");
			const relationshipSchema = requireRelationshipSchemaBySlug(
				yield* listRelationshipSchemas(userA.client, {
					slugs: ["movie-to-genre"],
					owner: movieSchema.reference.owner,
				}),
				"movie-to-genre",
				movieSchema.reference.owner,
			).reference;
			const queryRelationship = {
				slug: genreFilter.relationship.slug,
				owner: { pluginId, kind: "local" as const },
			};

			const suffix = crypto.randomUUID();
			const seedMovie = (name: string) =>
				seedMediaEntity({
					name,
					properties: {},
					providerId: null,
					entitySchemaSlug: movieSchema.id,
					externalId: `media-genre-filter-${crypto.randomUUID()}`,
				});
			const [both, alphaOnly, betaOnly, untagged] = yield* Effect.all([
				seedMovie(`Genre filter both ${suffix}`),
				seedMovie(`Genre filter alpha ${suffix}`),
				seedMovie(`Genre filter beta ${suffix}`),
				seedMovie(`Genre filter none ${suffix}`),
			]);
			assertPresent(both, "Missing movie with both genres");
			assertPresent(alphaOnly, "Missing movie with the first genre");
			assertPresent(betaOnly, "Missing movie with the second genre");
			assertPresent(untagged, "Missing movie without genres");
			yield* Effect.forEach([both, alphaOnly, betaOnly, untagged], (movie) =>
				insertLibraryMembership(userA.client, { mediaEntityId: movie.id }),
			);
			const genres = yield* seedGlobalMediaGenres({
				entityId: both.id,
				entitySchemaSlug: "movie",
				names: [`Genre alpha ${suffix}`, `Genre beta ${suffix}`],
			});
			const alpha = genres[0];
			const beta = genres[1];
			assertPresent(alpha, "Missing first seeded genre");
			assertPresent(beta, "Missing second seeded genre");
			yield* Effect.all([
				insertGlobalRelationship({
					relationshipSchema,
					targetEntityId: alpha.id,
					sourceEntityId: alphaOnly.id,
				}),
				insertGlobalRelationship({
					relationshipSchema,
					targetEntityId: beta.id,
					sourceEntityId: betaOnly.id,
				}),
			]);

			const now = yield* DateTime.now;
			const runFilter = (filter: Filter) =>
				Effect.gen(function* () {
					const ids: string[] = [];
					let after: string | undefined;
					for (;;) {
						const recipe = yield* resultToEffect(
							entityBrowserRecipe({
								now,
								after,
								filter,
								searchText: suffix,
								queryDocument: source,
								settings: { ...settings, pageSize: 100 },
							}),
						);
						const page = yield* executeRyotQLRecipe(userA.client, recipe);
						ids.push(...page.items.map(({ entityId }) => entityId));
						if (!page.pageInfo.hasMore) {
							return ids;
						}
						after = requirePresent(page.pageInfo.nextCursor, "Movie genre page has no cursor");
					}
				});

			const anyOf = yield* runFilter({ field: "genres", operator: "anyOf", values: [alpha.id] });
			expect(anyOf).toEqual(expect.arrayContaining([both.id, alphaOnly.id]));
			expect(anyOf).toHaveLength(2);
			const allOf = yield* runFilter({
				field: "genres",
				operator: "allOf",
				values: [alpha.id, beta.id],
			});
			expect(allOf).toEqual([both.id]);
			const noneOf = yield* runFilter({ field: "genres", operator: "noneOf", values: [alpha.id] });
			expect(noneOf).toContain(betaOnly.id);
			expect(noneOf).toContain(untagged.id);
			expect(noneOf).not.toContain(both.id);
			expect(noneOf).not.toContain(alphaOnly.id);
			const empty = yield* runFilter({ field: "genres", operator: "empty" });
			expect(empty).toContain(untagged.id);
			expect(empty).not.toContain(both.id);
			expect(empty).not.toContain(alphaOnly.id);
			expect(empty).not.toContain(betaOnly.id);
			const notEmpty = yield* runFilter({ field: "genres", operator: "notEmpty" });
			expect(notEmpty).toEqual(expect.arrayContaining([both.id, alphaOnly.id, betaOnly.id]));
			expect(notEmpty).toHaveLength(3);

			const privateMovie = yield* createEntity(userA.client, {
				properties: {},
				name: `Private movie ${suffix}`,
				entitySchema: movieSchema.reference,
			});
			const privateGenreName = `Private genre ${suffix}`;
			const privateGenre = yield* createEntity(userA.client, {
				properties: {},
				name: privateGenreName,
				entitySchema: genreSchema.reference,
			});
			yield* createRelationship(userA.client, {
				relationshipSchema,
				sourceEntityId: EntityId.make(privateMovie.id),
				targetEntityId: EntityId.make(privateGenre.id),
			});
			const choicesRecipe = linkedFilterChoicesRecipe({
				ids: [privateGenre.id],
				link: { kind: "relationship", direction: "outgoing", relationship: queryRelationship },
			});
			const userAChoices = yield* executeRyotQLRecipe(userA.client, choicesRecipe);
			const userBChoices = yield* executeRyotQLRecipe(userB.client, choicesRecipe);
			expect(userAChoices).toEqual([{ value: privateGenre.id, label: privateGenreName }]);
			expect(userBChoices).toEqual([]);
		}),
	);
});
