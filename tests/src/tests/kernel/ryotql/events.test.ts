import type { RowsResult } from "@ryot/contract/modules/ryotql/language";
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
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEnginePluginSchema,
	executeRyotQL,
	type Client,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (result: RowsResult | undefined, name: string) => {
	if (!result) {
		throw new Error(`Expected '${name}' rows`);
	}
	return result;
};

const createFixture = (client: Client, name: string) =>
	Effect.gen(function* () {
		const { schemaId, slug: entitySchemaSlug } = yield* createQueryEnginePluginSchema(client, {
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
		const entity = yield* createQueryEngineEntity(client, {
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
			yield* createQueryEngineEvent(client, {
				entityId: first.entity.id,
				properties: { rating: 3 },
				occurredAt: "2026-07-01T00:00:00.000Z",
				eventSchemaSlug: first.eventSchemaSlug,
			});
			yield* createQueryEngineEvent(client, {
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
			expect(events.items.map((item) => item["entityName"]?.value)).toEqual([
				"RyotQLEventBook Entity",
				"RyotQLEventMovie Entity",
			]);
			expect(events.items[0]).toMatchObject({
				createdAt: { kind: "date" },
				updatedAt: { kind: "date" },
				rating: { kind: "number", value: 5 },
				sessionEntityId: { kind: "null", value: null },
				occurredAt: { kind: "date", value: "2026-08-01T00:00:00.000Z" },
			});
		}),
	);

	it.live("filters, numerically orders, and paginates event properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* createFixture(client, "RyotQLEventPagination");
			for (const rating of [1, 2, 3, 4, 5]) {
				yield* createQueryEngineEvent(client, {
					properties: { rating },
					entityId: fixture.entity.id,
					eventSchemaSlug: fixture.eventSchemaSlug,
				});
			}

			const event = table("event", "event");
			const rating = castNumber(jsonPath(column(event, "properties"), "rating"));
			const page = (pageNumber: number) =>
				rows(event, {
					limit: 2,
					page: pageNumber,
					orderBy: [descending(rating)],
					fields: [field("rating", rating)],
					where: and(
						eq(column(event, "eventSchemaSlug"), literal(fixture.eventSchemaSlug)),
						gte(rating, literal(3)),
					),
				});
			const result = yield* executeRyotQL(
				client,
				document({ firstPage: page(1), secondPage: page(2) }),
			);

			const firstPage = requireRows(result.data["firstPage"], "firstPage");
			const secondPage = requireRows(result.data["secondPage"], "secondPage");
			expect(firstPage.pageInfo).toEqual({ page: 1, limit: 2, total: 3, hasMore: true });
			expect(firstPage.items.map((item) => item["rating"]?.value)).toEqual([5, 4]);
			expect(secondPage.pageInfo).toEqual({ page: 2, limit: 2, total: 3, hasMore: false });
			expect(secondPage.items.map((item) => item["rating"]?.value)).toEqual([3]);
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
			yield* createQueryEngineEvent(client, {
				entityId: own.entity.id,
				eventSchemaSlug: own.eventSchemaSlug,
			});
			yield* createQueryEngineEvent(otherClient, {
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
			expect(visibleEvents.items.map((item) => item["eventSchemaSlug"]?.value)).toEqual([
				own.eventSchemaSlug,
			]);
			const crafted = requireRows(result.data["craftedJoin"], "craftedJoin").items[0];
			assertPresent(crafted, "Expected the caller's event row");
			expect(crafted["hiddenName"]).toEqual({ kind: "null", value: null });
		}),
	);
});
