import { describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/app-backend/schema/brands";

import {
	clearEntityUserState,
	createAuthenticatedClient,
	createEntity,
	createEventSchema,
	createGlobalBookEntityFixture,
	createRelationship,
	createTrackerWithSchema,
	createTrackerWithSchemaAndEntity,
	getBackendClient,
	insertLibraryMembership,
	listEventSchemas,
	listRelationshipSchemas,
	mergeUserState,
	queryInLibraryRelationship,
	queryUserEntityStateCounts,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
import { assertPresent, assertTaggedError } from "../test-support/assertions";

async function insertUserRelationship(input: {
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"];
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaSlug: string;
	properties?: Record<string, unknown>;
}) {
	const schemas = await listRelationshipSchemas(input.client, {
		slugs: [input.relationshipSchemaSlug],
	});
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);

	await createRelationship(input.client, {
		properties: input.properties,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
		relationshipSchemaId: relationshipSchema.id,
	});
}

async function getLibraryEntityId(userId: string) {
	const pg = getPgClient();
	const result = await pg.query<{ id: string }>(
		`select e.id
		 from entity e
		 inner join entity_schema es on es.id = e.entity_schema_id
		 where e.user_id = $1
		   and es.slug = 'library'
		   and es.user_id is null
		 limit 1`,
		[userId],
	);

	const libraryEntityId = result.rows[0]?.id;
	assertPresent(libraryEntityId, `Missing library entity for user '${userId}'`);

	return EntityId.make(libraryEntityId);
}

describe("DELETE /user-state/clear/:id", () => {
	it("clears only the caller's user-scoped state for a global entity", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(userA.client);

		const eventSchemas = await listEventSchemas(userA.client, schema.id);
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");

		const { entityId: extraTargetEntityId } = await createTrackerWithSchemaAndEntity(userA.client);

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

		await insertLibraryMembership(userB.client, { userId: userB.userId, mediaEntityId: entity.id });
		await insertLibraryMembership(userA.client, { userId: userA.userId, mediaEntityId: entity.id });
		await insertUserRelationship({
			client: userA.client,
			sourceEntityId: entity.id,
			targetEntityId: extraTargetEntityId,
			relationshipSchemaSlug: "media-suggestion",
		});

		await pollUntil("user A event setup", async () => {
			const counts = await queryUserEntityStateCounts({
				userId: userA.userId,
				entityId: entity.id,
			});
			return counts.eventCount === 1 && counts.relationshipCount === 2 ? counts : null;
		});
		await pollUntil("user B event setup", async () => {
			const counts = await queryUserEntityStateCounts({
				userId: userB.userId,
				entityId: entity.id,
			});
			return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
		});

		const result = await clearEntityUserState(userA.client, entity.id);

		expect(result).toEqual({
			entityId: entity.id,
			deletedEventsCount: 1,
			deletedRelationshipsCount: 2,
		});
		expect(await queryUserEntityStateCounts({ userId: userA.userId, entityId: entity.id })).toEqual(
			{ eventCount: 0, relationshipCount: 0 },
		);
		expect(await queryUserEntityStateCounts({ userId: userB.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 1 },
		);

		const userAMembership = await queryInLibraryRelationship(userA.client, entity.id, userA.email);
		const userBMembership = await queryInLibraryRelationship(userB.client, entity.id, userB.email);
		expect(userAMembership.rowCount).toBe(0);
		expect(userBMembership.rowCount).toBe(1);
	});

	it("rejects clearing the library entity user state", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const libraryEntityId = await getLibraryEntityId(userId);

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
		const { client, userId } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);
		const eventSchema = await createEventSchema(client, {
			entitySchemaId: schemaId,
			name: "Merged Event",
			slug: `merged-event-${crypto.randomUUID()}`,
		});
		const source = await createEntity(client, {
			image: null,
			name: "Source Entity",
			entitySchemaId: schemaId,
			properties: { title: "Source" },
		});
		const target = await createEntity(client, {
			image: null,
			name: "Target Entity",
			entitySchemaId: schemaId,
			properties: { title: "Target" },
		});
		const related = await createEntity(client, {
			image: null,
			name: "Related Entity",
			entitySchemaId: schemaId,
			properties: { title: "Related" },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: source.id,
						eventSchemaId: eventSchema.id,
						properties: { note: "moves" },
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
			const counts = await queryUserEntityStateCounts({ userId, entityId: source.id });
			return counts.eventCount === 1 && counts.relationshipCount === 1 ? counts : null;
		});

		const result = await mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });

		expect(result).toEqual({
			movedEventsCount: 1,
			mergeFrom: source.id,
			mergeInto: target.id,
			movedRelationshipsCount: 1,
		});
		expect(await queryUserEntityStateCounts({ userId, entityId: source.id })).toEqual({
			eventCount: 0,
			relationshipCount: 0,
		});
		expect(await queryUserEntityStateCounts({ userId, entityId: target.id })).toEqual({
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
