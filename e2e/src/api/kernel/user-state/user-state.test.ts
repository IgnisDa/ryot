import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	type Client,
	clearEntityUserState,
	createAuthenticatedClient,
	createEntity,
	createEventSchema,
	createPluginSchema,
	createRelationshipSchema,
	createPluginSchemaAndEntity,
	createRelationship,
	executeRyotQL,
	getApiClient,
	listEventSchemas,
	listRelationshipSchemas,
	mergeUserState,
	queryUserEntityStateCounts,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRyotQLText,
	pollUntil,
	requireRows,
} from "~/fixtures/kernel";
import {
	createGlobalBookEntityFixture,
	findMediaEntitySchema,
	queryInMediaLibraryRelationship,
} from "~/fixtures/plugins/media";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const insertUserRelationship = (input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchema: ContractPayload<"relationships", "create">["relationshipSchema"];
	properties?: Record<string, unknown>;
	client: Client;
}) =>
	createRelationship(input.client, {
		properties: input.properties,
		relationshipSchema: input.relationshipSchema,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
	});

const mediaSuggestionSchemaReference = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "book");
		const schemas = yield* listRelationshipSchemas(client, {
			slugs: ["media-suggestion"],
			owner: schema.reference.owner,
		});
		return requireRelationshipSchemaBySlug(schemas, "media-suggestion", schema.reference.owner)
			.reference;
	});

const getMediaLibraryEntityId = (client: Client) =>
	Effect.gen(function* () {
		const mediaLibrary = table("entity", "mediaLibrary");
		const result = yield* executeRyotQL(
			client,
			document({
				libraries: rows(mediaLibrary, {
					limit: 1,
					fields: [field("id", column(mediaLibrary, "id"))],
					where: eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
				}),
			}),
		);
		const libraries = requireRows(result.data.libraries, "libraries");
		const libraryRow = libraries.items[0];
		assertPresent(libraryRow, "Missing library entity");
		return EntityId.make(requireRyotQLText(libraryRow, "id"));
	});

