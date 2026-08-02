import type { RowsResult, RyotQLResult } from "@ryot/contract/modules/ryotql/language";
import {
	ascending,
	castNumber,
	column,
	descending,
	document,
	eq,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	requireRyotQLFieldValue,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (result: RyotQLResult | undefined, name: string): RowsResult => {
	if (result?.type !== "rows") {
		throw new Error(`Expected '${name}' rows`);
	}
	return result;
};

const rowNames = (result: RowsResult) =>
	result.items.map((item) => requireRyotQLFieldValue(item, "name").value);

const sortById = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((left, right) => {
		if (left.id < right.id) {
			return -1;
		}
		if (left.id > right.id) {
			return 1;
		}
		return 0;
	});

const createSchema = (client: Parameters<typeof createPluginEntitySchema>[0], name: string) =>
	createPluginEntitySchema(client, {
		schemaName: name,
		propertiesSchema: {
			unknownKeys: "passthrough",
			fields: {
				sortValue: { type: "integer", label: "Sort Value", description: "Sort Value" },
			},
		},
	});

describe("RyotQL row pagination", () => {
	it.live("stitches equal sort values across pages with primary-key tie breaking", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchema(client, "RyotQLPaginationTies");
			const entities = yield* Effect.all(
				["Tie One", "Tie Two", "Tie Three", "Tie Four", "Tie Five"].map((name) =>
					createEntityFixture(client, {
						name,
						entitySchemaSlug: schemaId,
						properties: { sortValue: 1 },
					}),
				),
			);

			const entity = table("entity", "entity");
			const properties = column(entity, "properties");
			const sortValue = castNumber(jsonPath(properties, "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const page = (pageNumber: number) =>
				rows(entity, {
					where,
					limit: 2,
					page: pageNumber,
					orderBy: [ascending(sortValue)],
					fields: [field("id", column(entity, "id")), field("name", column(entity, "name"))],
				});
			const result = yield* executeRyotQL(
				client,
				document({
					firstPage: page(1),
					secondPage: page(2),
					thirdPage: page(3),
					emptyFields: rows(entity, {
						where,
						limit: 2,
						fields: [],
						orderBy: [ascending(sortValue)],
					}),
				}),
			);

			const firstPage = requireRows(result.data["firstPage"], "firstPage");
			const secondPage = requireRows(result.data["secondPage"], "secondPage");
			const thirdPage = requireRows(result.data["thirdPage"], "thirdPage");
			const expectedNames = sortById(entities).map((item) => item.name);
			expect(firstPage.pageInfo).toEqual({ page: 1, limit: 2, total: 5, hasMore: true });
			expect(secondPage.pageInfo).toEqual({ page: 2, limit: 2, total: 5, hasMore: true });
			expect(thirdPage.pageInfo).toEqual({ page: 3, limit: 2, total: 5, hasMore: false });
			expect([...rowNames(firstPage), ...rowNames(secondPage), ...rowNames(thirdPage)]).toEqual(
				expectedNames,
			);
			const emptyFields = requireRows(result.data["emptyFields"], "emptyFields");
			expect(emptyFields.pageInfo).toEqual({ page: 1, limit: 2, total: 5, hasMore: true });
			expect(emptyFields.items).toEqual([{}, {}]);
		}),
	);

	it.live("keeps null sort values last for ascending and descending pages", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchema(client, "RyotQLPaginationNulls");
			const [, , nullOne, nullTwo] = yield* Effect.all([
				createEntityFixture(client, {
					name: "Low",
					entitySchemaSlug: schemaId,
					properties: { sortValue: 1 },
				}),
				createEntityFixture(client, {
					name: "High",
					entitySchemaSlug: schemaId,
					properties: { sortValue: 2 },
				}),
				createEntityFixture(client, { name: "Null One", entitySchemaSlug: schemaId }),
				createEntityFixture(client, { name: "Null Two", entitySchemaSlug: schemaId }),
			]);

			const entity = table("entity", "entity");
			const properties = column(entity, "properties");
			const sortValue = castNumber(jsonPath(properties, "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (order: ReturnType<typeof ascending>) =>
				rows(entity, {
					where,
					limit: 2,
					orderBy: [order],
					fields: [field("name", column(entity, "name")), field("sortValue", sortValue)],
				});
			const result = yield* executeRyotQL(
				client,
				document({
					ascending: query(ascending(sortValue)),
					descending: query(descending(sortValue)),
				}),
			);

			const ascendingRows = requireRows(result.data["ascending"], "ascending");
			const descendingRows = requireRows(result.data["descending"], "descending");
			expect(rowNames(ascendingRows)).toEqual(["Low", "High"]);
			expect(rowNames(descendingRows)).toEqual(["High", "Low"]);
			expect(ascendingRows.pageInfo).toEqual({ page: 1, limit: 2, total: 4, hasMore: true });
			expect(descendingRows.pageInfo).toEqual({ page: 1, limit: 2, total: 4, hasMore: true });

			const nullNames = sortById([nullOne, nullTwo]).map((item) => item.name);
			const nullPage = yield* executeRyotQL(
				client,
				document({
					ascending: rows(entity, {
						where,
						page: 2,
						limit: 2,
						orderBy: [ascending(sortValue)],
						fields: [field("name", column(entity, "name"))],
					}),
					descending: rows(entity, {
						where,
						page: 2,
						limit: 2,
						orderBy: [descending(sortValue)],
						fields: [field("name", column(entity, "name"))],
					}),
				}),
			);
			const ascendingNullPage = requireRows(nullPage.data["ascending"], "ascending");
			const descendingNullPage = requireRows(nullPage.data["descending"], "descending");
			expect(rowNames(ascendingNullPage)).toEqual(nullNames);
			expect(rowNames(descendingNullPage)).toEqual(nullNames);
			expect(ascendingNullPage.pageInfo).toEqual({ page: 2, limit: 2, total: 4, hasMore: false });
			expect(descendingNullPage.pageInfo).toEqual({ page: 2, limit: 2, total: 4, hasMore: false });
		}),
	);

	it.live("preserves totals and hasMore on pages beyond the final row", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchema(client, "RyotQLPaginationFinalPage");
			yield* Effect.all(
				["First", "Second", "Third"].map((name) =>
					createEntityFixture(client, { name, entitySchemaSlug: schemaId }),
				),
			);

			const entity = table("entity", "entity");
			const result = yield* executeRyotQL(
				client,
				document({
					lastRow: rows(entity, {
						page: 2,
						limit: 2,
						where: eq(column(entity, "entitySchemaSlug"), literal(schemaId)),
						fields: [field("name", column(entity, "name"))],
					}),
					beyondFinalRow: rows(entity, {
						page: 3,
						limit: 2,
						where: eq(column(entity, "entitySchemaSlug"), literal(schemaId)),
						fields: [field("name", column(entity, "name"))],
					}),
				}),
			);

			expect(requireRows(result.data["lastRow"], "lastRow").pageInfo).toEqual({
				page: 2,
				limit: 2,
				total: 3,
				hasMore: false,
			});
			expect(requireRows(result.data["beyondFinalRow"], "beyondFinalRow")).toEqual({
				items: [],
				type: "rows",
				pageInfo: { page: 3, limit: 2, total: 3, hasMore: false },
			});
		}),
	);
});
