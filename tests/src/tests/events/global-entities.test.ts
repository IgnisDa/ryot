import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createGlobalBookEntityFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForEventCount,
	waitForInLibraryRelationship,
} from "~/fixtures";

describe("POST /events with global entities", () => {
	it("creates the event and upserts in_library for the user", async () => {
		const { client } = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(client);

		const eventSchemas = await listEventSchemas(client, schema.id);
		const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");

		const createResult = await client.run((c) =>
			c.events.create({
				payload: [{ properties: {}, entityId: entity.id, eventSchemaId: backlogEventSchema.id }],
			}),
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(client, entity.id, 1);
		expect(events).toHaveLength(1);
		expect(events[0]?.eventSchemaSlug).toBe("backlog");

		const membership = await waitForInLibraryRelationship(client, entity.id, schema.slug);
		expect(membership.data.items).toHaveLength(1);
	});
});
