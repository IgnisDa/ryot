import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createEventSchema,
	createTracker,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("POST /event-schemas", () => {
	it("successfully creates an event schema for a custom entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		const data = await client.run((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "My Event",
					slug: "my-event",
					propertiesSchema: {
						fields: { note: { type: "string", label: "Note", description: "Note" } },
					},
				},
			}),
		);

		expect(data.name).toBe("My Event");
		expect(data.slug).toBe("my-event");
		expect(data.entitySchemaId).toBe(entitySchemaId);
	});

	it("returns 400 when event schema properties schema is invalid", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		const error = await client.runError((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "Invalid Event",
					slug: "invalid-event",
					propertiesSchema: {
						fields: { status: { type: "string", label: "Status", description: "Status" } },
						rules: [
							{
								path: ["missing"],
								kind: "validation",
								validation: { required: true },
								when: { operator: "eq", path: ["status"], value: "completed" },
							},
						],
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Rule path 'missing' does not exist");
	});

	it("returns 400 when event schema slug already exists for the same entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		await createEventSchema(client, {
			entitySchemaId,
			name: "First Event",
			slug: "duplicate-event-slug",
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		const error = await client.runError((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "Second Event",
					slug: "duplicate-event-slug",
					propertiesSchema: {
						fields: { note: { type: "string", label: "Note", description: "Note" } },
					},
				},
			}),
		);

		assertTaggedError(error, "Conflict");
		expect(error.message).toBe("Event schema slug already exists");
	});
});
