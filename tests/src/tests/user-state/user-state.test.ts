import { EntityId } from "@ryot/contract/schema/brands";
import { queryEngineField, queryEngineSystemRef } from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import {
	type Client,
	buildEntityRowsQueryDocument,
	clearEntityUserState,
	createAuthenticatedClient,
	createEntity,
	createEventSchema,
	createGlobalBookEntityFixture,
	createRelationship,
	createTrackerWithSchema,
	createTrackerWithSchemaAndEntity,
	executeQueryEngine,
	getBackendClient,
	listEventSchemas,
	listRelationshipSchemas,
	mergeUserState,
	queryInLibraryRelationship,
	queryUserEntityStateCounts,
	requireQueryEngineTextField,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	pollUntil,
} from "~/fixtures";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const insertUserRelationship = (input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaSlug: string;
	properties?: Record<string, unknown>;
	client: Client;
}) =>
	Effect.gen(function* () {
		const schemas = yield* listRelationshipSchemas(input.client, {
			slugs: [input.relationshipSchemaSlug],
		});
		const relationshipSchema = requireRelationshipSchemaBySlug(
			schemas,
			input.relationshipSchemaSlug,
		);

		yield* createRelationship(input.client, {
			properties: input.properties,
			relationshipSchemaId: relationshipSchema.id,
			sourceEntityId: EntityId.make(input.sourceEntityId),
			targetEntityId: EntityId.make(input.targetEntityId),
		});
	});

const getLibraryEntityId = (client: Client) =>
	Effect.gen(function* () {
		const result = yield* executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				limit: 1,
				alias: "library",
				schemas: ["library"],
				fields: [queryEngineField("id", queryEngineSystemRef("library", "id"))],
			}),
		);
		const library = result.data.items[0];
		assertPresent(library, "Missing library entity");
		return EntityId.make(requireQueryEngineTextField(library, "id"));
	});

describe("DELETE /user-state/clear/:id", () => {
	it.live("clears only the caller's user-scoped state for a global entity", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(userA.client);

			const eventSchemas = yield* listEventSchemas(userA.client, schema.id);
			const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
			const { slug: extraTargetSchemaSlug, entityId: extraTargetEntityId } =
				yield* createTrackerWithSchemaAndEntity(userA.client);
			const inLibraryRelationship = {
				schema: "in-library",
				targetSchema: "library",
				sourceSchema: schema.slug,
			};
			const mediaSuggestionRelationship = {
				sourceSchema: schema.slug,
				schema: "media-suggestion",
				targetSchema: extraTargetSchemaSlug,
			};
			const queryCounts = (
				auth: typeof userA,
				relationships: Parameters<typeof queryUserEntityStateCounts>[0]["relationships"],
			) =>
				queryUserEntityStateCounts({
					relationships,
					client: auth.client,
					entityId: entity.id,
					entitySchemaSlugs: [schema.slug],
					eventSchemaSlugs: [reviewEventSchema.slug],
				});

			yield* userA.client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							eventSchemaId: reviewEventSchema.id,
							properties: { rating: 4, text: "User A review" },
						},
					],
				}),
			);
			yield* userB.client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							eventSchemaId: reviewEventSchema.id,
							properties: { rating: 5, text: "User B review" },
						},
					],
				}),
			);
			yield* insertUserRelationship({
				client: userA.client,
				sourceEntityId: entity.id,
				targetEntityId: extraTargetEntityId,
				relationshipSchemaSlug: "media-suggestion",
			});

			yield* pollUntil(
				"user A event setup",
				Effect.gen(function* () {
					const counts = yield* queryCounts(userA, [
						inLibraryRelationship,
						mediaSuggestionRelationship,
					]);
					return counts.eventCount === 1 && counts.relationshipCount === 2 ? counts : null;
				}),
			);
			yield* pollUntil(
				"user B event setup",
				Effect.gen(function* () {
					const counts = yield* queryCounts(userB, [inLibraryRelationship]);
					return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
				}),
			);

			const result = yield* clearEntityUserState(userA.client, entity.id);

			expect(result).toEqual({
				entityId: entity.id,
				deletedEventsCount: 1,
				deletedRelationshipsCount: 2,
			});
			expect(
				yield* queryCounts(userA, [inLibraryRelationship, mediaSuggestionRelationship]),
			).toEqual({
				eventCount: 0,
				relationshipCount: 0,
			});
			expect(yield* queryCounts(userB, [inLibraryRelationship])).toEqual({
				eventCount: 1,
				relationshipCount: 1,
			});

			const userAMembership = yield* queryInLibraryRelationship(
				userA.client,
				entity.id,
				schema.slug,
			);
			const userBMembership = yield* queryInLibraryRelationship(
				userB.client,
				entity.id,
				schema.slug,
			);
			expect(userAMembership.data.items).toHaveLength(0);
			expect(userBMembership.data.items).toHaveLength(1);
		}),
	);

	it.live("rejects clearing the library entity user state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const libraryEntityId = yield* getLibraryEntityId(client);

			const error = yield* Effect.flip(
				client.call((c) => c.userState.clearUserState({ path: { entityId: libraryEntityId } })),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Library entity user state cannot be cleared");
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.userState.clearUserState({ path: { entityId: EntityId.make("entity_1") } }),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);
});

