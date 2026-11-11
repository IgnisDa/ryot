import type { RowsResult } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	ascending,
	castNumber,
	column,
	contains,
	descending,
	document,
	eq,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
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
import type { RyotQLPayload } from "~/fixtures/kernel/ryotql";
import { requirePresent } from "~/support/assertions";
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
			fields: { sortValue: { type: "integer", label: "Sort Value", description: "Sort Value" } },
		},
	});

describe("RyotQL row pagination", () => {
	it.live("traverses equal sort values sequentially with primary-key tie breaking", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, reference } = yield* createSchema(client, "RyotQLPaginationTies");
			const entities = yield* Effect.forEach(
				["Tie One", "Tie Two", "Tie Three", "Tie Four", "Tie Five"],
				(name) =>
					createEntityFixture(client, {
						name,
						entitySchema: reference,
						properties: { sortValue: 1 },
					}),
			);

			const entity = table("entity", "entity");
			const sortValue = castNumber(jsonPath(column(entity, "properties"), "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (fields = true) =>
				rows(entity, {
					where,
					limit: 2,
					orderBy: [ascending(sortValue)],
					fields: fields
						? [field("id", column(entity, "id")), field("name", column(entity, "name"))]
						: [],
				});
			const page = (after?: string, fields = true) =>
				executeRyotQL(client, {
					pages: { entities: { after } },
					source: { kind: "inline", document: document({ entities: query(fields) }) },
				});

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
			const { schemaId, reference } = yield* createSchema(client, "RyotQLPaginationNulls");
			const [, , nullOne, nullTwo] = yield* Effect.all([
				createEntityFixture(client, {
					name: "Low",
					entitySchema: reference,
					properties: { sortValue: 1 },
				}),
				createEntityFixture(client, {
					name: "High",
					entitySchema: reference,
					properties: { sortValue: 2 },
				}),
				createEntityFixture(client, { name: "Null One", entitySchema: reference }),
				createEntityFixture(client, { name: "Null Two", entitySchema: reference }),
			]);

			const entity = table("entity", "entity");
			const sortValue = castNumber(jsonPath(column(entity, "properties"), "sortValue"));
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (order: ReturnType<typeof ascending>) =>
				rows(entity, {
					where,
					limit: 2,
					orderBy: [order],
					fields: [field("name", column(entity, "name")), field("sortValue", sortValue)],
				});
			const first = yield* executeRyotQL(client, {
				source: {
					kind: "inline",
					document: document({
						ascending: query(ascending(sortValue)),
						descending: query(descending(sortValue)),
					}),
				},
			});
			const ascendingRows = requireRows(first.data["ascending"], "ascending");
			const descendingRows = requireRows(first.data["descending"], "descending");
			expect(rowNames(ascendingRows)).toEqual(["Low", "High"]);
			expect(rowNames(descendingRows)).toEqual(["High", "Low"]);
			expect(ascendingRows.pageInfo.nextCursor).not.toBeNull();
			expect(descendingRows.pageInfo.nextCursor).not.toBeNull();

			const next = yield* executeRyotQL(client, {
				source: {
					kind: "inline",
					document: document({
						ascending: query(ascending(sortValue)),
						descending: query(descending(sortValue)),
					}),
				},
				pages: {
					ascending: { after: ascendingRows.pageInfo.nextCursor ?? undefined },
					descending: { after: descendingRows.pageInfo.nextCursor ?? undefined },
				},
			});
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
			const { schemaId, reference } = yield* createSchema(client, "RyotQLPaginationInvalidCursor");
			yield* Effect.forEach(["First", "Second", "Third"], (name) =>
				createEntityFixture(client, { name, entitySchema: reference }),
			);

			const entity = table("entity", "entity");
			const where = eq(column(entity, "entitySchemaSlug"), literal(schemaId));
			const query = (order = ascending(column(entity, "name"))) =>
				document({
					entities: rows(entity, {
						where,
						limit: 1,
						orderBy: [order],
						fields: [field("name", column(entity, "name"))],
					}),
				});
			const first = requireRows(
				(yield* executeRyotQL(client, { source: { kind: "inline", document: query() } })).data[
					"entities"
				],
				"entities",
			);
			const cursor = first.pageInfo.nextCursor;
			expect(cursor).not.toBeNull();

			const malformed = yield* executeRyotQLError(client, {
				source: { kind: "inline", document: query() },
				pages: { entities: { after: "not-a-cursor" } },
			});
			expect(malformed).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { code: "invalid-cursor" },
			});
			const incompatible = yield* executeRyotQLError(client, {
				pages: { entities: { after: cursor ?? "" } },
				source: { kind: "inline", document: query(descending(column(entity, "name"))) },
			});
			expect(incompatible).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { code: "invalid-cursor" },
			});
		}),
	);
	it.live("binds typed arguments and fences cursors by their normalized values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, reference } = yield* createSchema(client, "RyotQLParameterCursor");
			yield* Effect.forEach(["Alpha One", "Alpha Two", "Beta One"], (name) =>
				createEntityFixture(client, { name, entitySchema: reference }),
			);
			const entity = table("entity", "entity");
			const input = parameters({
				fields: {
					prefix: {
						type: "string",
						label: "Prefix",
						defaultValue: "Alpha",
						description: "Name prefix",
					},
				},
			});
			const source = {
				kind: "inline" as const,
				document: {
					...document({
						entities: rows(entity, {
							limit: 1,
							maxLimit: 2,
							orderBy: [ascending(column(entity, "name"))],
							fields: [field("name", column(entity, "name"))],
							where: and(
								eq(column(entity, "entitySchemaSlug"), literal(schemaId)),
								contains(column(entity, "name"), input.value("prefix")),
							),
						}),
					}),
					parameters: input.schema,
				},
			};
			const first = requireRows(
				(yield* executeRyotQL(client, { source })).data.entities,
				"entities",
			);
			expect(rowNames(first)).toEqual(["Alpha One"]);
			const after = requirePresent(
				first.pageInfo.nextCursor,
				"Expected a parameterized query cursor",
			);
			const second = requireRows(
				(yield* executeRyotQL(client, {
					source,
					arguments: { prefix: "Alpha" },
					pages: { entities: { after } },
				})).data.entities,
				"entities",
			);
			expect(rowNames(second)).toEqual(["Alpha Two"]);
			expect(second.pageInfo.hasMore).toBe(false);
			const changed = yield* executeRyotQLError(client, {
				source,
				arguments: { prefix: "Beta" },
				pages: { entities: { after } },
			});
			expect(changed).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { code: "invalid-cursor" },
			});
			const invalidArguments: NonNullable<RyotQLPayload["arguments"]>[] = [
				{ prefix: 1 },
				{ unknown: "Alpha" },
			];
			for (const argumentValues of invalidArguments) {
				const invalid = yield* executeRyotQLError(client, { source, arguments: argumentValues });
				expect(invalid).toMatchObject({
					_tag: "RyotQLBadRequest",
					reason: { code: "invalid-query" },
				});
			}
		}),
	);
});
