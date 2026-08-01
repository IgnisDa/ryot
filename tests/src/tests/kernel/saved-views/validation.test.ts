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
			const body = withGridLayout(rowsDocument, { entityIdField: "missing" });

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				field: "missing",
				layout: "grid",
				code: "invalid-definition",
				issue: "mapping-field-missing",
			});
		}),
	);

	it.live("rejects a non-text item ID field", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const queryDocument = document({
				savedView: rows(book, {
					limit: 2,
					fields: [
						field("entityId", column(book, "id")),
						field("numericId", literal(1)),
						...rowsFields.slice(1),
					],
				}),
			});
			const body = withGridLayout(queryDocument, { entityIdField: "numericId" });

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				issue: "field-kind",
				field: "entityIdField",
				code: "invalid-definition",
			});
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

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				issue: "query-count",
				code: "invalid-definition",
			});
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

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				issue: "output-kind",
				code: "invalid-definition",
			});
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

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				code: "invalid-definition",
				issue: "explicit-fields-required",
			});
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

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				issue: "nested-results",
				code: "invalid-definition",
			});
		}),
	);

	it.live("rejects a stored query cursor", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = withGridLayout(
				document({
					savedView: rows(book, {
						after: "persisted-cursor",
						fields: rowsFields,
					}),
				}),
			);

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				layout: "grid",
				code: "invalid-definition",
				issue: "cursor-pagination",
			});
		}),
	);
});
