import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	document,
	eq,
	field,
	gt,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	requireRows,
	requireRyotQLValue,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

const NOW = "2026-09-01T00:00:00.000Z";

const schedule = (entries: readonly { episode: number; airingAt: string }[]) => ({
	airingSchedule: entries,
});

describe("RyotQL JSON array operators", () => {
	it.live("filters, projects, counts, orders, and paginates array items", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schema = yield* createPluginEntitySchema(client, {
				schemaName: "RyotQLJsonArray",
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
			});
			yield* Effect.all([
				createEntityFixture(client, {
					name: "Show Early",
					entitySchemaSlug: schema.schemaId,
					properties: schedule([
						{ episode: 1, airingAt: "2026-08-01T00:00:00.000Z" },
						{ episode: 2, airingAt: "2026-09-05T00:00:00.000Z" },
						{ episode: 3, airingAt: "2026-09-20T00:00:00.000Z" },
					]),
				}),
				createEntityFixture(client, {
					name: "Show First",
					entitySchemaSlug: schema.schemaId,
					properties: schedule([{ episode: 1, airingAt: "2026-09-02T00:00:00.000Z" }]),
				}),
				createEntityFixture(client, {
					name: "Show Past",
					entitySchemaSlug: schema.schemaId,
					properties: schedule([{ episode: 1, airingAt: "2026-08-01T00:00:00.000Z" }]),
				}),
				createEntityFixture(client, {
					name: "Show Empty",
					properties: schedule([]),
					entitySchemaSlug: schema.schemaId,
				}),
				createEntityFixture(client, {
					properties: {},
					name: "Show Missing",
					entitySchemaSlug: schema.schemaId,
				}),
				createEntityFixture(client, {
					name: "Show Broken",
					entitySchemaSlug: schema.schemaId,
					properties: { airingSchedule: "not-an-array" },
				}),
				createEntityFixture(client, {
					name: "Show Malformed",
					entitySchemaSlug: schema.schemaId,
					properties: schedule([
						{ episode: 1, airingAt: "not-a-date" },
						{ episode: 2, airingAt: "2026-09-10T00:00:00.000Z" },
					]),
				}),
			]);

			const entity = table("entity", "entity");
			const properties = column(entity, "properties");
			const array = jsonPath(properties, "airingSchedule");
			const airingAt = castDate(jsonPath(jsonElement(), "airingAt"));
			const episode = castNumber(jsonPath(jsonElement(), "episode"));
			const upcoming = gt(airingAt, castDate(literal(NOW)));
			const nextAiringAt = jsonArrayFirst(array, {
				where: upcoming,
				select: airingAt,
				orderBy: [ascending(airingAt)],
			});
			const upcomingFilter = and(
				eq(column(entity, "entitySchemaSlug"), literal(schema.slug)),
				jsonArrayExists(array, upcoming),
			);
			const result = yield* executeRyotQL(
				client,
				document({
					paged: rows(entity, {
						limit: 1,
						where: upcomingFilter,
						orderBy: [ascending(nextAiringAt)],
						fields: [field("name", column(entity, "name"))],
					}),
					counts: rows(entity, {
						orderBy: [ascending(column(entity, "name"))],
						where: eq(column(entity, "entitySchemaSlug"), literal(schema.slug)),
						fields: [
							field("name", column(entity, "name")),
							field("upcomingCount", jsonArrayCount(array, upcoming)),
							field("totalCount", jsonArrayCount(array)),
						],
					}),
					upcoming: rows(entity, {
						where: upcomingFilter,
						orderBy: [ascending(nextAiringAt)],
						fields: [
							field("name", column(entity, "name")),
							field("nextAiringAt", nextAiringAt),
							field(
								"nextEpisode",
								jsonArrayFirst(array, {
									select: episode,
									where: upcoming,
									orderBy: [ascending(airingAt)],
								}),
							),
						],
					}),
				}),
			);

			expect(requireRows(result.data["upcoming"], "upcoming").items).toEqual([
				{ nextEpisode: 1, name: "Show First", nextAiringAt: "2026-09-02T00:00:00.000Z" },
				{ nextEpisode: 2, name: "Show Early", nextAiringAt: "2026-09-05T00:00:00.000Z" },
				{ nextEpisode: 2, name: "Show Malformed", nextAiringAt: "2026-09-10T00:00:00.000Z" },
			]);

			const counts = requireRows(result.data["counts"], "counts");
			expect(
				counts.items.map((item) => [
					requireRyotQLValue(item, "name"),
					requireRyotQLValue(item, "upcomingCount"),
					requireRyotQLValue(item, "totalCount"),
				]),
			).toEqual([
				["Show Broken", 0, 0],
				["Show Early", 2, 3],
				["Show Empty", 0, 0],
				["Show First", 1, 1],
				["Show Malformed", 1, 2],
				["Show Missing", 0, 0],
				["Show Past", 0, 1],
			]);

			const firstPage = requireRows(result.data["paged"], "paged");
			expect(firstPage.items.map((item) => requireRyotQLValue(item, "name"))).toEqual([
				"Show First",
			]);
			expect(firstPage.pageInfo.hasMore).toBe(true);
			expect(firstPage.pageInfo.nextCursor).toEqual(expect.any(String));

			const secondPage = yield* executeRyotQL(
				client,
				document({
					paged: rows(entity, {
						limit: 1,
						where: upcomingFilter,
						orderBy: [ascending(nextAiringAt)],
						fields: [field("name", column(entity, "name"))],
						after: firstPage.pageInfo.nextCursor ?? undefined,
					}),
				}),
			);
			const secondItems = requireRows(secondPage.data["paged"], "paged");
			expect(secondItems.items.map((item) => requireRyotQLValue(item, "name"))).toEqual([
				"Show Early",
			]);
			expect(secondItems.pageInfo.hasMore).toBe(true);
		}),
	);
});
