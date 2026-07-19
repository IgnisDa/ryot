import {
	and,
	castNumber,
	column,
	descending,
	document,
	eq,
	field,
	gte,
	inArray,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventSchema,
	createEntityFixture,
	createEventFixture,
	createPluginEntitySchema,
	executeRyotQL,
	requireRows,
	requireRyotQLValue,
	type Client,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const createFixture = (client: Client, name: string) =>
	Effect.gen(function* () {
		const { schemaId, slug: entitySchemaSlug } = yield* createPluginEntitySchema(client, {
			schemaName: name,
		});
		const eventSchema = yield* createEventSchema(client, {
			name: `${name} Review`,
			entitySchemaSlug: schemaId,
			slug: `${name.toLowerCase()}-review-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entity = yield* createEntityFixture(client, {
			name: `${name} Entity`,
			entitySchemaSlug: schemaId,
		});
		return { entity, entitySchemaSlug, eventSchemaSlug: eventSchema.slug };
	});

describe("RyotQL event queries", () => {
	it.live("queries event roots and attached entities through ordinary discriminator filters", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const first = yield* createFixture(client, "RyotQLEventBook");
			const second = yield* createFixture(client, "RyotQLEventMovie");
			yield* createEventFixture(client, {
				entityId: first.entity.id,
				properties: { rating: 3 },
				occurredAt: "2026-07-01T00:00:00.000Z",
				eventSchemaSlug: first.eventSchemaSlug,
			});
			yield* createEventFixture(client, {
				properties: { rating: 5 },
				entityId: second.entity.id,
				occurredAt: "2026-08-01T00:00:00.000Z",
				eventSchemaSlug: second.eventSchemaSlug,
			});

			const event = table("event", "event");
			const entity = table("entity", "entity");
			const result = yield* executeRyotQL(
				client,
				document({
					events: rows(event, {
						orderBy: [descending(column(event, "occurredAt"))],
						joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
						fields: [
							field("createdAt", column(event, "createdAt")),
							field("updatedAt", column(event, "updatedAt")),
							field("occurredAt", column(event, "occurredAt")),
							field("sessionEntityId", column(event, "sessionEntityId")),
							field("eventSchemaSlug", column(event, "eventSchemaSlug")),
							field("entityName", column(entity, "name")),
							field("rating", jsonPath(column(event, "properties"), "rating")),
						],
						where: and(
							inArray(column(event, "eventSchemaSlug"), [
								literal(first.eventSchemaSlug),
								literal(second.eventSchemaSlug),
							]),
							inArray(column(entity, "entitySchemaSlug"), [
								literal(first.entitySchemaSlug),
								literal(second.entitySchemaSlug),
							]),
						),
					}),
				}),
			);

			const events = requireRows(result.data["events"], "events");
			expect(events.items).toHaveLength(2);
			expect(events.items.map((item) => requireRyotQLValue(item, "entityName"))).toEqual([
				"RyotQLEventMovie Entity",
				"RyotQLEventBook Entity",
			]);
			expect(events.items[0]).toMatchObject({
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
				rating: 5,
				sessionEntityId: null,
				occurredAt: "2026-08-01T00:00:00.000Z",
			});
		}),
	);

	it.live("filters, numerically orders, and paginates event properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* createFixture(client, "RyotQLEventPagination");
			for (const rating of [1, 2, 3, 4, 5]) {
				yield* createEventFixture(client, {
					properties: { rating },
					entityId: fixture.entity.id,
					eventSchemaSlug: fixture.eventSchemaSlug,
				});
			}

			const event = table("event", "event");
			const rating = castNumber(jsonPath(column(event, "properties"), "rating"));
			const page = (after?: string) =>
				rows(event, {
					limit: 2,
					after,
					orderBy: [descending(rating)],
					fields: [field("rating", rating)],
					where: and(
						eq(column(event, "eventSchemaSlug"), literal(fixture.eventSchemaSlug)),
						gte(rating, literal(3)),
					),
				});
			const result = yield* executeRyotQL(client, document({ events: page() }));

			const firstPage = requireRows(result.data["events"], "events");
			expect(firstPage.pageInfo).toMatchObject({ limit: 2, hasMore: true });
			expect(firstPage.pageInfo.nextCursor).not.toBeNull();
			expect(firstPage.items.map((item) => requireRyotQLValue(item, "rating"))).toEqual([5, 4]);
			const next = yield* executeRyotQL(
				client,
				document({ events: page(firstPage.pageInfo.nextCursor ?? undefined) }),
			);
			const secondPage = requireRows(next.data["events"], "events");
			expect(secondPage.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
			expect(secondPage.items.map((item) => requireRyotQLValue(item, "rating"))).toEqual([3]);
		}),
	);

	it.live("applies event and joined entity visibility before caller predicates", () =>
		Effect.gen(function* () {
			const [{ client }, { client: otherClient }] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const own = yield* createFixture(client, "RyotQLEventOwner");
			const other = yield* createFixture(otherClient, "RyotQLEventOther");
			yield* createEventFixture(client, {
				entityId: own.entity.id,
				eventSchemaSlug: own.eventSchemaSlug,
			});
			yield* createEventFixture(otherClient, {
				entityId: other.entity.id,
				eventSchemaSlug: other.eventSchemaSlug,
			});

			const event = table("event", "event");
			const craftedEvent = table("event", "craftedEvent");
			const hiddenEntity = table("entity", "hiddenEntity");
			const result = yield* executeRyotQL(
				client,
				document({
					visibleEvents: rows(event, {
						fields: [field("eventSchemaSlug", column(event, "eventSchemaSlug"))],
						where: inArray(column(event, "eventSchemaSlug"), [
							literal(own.eventSchemaSlug),
							literal(other.eventSchemaSlug),
						]),
					}),
					craftedJoin: rows(craftedEvent, {
						fields: [field("hiddenName", column(hiddenEntity, "name"))],
						where: eq(column(craftedEvent, "entityId"), literal(own.entity.id)),
						joins: [
							join("left", hiddenEntity, eq(column(hiddenEntity, "id"), literal(other.entity.id))),
						],
					}),
				}),
			);

			const visibleEvents = requireRows(result.data["visibleEvents"], "visibleEvents");
			expect(
				visibleEvents.items.map((item) => requireRyotQLValue(item, "eventSchemaSlug")),
			).toEqual([own.eventSchemaSlug]);
			const crafted = requireRows(result.data["craftedJoin"], "craftedJoin").items[0];
			assertPresent(crafted, "Expected the caller's event row");
			expect(crafted["hiddenName"]).toBeNull();
		}),
	);
});
