import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createGlobalBookEntityFixture,
	listEventSchemas,
	queryInLibraryRelationship,
	requireEventSchemaBySlug,
	waitForEventCount,
} from "../fixtures";

describe("POST /events with global entities", () => {
	it("creates the event and upserts in_library for the user", async () => {
		const { client, cookies, email } = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(client, cookies);

		const eventSchemas = await listEventSchemas(client, cookies, schema.id);
		const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");

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

		const membership = await queryInLibraryRelationship(entity.id, email);
		expect(membership.rowCount).toBe(1);
	});
});
