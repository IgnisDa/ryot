import type { RowsResult } from "@ryot/contract/modules/ryotql/language";
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
	executeRyotQLError,
	requireRows,
	requireRyotQLValue,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

const rowNames = (result: RowsResult) =>
	result.items.map((item) => requireRyotQLValue(item, "name"));

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
	it.live("traverses equal sort values sequentially with primary-key tie breaking", () =>
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
			const sortValue = castNumber(jsonPath(column(entity, "properties"), "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (after?: string, fields = true) =>
				rows(entity, {
					after,
					where,
					limit: 2,
					orderBy: [ascending(sortValue)],
					fields: fields
						? [field("id", column(entity, "id")), field("name", column(entity, "name"))]
						: [],
				});
			const page = (after?: string, fields = true) =>
				executeRyotQL(client, document({ entities: query(after, fields) }));

			const first = requireRows((yield* page()).data["entities"], "entities");
			expect(first.pageInfo).toMatchObject({ limit: 2, hasMore: true });
			expect(first.pageInfo.nextCursor).not.toBeNull();
			const second = requireRows(
				(yield* page(first.pageInfo.nextCursor ?? undefined)).data["entities"],
				"entities",
			);
			expect(second.pageInfo).toMatchObject({ limit: 2, hasMore: true });
			expect(second.pageInfo.nextCursor).not.toBeNull();
			const third = requireRows(
				(yield* page(second.pageInfo.nextCursor ?? undefined)).data["entities"],
				"entities",
			);
			expect(third.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
			expect([...rowNames(first), ...rowNames(second), ...rowNames(third)]).toEqual(
				sortById(entities).map((item) => item.name),
			);

			const emptyFields = requireRows((yield* page(undefined, false)).data["entities"], "entities");
			expect(emptyFields.pageInfo).toMatchObject({ limit: 2, hasMore: true });
			expect(emptyFields.pageInfo.nextCursor).not.toBeNull();
			expect(emptyFields.items).toEqual([{}, {}]);
		}),
	);

	it.live("keeps null sort values last across ascending and descending cursors", () =>
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
			const sortValue = castNumber(jsonPath(column(entity, "properties"), "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (order: ReturnType<typeof ascending>, after?: string) =>
				rows(entity, {
					after,
					where,
					limit: 2,
					orderBy: [order],
					fields: [field("name", column(entity, "name")), field("sortValue", sortValue)],
				});
			const first = yield* executeRyotQL(
				client,
				document({
					ascending: query(ascending(sortValue)),
					descending: query(descending(sortValue)),
				}),
			);
			const ascendingRows = requireRows(first.data["ascending"], "ascending");
			const descendingRows = requireRows(first.data["descending"], "descending");
			expect(rowNames(ascendingRows)).toEqual(["Low", "High"]);
			expect(rowNames(descendingRows)).toEqual(["High", "Low"]);
			expect(ascendingRows.pageInfo.nextCursor).not.toBeNull();
			expect(descendingRows.pageInfo.nextCursor).not.toBeNull();

			const next = yield* executeRyotQL(
				client,
				document({
					ascending: query(ascending(sortValue), ascendingRows.pageInfo.nextCursor ?? undefined),
					descending: query(descending(sortValue), descendingRows.pageInfo.nextCursor ?? undefined),
				}),
			);
			const nullNames = sortById([nullOne, nullTwo]).map((item) => item.name);
			const ascendingNulls = requireRows(next.data["ascending"], "ascending");
			const descendingNulls = requireRows(next.data["descending"], "descending");
			expect(rowNames(ascendingNulls)).toEqual(nullNames);
			expect(rowNames(descendingNulls)).toEqual(nullNames);
			expect(ascendingNulls.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
			expect(descendingNulls.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
		}),
	);

	it.live("rejects malformed and query-incompatible cursors", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchema(client, "RyotQLPaginationInvalidCursor");
			yield* Effect.all(
				["First", "Second", "Third"].map((name) =>
					createEntityFixture(client, { name, entitySchemaSlug: schemaId }),
				),
			);

			const entity = table("entity", "entity");
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (after?: string, order = ascending(column(entity, "name"))) =>
				document({
					entities: rows(entity, {
						after,
						where,
						limit: 1,
						orderBy: [order],
						fields: [field("name", column(entity, "name"))],
					}),
				});
			const first = requireRows(
				(yield* executeRyotQL(client, query())).data["entities"],
				"entities",
			);
			const cursor = first.pageInfo.nextCursor;
			expect(cursor).not.toBeNull();

			const malformed = yield* executeRyotQLError(client, query("not-a-cursor"));
			expect(malformed).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { code: "invalid-cursor" },
			});
			const incompatible = yield* executeRyotQLError(
				client,
				query(cursor ?? "", descending(column(entity, "name"))),
			);
			expect(incompatible).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { code: "invalid-cursor" },
			});
		}),
	);
});
