import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	findBuiltinSchemaWithProviders,
	listEventSchemas,
	seedMediaEntity,
	waitForEventCount,
} from "../fixtures";
import { getPgClient } from "../setup";

describe("POST /events with global entities", () => {
	it("creates the event and upserts in_library for the user", async () => {
		const { client, cookies, email } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			externalId: `global-book-${crypto.randomUUID()}`,
			name: `Global Built-in Book ${crypto.randomUUID()}`,
		});

		const eventSchemas = await listEventSchemas(client, cookies, schema.id);
		const backlogEventSchema = eventSchemas.find(
			(eventSchema) => eventSchema.slug === "backlog",
		);
		if (!backlogEventSchema) {
			throw new Error("Missing built-in backlog event schema");
		}

		const createResult = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					properties: {},
					entityId: entity.id,
					eventSchemaId: backlogEventSchema.id,
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(1);

		const events = await waitForEventCount(client, cookies, entity.id, 1);
		expect(events).toHaveLength(1);
		expect(events[0]?.eventSchemaSlug).toBe("backlog");

		const membership = await getPgClient().query(
			`select r.id
			 from relationship r
			 inner join relationship_schema rs on rs.id = r.relationship_schema_id
			 inner join entity library_entity on library_entity.id = r.target_entity_id
			 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
			 inner join "user" u on u.id = library_entity.user_id
			 where rs.slug = 'in-library'
			   and r.user_id = u.id
			   and r.source_entity_id = $1
			   and u.email = $2
			   and library_schema.slug = 'library'
			 limit 1`,
			[entity.id, email],
		);

		expect(membership.rowCount).toBe(1);
	});
});
