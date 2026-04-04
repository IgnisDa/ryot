import {
	aggregate,
	ascending,
	column,
	document,
	field,
	include,
	literal,
	rows,
	star,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewBody,
	buildSavedViewLayouts,
	createAuthenticatedClient,
	rowsDocument,
	rowsFields,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const book = table("entity", "entity");
const child = table("entity", "child");
const withGridLayout = (
	queryDocument = rowsDocument,
	overrides: Partial<ReturnType<typeof buildSavedViewLayouts>["grid"]> = {},
) => {
	const layouts = buildSavedViewLayouts({ grid: queryDocument });
	return buildSavedViewBody({ layouts: { ...layouts, grid: { ...layouts.grid, ...overrides } } });
};

describe("saved views validation", () => {
	it.live("rejects a display field that is missing from the root projection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(rowsDocument, { itemIdField: "missing" });

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				"Grid layout: mapping field 'missing' is not in its root projection",
			);
		}),
	);

	it.live("rejects a non-text item ID field", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const queryDocument = document({
				savedView: rows(book, {
					page: 1,
					limit: 2,
					fields: [
						field("itemId", column(book, "id")),
						field("numericId", literal(1)),
						...rowsFields.slice(1),
					],
				}),
			});
			const body = withGridLayout(queryDocument, { itemIdField: "numericId" });

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: itemIdField must resolve to text");
		}),
	);

	it.live("rejects a document with multiple named queries", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					...rowsDocument.queries,
					other: rows(book, {
						fields: rowsFields,
					}),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: must contain exactly one named query");
		}),
	);

	it.live("rejects a non-rows query", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					savedView: aggregate(book, {
						measures: [{ key: "total", aggregation: { function: "count" } }],
					}),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: query must have rows output");
		}),
	);

	it.live("rejects a wildcard projection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					savedView: rows(book, { fields: [star(book)] }),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: query must use explicit field selections");
		}),
	);

	it.live("rejects a query with nested includes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					savedView: rows(book, {
						fields: rowsFields,
						include: [
							include(child, {
								key: "children",
								limit: 1,
								fields: [],
								orderBy: [ascending(column(child, "id"))],
							}),
						],
					}),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: query must not include nested results");
		}),
	);

	it.live("rejects a stored query page other than page one", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					savedView: rows(book, {
						page: 2,
						fields: rowsFields,
					}),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Grid layout: query pagination page must be 1");
		}),
	);
});
