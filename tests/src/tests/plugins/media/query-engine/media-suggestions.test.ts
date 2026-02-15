import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildPersonalMediaSuggestionsQueryDocument,
} from "@ryot/media-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createGlobalBookEntityFixture,
	createRelationship,
	executeAggregateQueryEngine,
	insertGlobalRelationship,
	insertLibraryMembership,
	listRelationshipSchemas,
	requireQueryEngineFieldValue,
	requireRelationshipSchemaBySlug,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Query engine media suggestions", () => {
	it.live("builds user recommendations from persisted media-suggestion edges", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* createGlobalBookEntityFixture(client);
			const [sourceA, sourceB, candidateTop, candidateOther, alreadyOwned] = yield* Effect.all([
				createGlobalBookEntityFixture(client, {
					name: `User Rec Source A ${crypto.randomUUID()}`,
					externalId: `user-rec-source-a-${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `User Rec Source B ${crypto.randomUUID()}`,
					externalId: `user-rec-source-b-${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `User Rec Candidate Top ${crypto.randomUUID()}`,
					externalId: `user-rec-candidate-top-${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `User Rec Candidate Other ${crypto.randomUUID()}`,
					externalId: `user-rec-candidate-other-${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `User Rec Already Owned ${crypto.randomUUID()}`,
					externalId: `user-rec-already-owned-${crypto.randomUUID()}`,
				}),
			]);
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["media-suggestion"],
			});
			const mediaSuggestion = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"media-suggestion",
			);

			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: sourceA.entity.id }),
				insertLibraryMembership(client, { mediaEntityId: sourceB.entity.id }),
				insertLibraryMembership(client, { mediaEntityId: alreadyOwned.entity.id }),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceB.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateOther.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: alreadyOwned.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
			]);

			const doc = buildPersonalMediaSuggestionsQueryDocument({
				entitySchemaSlug: schema.slug,
				limit: 10,
			});

			const result = yield* executeAggregateQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);
			const [first, second] = result.data.items;
			assertPresent(first, "Expected top candidate row");
			assertPresent(second, "Expected other candidate row");
			expect(requireQueryEngineFieldValue(first, "name").value).toBe(candidateTop.entity.name);
			expect(requireQueryEngineFieldValue(first, "recommendingSourceCount").value).toBe(2);
			expect(requireQueryEngineFieldValue(second, "name").value).toBe(candidateOther.entity.name);
			expect(requireQueryEngineFieldValue(second, "recommendingSourceCount").value).toBe(1);
		}),
	);

	it.live(
		"builds collection recommendations from persisted media-suggestion edges without excluding existing members",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const collection = yield* createCollection(client, {
					name: `Suggestion Collection ${crypto.randomUUID()}`,
				});
				const { schema } = yield* createGlobalBookEntityFixture(client);
				const [sourceA, sourceB, candidateTop, candidateExisting] = yield* Effect.all([
					createGlobalBookEntityFixture(client, {
						name: `Collection Rec Source A ${crypto.randomUUID()}`,
						externalId: `collection-rec-source-a-${crypto.randomUUID()}`,
					}),
					createGlobalBookEntityFixture(client, {
						name: `Collection Rec Source B ${crypto.randomUUID()}`,
						externalId: `collection-rec-source-b-${crypto.randomUUID()}`,
					}),
					createGlobalBookEntityFixture(client, {
						name: `Collection Rec Candidate Top ${crypto.randomUUID()}`,
						externalId: `collection-rec-candidate-top-${crypto.randomUUID()}`,
					}),
					createGlobalBookEntityFixture(client, {
						name: `Collection Rec Existing Member ${crypto.randomUUID()}`,
						externalId: `collection-rec-existing-${crypto.randomUUID()}`,
					}),
				]);
				const relationshipSchemas = yield* listRelationshipSchemas(client, {
					slugs: ["media-suggestion", "member-of"],
				});
				const mediaSuggestion = requireRelationshipSchemaBySlug(
					relationshipSchemas,
					"media-suggestion",
				);
				const memberOf = requireRelationshipSchemaBySlug(relationshipSchemas, "member-of");

				yield* Effect.all([
					createRelationship(client, {
						properties: {},
						targetEntityId: collection.id,
						sourceEntityId: sourceA.entity.id,
						relationshipSchemaSlug: memberOf.id,
					}),
					createRelationship(client, {
						properties: {},
						targetEntityId: collection.id,
						sourceEntityId: sourceB.entity.id,
						relationshipSchemaSlug: memberOf.id,
					}),
					createRelationship(client, {
						properties: {},
						targetEntityId: collection.id,
						relationshipSchemaSlug: memberOf.id,
						sourceEntityId: candidateExisting.entity.id,
					}),
					insertGlobalRelationship({
						sourceEntityId: sourceA.entity.id,
						targetEntityId: candidateTop.entity.id,
						relationshipSchemaSlug: mediaSuggestion.id,
					}),
					insertGlobalRelationship({
						sourceEntityId: sourceB.entity.id,
						targetEntityId: candidateTop.entity.id,
						relationshipSchemaSlug: mediaSuggestion.id,
					}),
					insertGlobalRelationship({
						sourceEntityId: sourceA.entity.id,
						targetEntityId: candidateExisting.entity.id,
						relationshipSchemaSlug: mediaSuggestion.id,
					}),
				]);

				const doc = buildCollectionMediaSuggestionsQueryDocument({
					collectionId: collection.id,
					entitySchemaSlug: schema.slug,
					limit: 10,
				});

				const result = yield* executeAggregateQueryEngine(client, doc);

				expect(result.data.items).toHaveLength(2);
				const byName = new Map(
					result.data.items.map((item) => [
						String(requireQueryEngineFieldValue(item, "name").value),
						Number(requireQueryEngineFieldValue(item, "recommendingSourceCount").value),
					]),
				);
				expect(byName.get(candidateTop.entity.name)).toBe(2);
				expect(byName.get(candidateExisting.entity.name)).toBe(1);
			}),
	);
});
