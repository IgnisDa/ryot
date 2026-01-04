import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createGlobalBookEntityFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForEventCount,
	waitForInLibraryRelationship,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /events with global entities", () => {
	it.live("creates the event and upserts in_library for the user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(client);

			const eventSchemas = yield* listEventSchemas(client, schema.id);
			const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlogEventSchema.id },
					],
				}),
			);

			expect(createResult.count).toBe(1);

			const events = yield* waitForEventCount(client, entity.id, 1);
			expect(events).toHaveLength(1);
			expect(events[0]?.eventSchemaSlug).toBe("backlog");

			const membership = yield* waitForInLibraryRelationship(client, entity.id, schema.slug);
			expect(membership.data.items).toHaveLength(1);
		}),
	);
});
