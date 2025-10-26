import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createRelationship,
	createRelationshipSchema,
	createTracker,
	getBackendClient,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

async function makeRelationshipFixture(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
) {
	const { trackerId } = await createTracker(client, { name: "Relationship Test Tracker" });
	const { schemaId } = await createEntitySchema(client, {
		trackerId,
		name: "Relationship Test Entity",
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
	const relSchema = await createRelationshipSchema(client, {
		name: "Test Relationship",
		slug: `test-rel-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				rating: { type: "integer", label: "Rating", description: "Rating" },
			},
		},
	});
	return { source, target, relSchema };
}

describe("POST /relationships", () => {
	it("creates a relationship and returns 201 with wasInserted: true", async () => {
		const { client } = await createAuthenticatedClient();
		const { source, target, relSchema } = await makeRelationshipFixture(client);

		const result = await createRelationship(client, {
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relSchema.id,
			properties: { rating: 7 },
		});

		expect(result.wasInserted).toBe(true);
		expect(result.sourceEntityId).toBe(source.id);
		expect(result.targetEntityId).toBe(target.id);
		expect(result.relationshipSchemaId).toBe(relSchema.id);
		expect(result.properties).toMatchObject({ rating: 7 });
		expect(result.id).toBeDefined();
		expect(result.createdAt).toBeDefined();
	});

	it("upserts on duplicate and returns wasInserted: false with updated properties", async () => {
		const { client } = await createAuthenticatedClient();
		const { source, target, relSchema } = await makeRelationshipFixture(client);

		await createRelationship(client, {
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relSchema.id,
			properties: { rating: 3 },
		});

		const upserted = await createRelationship(client, {
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relSchema.id,
			properties: { rating: 9 },
		});

		expect(upserted.wasInserted).toBe(false);
		expect(upserted.properties).toMatchObject({ rating: 9 });
	});

	it("returns 404 when the relationship schema belongs to another user", async () => {
		const owner = await createAuthenticatedClient();
		const intruder = await createAuthenticatedClient();
		const { relSchema } = await makeRelationshipFixture(owner.client);
		const { source, target } = await makeRelationshipFixture(intruder.client);

		const error = await intruder.client.runError((c) =>
			c.relationships.create({
				payload: {
					sourceEntityId: source.id,
					targetEntityId: target.id,
					relationshipSchemaId: relSchema.id,
				},
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Relationship schema not found");
	});

	it("returns 400 when properties violate the relationship schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { source, target } = await makeRelationshipFixture(client);
		const strictSchema = await createRelationshipSchema(client, {
			name: "Strict Relationship",
			slug: `strict-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					status: {
						type: "enum",
						label: "Status",
						description: "Status",
						options: ["active", "inactive"],
					},
				},
			},
		});

		const error = await client.runError((c) =>
			c.relationships.create({
				payload: {
					sourceEntityId: source.id,
					targetEntityId: target.id,
					relationshipSchemaId: strictSchema.id,
					properties: { status: "deleted" },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("returns 401 for unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();
		const { source, target, relSchema } = await makeRelationshipFixture(client);
		const unauthClient = getBackendClient();

		const error = await unauthClient.runError((c) =>
			c.relationships.create({
				payload: {
					sourceEntityId: source.id,
					targetEntityId: target.id,
					relationshipSchemaId: relSchema.id,
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});
