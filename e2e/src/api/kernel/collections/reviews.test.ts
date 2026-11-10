import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { collectionReviewsRecipe } from "@ryot-app/ryotql-recipes/collection-reviews";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createCollection } from "~/fixtures/kernel/collections";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live("pages multiple collection reviews and protects edits and account ownership", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { client: other } = yield* createAuthenticatedClient();
		const collection = yield* createCollection(client);
		const created = yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: collection.id,
						occurredAt: "2025-01-01T00:00:00Z",
						properties: { text: "Earlier thoughts" },
						eventSchemaSlug: EventSchemaSlug.make("review"),
					},
					{
						entityId: collection.id,
						occurredAt: "2025-02-01T00:00:00Z",
						eventSchemaSlug: EventSchemaSlug.make("review"),
						properties: { rating: 0, isSpoiler: true, text: "Later thoughts" },
					},
				],
			}),
		);
		expect(created.count).toBe(2);
		const first = yield* executeRyotQLRecipe(
			client,
			collectionReviewsRecipe({ limit: 1, collectionId: collection.id }),
		);
		const review = requirePresent(first.items[0], "Expected latest review");
		expect(review.properties).toEqual({ rating: 0, isSpoiler: true, text: "Later thoughts" });
		const after = requirePresent(first.pageInfo.nextCursor, "Expected another review page");
		const second = yield* executeRyotQLRecipe(
			client,
			collectionReviewsRecipe({ after, limit: 1, collectionId: collection.id }),
		);
		expect(second.items.map((row) => row.properties)).toEqual([{ text: "Earlier thoughts" }]);
		expect(second.pageInfo.hasMore).toBe(false);
		const hidden = yield* executeRyotQLRecipe(
			other,
			collectionReviewsRecipe({ collectionId: collection.id }),
		);
		expect(hidden.items).toEqual([]);
		const forbidden = yield* other.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: collection.id,
						properties: { text: "Forbidden" },
						eventSchemaSlug: EventSchemaSlug.make("review"),
					},
				],
			}),
		);
		expect(forbidden.count).toBe(0);
		assertTaggedError(
			yield* Effect.flip(other.call((c) => c.events.delete({ params: { eventId: review.id } }))),
			"EventNotFound",
		);
		assertTaggedError(
			yield* Effect.flip(
				other.call((c) =>
					c.events.update({
						params: { eventId: review.id },
						payload: { properties: { remove: [], set: { text: "Forbidden" } } },
					}),
				),
			),
			"EventNotFound",
		);
		const expected = {
			absentProperties: [],
			kind: "fields" as const,
			entityId: review.entityId,
			occurredAt: review.occurredAt,
			sessionEntityId: review.sessionEntityId,
			properties: { rating: 0, isSpoiler: true, text: "Later thoughts" },
		};
		yield* client.call((c) =>
			c.events.update({
				params: { eventId: review.id },
				payload: {
					expected,
					properties: { remove: ["rating"], set: { isSpoiler: false, text: "Revised thoughts" } },
				},
			}),
		);
		assertTaggedError(
			yield* Effect.flip(
				client.call((c) =>
					c.events.update({
						params: { eventId: review.id },
						payload: { expected, properties: { remove: [], set: { text: "Stale edit" } } },
					}),
				),
			),
			"EventStale",
		);
		const updated = yield* executeRyotQLRecipe(
			client,
			collectionReviewsRecipe({ collectionId: collection.id }),
		);
		expect(updated.items[0]?.properties).toEqual({ isSpoiler: false, text: "Revised thoughts" });
		expect(updated.items[0]?.occurredAt).toBe(review.occurredAt);
		yield* client.call((c) => c.events.delete({ params: { eventId: review.id } }));
		expect(
			(yield* executeRyotQLRecipe(
				client,
				collectionReviewsRecipe({ collectionId: collection.id }),
			)).items.map((row) => row.properties),
		).toEqual([{ text: "Earlier thoughts" }]);
	}),
);