describe("DELETE /user-state/clear/:id", () => {
	it.live("clears only the caller's user-scoped state for a global entity", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(userA.client);
			const ownerPluginId =
				schema.reference.owner.kind === "plugin" ? schema.reference.owner.pluginId : undefined;
			assertPresent(ownerPluginId, "Media schema must have a plugin owner");
			const eventHistoryOwner = { kind: "local" as const, pluginId: ownerPluginId };

			const eventSchemas = yield* listEventSchemas(userA.client, schema.reference);
			const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
			const mediaSuggestionSchema = yield* mediaSuggestionSchemaReference(userA.client);
			const { entity: extraTarget } = yield* createGlobalBookEntityFixture(userA.client);
			const inLibraryRelationship = {
				sourceSchema: schema.slug,
				schema: "in-media-library",
				targetSchema: "media-library",
			};
			const mediaSuggestionRelationship = {
				sourceSchema: schema.slug,
				targetSchema: schema.slug,
				schema: "media-suggestion",
			};
			const queryCounts = (
				auth: typeof userA,
				relationships: Parameters<typeof queryUserEntityStateCounts>[0]["relationships"],
			) =>
				queryUserEntityStateCounts({
					relationships,
					client: auth.client,
					entityId: entity.id,
					owner: eventHistoryOwner,
					entitySchemaSlugs: [schema.slug],
					eventSchemaSlugs: [reviewEventSchema.slug],
				});

			yield* userA.client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							eventSchemaSlug: reviewEventSchema.id,
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
							eventSchemaSlug: reviewEventSchema.id,
							properties: { rating: 5, text: "User B review" },
						},
					],
				}),
			);
			yield* insertUserRelationship({
				client: userA.client,
				sourceEntityId: entity.id,
				targetEntityId: extraTarget.id,
				relationshipSchema: mediaSuggestionSchema,
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
				warnings: [],
				entityId: entity.id,
				deletedEventsCount: 2,
				deletedRelationshipsCount: 2,
			});
			expect(
				yield* queryCounts(userA, [inLibraryRelationship, mediaSuggestionRelationship]),
			).toEqual({ eventCount: 0, relationshipCount: 0 });
			expect(yield* queryCounts(userB, [inLibraryRelationship])).toEqual({
				eventCount: 1,
				relationshipCount: 1,
			});

			const userAMembership = yield* queryInMediaLibraryRelationship(
				userA.client,
				entity.id,
				schema.slug,
			);
			const userBMembership = yield* queryInMediaLibraryRelationship(
				userB.client,
				entity.id,
				schema.slug,
			);
			expect(
				userAMembership.data.entity?.type === "rows" ? userAMembership.data.entity.items : [],
			).toHaveLength(0);
			expect(
				userBMembership.data.entity?.type === "rows" ? userBMembership.data.entity.items : [],
			).toHaveLength(1);
		}),
	);

	it.live("rejects clearing the library entity user state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const libraryEntityId = yield* getMediaLibraryEntityId(client);

			const error = yield* Effect.flip(
				client.call((c) => c.userState.clearUserState({ params: { entityId: libraryEntityId } })),
			);

			assertTaggedError(error, "UserStateBadRequest");
			expect(error.reason).toEqual({ operation: "clear", code: "operation-denied" });
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const client = getApiClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.userState.clearUserState({ params: { entityId: EntityId.make("entity_1") } }),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("POST /user-state/merge", () => {
	it.live("moves user events and dedupes relationships from source to target", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entitySchemaSlug = `merge-schema-${crypto.randomUUID()}`;
			const eventSchemaSlug = `merged-event-${crypto.randomUUID()}`;
			const { reference, pluginSlug } = yield* createPluginSchema(client, {
				slug: entitySchemaSlug,
			});
			const relatedSchema = yield* createRelationshipSchema(client, {
				pluginSlug,
				slug: "merge-related",
				name: "Merge related",
				sourceEntitySchemaSlug: entitySchemaSlug,
				targetEntitySchemaSlug: entitySchemaSlug,
			});
			const ownerPluginId =
				reference.owner.kind === "plugin" ? reference.owner.pluginId : undefined;
			assertPresent(ownerPluginId, "User schema must have a plugin owner");
			const eventSchema = yield* createEventSchema(client, {
				name: "Merged Event",
				slug: eventSchemaSlug,
				entitySchema: reference,
			});
			const source = yield* createEntity(client, {
				name: "Source Entity",
				entitySchema: reference,
				properties: { title: "Source" },
			});
			const target = yield* createEntity(client, {
				name: "Target Entity",
				entitySchema: reference,
				properties: { title: "Target" },
			});
			const related = yield* createEntity(client, {
				name: "Related Entity",
				entitySchema: reference,
				properties: { title: "Related" },
			});
			const queryCounts = (entityId: string) =>
				queryUserEntityStateCounts({
					client,
					entityId,
					eventSchemaSlugs: [eventSchemaSlug],
					entitySchemaSlugs: [entitySchemaSlug],
					owner: { kind: "local", pluginId: ownerPluginId },
					relationships: [
						{
							schema: relatedSchema.slug,
							targetSchema: entitySchemaSlug,
							sourceSchema: entitySchemaSlug,
						},
					],
				});

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{ entityId: source.id, properties: { note: "moves" }, eventSchemaSlug: eventSchema.id },
					],
				}),
			);
			yield* insertUserRelationship({
				client,
				sourceEntityId: source.id,
				targetEntityId: related.id,
				relationshipSchema: relatedSchema.reference,
			});
			yield* insertUserRelationship({
				client,
				sourceEntityId: target.id,
				targetEntityId: related.id,
				relationshipSchema: relatedSchema.reference,
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
				warnings: [],
				movedEventsCount: 1,
				mergeFrom: source.id,
				mergeInto: target.id,
				movedRelationshipsCount: 1,
			});
			expect(yield* queryCounts(source.id)).toEqual({ eventCount: 0, relationshipCount: 0 });
			expect(yield* queryCounts(target.id)).toEqual({ eventCount: 1, relationshipCount: 1 });
		}),
	);

	it.live("rejects merging entities across schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const first = yield* createPluginSchemaAndEntity(client);
			const second = yield* createPluginSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.userState.mergeUserState({
						payload: { mergeFrom: first.entityId, mergeInto: second.entityId },
					}),
				),
			);

			assertTaggedError(error, "UserStateBadRequest");
			expect(error.reason).toEqual({ code: "entity-schema-mismatch" });
		}),
	);
});