describe("POST /user-state/merge", () => {
	it.live("moves user events and dedupes relationships from source to target", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entitySchemaSlug = `merge-schema-${crypto.randomUUID()}`;
			const eventSchemaSlug = `merged-event-${crypto.randomUUID()}`;
			const { schemaId } = yield* createTrackerWithSchema(client, { slug: entitySchemaSlug });
			const eventSchema = yield* createEventSchema(client, {
				name: "Merged Event",
				slug: eventSchemaSlug,
				entitySchemaId: schemaId,
			});
			const source = yield* createEntity(client, {
				name: "Source Entity",
				entitySchemaId: schemaId,
				properties: { title: "Source" },
			});
			const target = yield* createEntity(client, {
				name: "Target Entity",
				entitySchemaId: schemaId,
				properties: { title: "Target" },
			});
			const related = yield* createEntity(client, {
				name: "Related Entity",
				entitySchemaId: schemaId,
				properties: { title: "Related" },
			});
			const queryCounts = (entityId: string) =>
				queryUserEntityStateCounts({
					client,
					entityId,
					eventSchemaSlugs: [eventSchemaSlug],
					entitySchemaSlugs: [entitySchemaSlug],
					relationships: [
						{
							schema: "media-suggestion",
							targetSchema: entitySchemaSlug,
							sourceSchema: entitySchemaSlug,
						},
					],
				});

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: source.id,
							properties: { note: "moves" },
							eventSchemaId: eventSchema.id,
						},
					],
				}),
			);
			yield* insertUserRelationship({
				client,
				sourceEntityId: source.id,
				targetEntityId: related.id,
				relationshipSchemaSlug: "media-suggestion",
			});
			yield* insertUserRelationship({
				client,
				sourceEntityId: target.id,
				targetEntityId: related.id,
				relationshipSchemaSlug: "media-suggestion",
			});
			yield* pollUntil(
				"source event setup",
				Effect.gen(function* () {
					const counts = yield* queryCounts(source.id);
					return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
				}),
			);

			const result = yield* mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });

			expect(result).toEqual({
				movedEventsCount: 1,
				mergeFrom: source.id,
				mergeInto: target.id,
				movedRelationshipsCount: 1,
			});
			expect(yield* queryCounts(source.id)).toEqual({
				eventCount: 0,
				relationshipCount: 0,
			});
			expect(yield* queryCounts(target.id)).toEqual({
				eventCount: 1,
				relationshipCount: 1,
			});
		}),
	);

	it.live("rejects merging entities across schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const first = yield* createTrackerWithSchemaAndEntity(client);
			const second = yield* createTrackerWithSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.userState.mergeUserState({
						payload: { mergeFrom: first.entityId, mergeInto: second.entityId },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Entities must belong to the same schema");
		}),
	);
});
