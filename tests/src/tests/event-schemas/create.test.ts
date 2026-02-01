import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createEventSchema,
	createTracker,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /event-schemas", () => {
	it.live("successfully creates an event schema for a custom entity schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, {
				name: "Event Schema Tracker",
			});
			const { schemaId: entitySchemaId } = yield* createEntitySchema(client, {
				trackerId,
				name: "Custom Entity",
				slug: "custom-entity",
			});

			const data = yield* client.call((c) =>
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
		}),
	);

	it.live("returns 400 when event schema properties schema is invalid", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, {
				name: "Event Schema Tracker",
			});
			const { schemaId: entitySchemaId } = yield* createEntitySchema(client, {
				trackerId,
				name: "Custom Entity",
				slug: "custom-entity",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Rule path 'missing' does not exist");
		}),
	);

	it.live("returns 400 when event schema slug already exists for the same entity schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, {
				name: "Event Schema Tracker",
			});
			const { schemaId: entitySchemaId } = yield* createEntitySchema(client, {
				trackerId,
				name: "Custom Entity",
				slug: "custom-entity",
			});

			yield* createEventSchema(client, {
				entitySchemaId,
				name: "First Event",
				slug: "duplicate-event-slug",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(error, "Conflict");
			expect(error.message).toBe("Event schema slug already exists");
		}),
	);
});
