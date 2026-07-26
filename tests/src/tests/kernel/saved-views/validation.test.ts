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
	createAuthenticatedClient,
	rowsDocument,
	rowsFields,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const book = table("entity", "entity");
const child = table("entity", "child");
const defaultBody = () => buildSavedViewBody({ queryDocument: rowsDocument });

describe("saved views validation", () => {
	it.live("rejects a display field that is missing from the root projection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				displayConfiguration: {
					...defaultBody().displayConfiguration,
					entityIdField: "missing",
				},
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				"Saved view display field 'missing' is not in the root projection",
			);
		}),
	);

	it.live("rejects a non-text entityId field", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const queryDocument = document({
				savedView: rows(book, {
					page: 1,
					limit: 2,
					fields: [
						field("entityId", column(book, "id")),
						field("numericId", literal(1)),
						...rowsFields.slice(1),
					],
				}),
			});
			const body = buildSavedViewBody({
				queryDocument,
				displayConfiguration: {
					...defaultBody().displayConfiguration,
					entityIdField: "numericId",
				},
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view entityIdField must resolve to text");
		}),
	);

	it.live("rejects a document with multiple named queries", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				queryDocument: document({
					...rowsDocument.queries,
					other: rows(book, {
						fields: rowsFields,
					}),
				}),
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("A saved view must contain exactly one named query");
		}),
	);

	it.live("rejects a non-rows query", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				queryDocument: document({
					savedView: aggregate(book, {
						measures: [{ key: "total", aggregation: { function: "count" } }],
					}),
				}),
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view query must have rows output");
		}),
	);

	it.live("rejects a wildcard projection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				queryDocument: document({
					savedView: rows(book, { fields: [star(book)] }),
				}),
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view query must use explicit field selections");
		}),
	);

	it.live("rejects a query with nested includes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				queryDocument: document({
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
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view query must not include nested results");
		}),
	);

	it.live("rejects a stored query page other than page one", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const body = buildSavedViewBody({
				queryDocument: document({
					savedView: rows(book, {
						page: 2,
						fields: rowsFields,
					}),
				}),
			});

			const error = yield* Effect.flip(client.call((c) => c.savedViews.create({ payload: body })));

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view query pagination page must be 1");
		}),
	);
});
