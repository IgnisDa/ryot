import { describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";
import { queryEngineField, queryEngineSystemRef } from "@ryot/query-engine";

import {
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
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertPresent, assertTaggedError } from "~/support/assertions";

async function insertUserRelationship(input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaSlug: string;
	properties?: Record<string, unknown>;
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"];
}) {
	const schemas = await listRelationshipSchemas(input.client, {
		slugs: [input.relationshipSchemaSlug],
	});
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);

	await createRelationship(input.client, {
		properties: input.properties,
		relationshipSchemaId: relationshipSchema.id,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
	});
}

async function getLibraryEntityId(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
) {
	const result = await executeQueryEngine(
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
}

describe("DELETE /user-state/clear/:id", () => {
	it("clears only the caller's user-scoped state for a global entity", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(userA.client);

		const eventSchemas = await listEventSchemas(userA.client, schema.id);
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
		const { slug: extraTargetSchemaSlug, entityId: extraTargetEntityId } =
			await createTrackerWithSchemaAndEntity(userA.client);
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

		await userA.client.run((c) =>
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
		await userB.client.run((c) =>
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
		await insertUserRelationship({
			client: userA.client,
			sourceEntityId: entity.id,
			targetEntityId: extraTargetEntityId,
			relationshipSchemaSlug: "media-suggestion",
		});

		await pollUntil("user A event setup", async () => {
			const counts = await queryCounts(userA, [inLibraryRelationship, mediaSuggestionRelationship]);
			return counts.eventCount === 1 && counts.relationshipCount === 2 ? counts : null;
		});
		await pollUntil("user B event setup", async () => {
			const counts = await queryCounts(userB, [inLibraryRelationship]);
			return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
		});

		const result = await clearEntityUserState(userA.client, entity.id);

		expect(result).toEqual({
			entityId: entity.id,
			deletedEventsCount: 1,
			deletedRelationshipsCount: 2,
		});
		expect(await queryCounts(userA, [inLibraryRelationship, mediaSuggestionRelationship])).toEqual({
			eventCount: 0,
			relationshipCount: 0,
		});
		expect(await queryCounts(userB, [inLibraryRelationship])).toEqual({
			eventCount: 1,
			relationshipCount: 1,
		});

		const userAMembership = await queryInLibraryRelationship(userA.client, entity.id, schema.slug);
		const userBMembership = await queryInLibraryRelationship(userB.client, entity.id, schema.slug);
		expect(userAMembership.data.items).toHaveLength(0);
		expect(userBMembership.data.items).toHaveLength(1);
	});

	it("rejects clearing the library entity user state", async () => {
		const { client } = await createAuthenticatedClient();
		const libraryEntityId = await getLibraryEntityId(client);

		const error = await client.runError((c) =>
			c.userState.clearUserState({ path: { entityId: libraryEntityId } }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Library entity user state cannot be cleared");
	});

	it("rejects unauthenticated requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.userState.clearUserState({ path: { entityId: EntityId.make("entity_1") } }),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("POST /user-state/merge", () => {
	it("moves user events and dedupes relationships from source to target", async () => {
		const { client } = await createAuthenticatedClient();
		const entitySchemaSlug = `merge-schema-${crypto.randomUUID()}`;
		const eventSchemaSlug = `merged-event-${crypto.randomUUID()}`;
		const { schemaId } = await createTrackerWithSchema(client, { slug: entitySchemaSlug });
		const eventSchema = await createEventSchema(client, {
			name: "Merged Event",
			slug: eventSchemaSlug,
			entitySchemaId: schemaId,
		});
		const source = await createEntity(client, {
			name: "Source Entity",
			entitySchemaId: schemaId,
			properties: { title: "Source" },
		});
		const target = await createEntity(client, {
			name: "Target Entity",
			entitySchemaId: schemaId,
			properties: { title: "Target" },
		});
		const related = await createEntity(client, {
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

		await client.run((c) =>
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
		await insertUserRelationship({
			client,
			sourceEntityId: source.id,
			targetEntityId: related.id,
			relationshipSchemaSlug: "media-suggestion",
		});
		await insertUserRelationship({
			client,
			sourceEntityId: target.id,
			targetEntityId: related.id,
			relationshipSchemaSlug: "media-suggestion",
		});
		await pollUntil("source event setup", async () => {
			const counts = await queryCounts(source.id);
			return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
		});

		const result = await mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });

		expect(result).toEqual({
			movedEventsCount: 1,
			mergeFrom: source.id,
			mergeInto: target.id,
			movedRelationshipsCount: 1,
		});
		expect(await queryCounts(source.id)).toEqual({
			eventCount: 0,
			relationshipCount: 0,
		});
		expect(await queryCounts(target.id)).toEqual({
			eventCount: 1,
			relationshipCount: 1,
		});
	});

	it("rejects merging entities across schemas", async () => {
		const { client } = await createAuthenticatedClient();
		const first = await createTrackerWithSchemaAndEntity(client);
		const second = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.userState.mergeUserState({
				payload: { mergeFrom: first.entityId, mergeInto: second.entityId },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Entities must belong to the same schema");
	});
});
