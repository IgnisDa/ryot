import { it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import {
	SavedViewBadRequest,
	type SavedViewLayouts,
} from "@ryot/contract/modules/saved-views/schemas";
import {
	ascending,
	castJson,
	column,
	document,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { validateSavedViewDefinition } from "./definition-validation";

const record = table("entity", "record");
const queryDocument = document({
	savedView: rows(record, {
		orderBy: [ascending(column(record, "name"))],
		fields: [
			field("id", column(record, "id")),
			field("name", column(record, "name")),
			field("image", castJson(jsonPath(column(record, "properties"), "images", 0))),
			field("imageUrl", jsonPath(column(record, "properties"), "images", 0, "url")),
			field("textId", literal("not-an-entity-id")),
			field("count", literal(1)),
		],
	}),
}) satisfies RyotQLDocument;

const cardLayout = {
	queryDocument,
	titleField: "name",
	callout: null,
	imageField: "image",
	entityIdField: "id",
	overline: null,
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;

const layouts = {
	grid: cardLayout,
	list: cardLayout,
	table: {
		queryDocument,
		imageField: "image",
		entityIdField: "id",
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;

it.effect("accepts three independently valid layouts", () =>
	validateSavedViewDefinition({ layouts }),
);

it.effect("prefixes validation failures with the layout name", () =>
	Effect.gen(function* () {
		const invalid = { ...layouts, list: { ...layouts.list, entityIdField: "count" } };
		const exit = yield* Effect.exit(validateSavedViewDefinition({ layouts: invalid }));

		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					layout: "list",
					issue: "field-kind",
					field: "entityIdField",
					code: "invalid-definition",
				},
			}),
		);
	}),
);

it.effect("requires the entity ID mapping to project an entity primary key", () => {
	const invalid = { ...layouts, grid: { ...layouts.grid, entityIdField: "textId" } };
	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: {
						layout: "grid",
						field: "entityIdField",
						issue: "entity-id-source",
						code: "invalid-definition",
					},
				}),
			),
		),
	);
});

it.effect("validates mappings against only their layout projection", () => {
	const tableDocument = document({
		savedView: rows(record, {
			fields: [field("id", column(record, "id")), field("tableName", column(record, "name"))],
		}),
	});
	const invalid = {
		...layouts,
		table: {
			...layouts.table,
			queryDocument: tableDocument,
			columns: [{ label: "Name", field: "name", displayKind: "text" }],
		},
	} satisfies SavedViewLayouts;

	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: {
						field: "image",
						layout: "table",
						code: "invalid-definition",
						issue: "mapping-field-missing",
					},
				}),
			),
		),
	);
});

it.effect("enforces card title text and explicit JSON image casts", () => {
	const cases = [
		{
			layouts: { ...layouts, grid: { ...layouts.grid, titleField: "count" } },
			reason: {
				layout: "grid",
				issue: "field-kind",
				field: "titleField",
				code: "invalid-definition",
			} as const,
		},
		{
			layouts: { ...layouts, list: { ...layouts.list, imageField: "imageUrl" } },
			reason: {
				layout: "list",
				issue: "image-cast",
				field: "imageField",
				code: "invalid-definition",
			} as const,
		},
	];
	return Effect.forEach(cases, ({ layouts: invalid, reason }) =>
		Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
			Effect.map((exit) => assertExitFails(exit, new SavedViewBadRequest({ reason }))),
		),
	);
});

it.effect("enforces the document rules independently for every layout", () => {
	const secondQuery = {
		...queryDocument,
		queries: { ...queryDocument.queries, second: queryDocument.queries.savedView },
	};
	const withCursor = {
		...queryDocument,
		queries: {
			savedView: {
				...queryDocument.queries.savedView,
				output: {
					...queryDocument.queries.savedView.output,
					pagination: {
						...queryDocument.queries.savedView.output.pagination,
						after: "persisted-cursor",
					},
				},
			},
		},
	};

	return Effect.gen(function* () {
		const queryCountExit = yield* Effect.exit(
			validateSavedViewDefinition({
				layouts: { ...layouts, grid: { ...layouts.grid, queryDocument: secondQuery } },
			}),
		);
		const cursorExit = yield* Effect.exit(
			validateSavedViewDefinition({
				layouts: { ...layouts, table: { ...layouts.table, queryDocument: withCursor } },
			}),
		);
		assertExitFails(
			queryCountExit,
			new SavedViewBadRequest({
				reason: { layout: "grid", issue: "query-count", code: "invalid-definition" },
			}),
		);
		assertExitFails(
			cursorExit,
			new SavedViewBadRequest({
				reason: { layout: "table", issue: "cursor-pagination", code: "invalid-definition" },
			}),
		);
	});
});

it.effect("reports semantic query errors as an unstructured query diagnostic", () => {
	const invalid = {
		...layouts,
		list: {
			...layouts.list,
			queryDocument: document({
				savedView: rows(record, {
					fields: [
						field("id", column(record, "id")),
						field("name", column(record, "name")),
						field("image", castJson(jsonPath(column(record, "missingColumn"), "images", 0))),
					],
				}),
			}),
		},
	} satisfies SavedViewLayouts;

	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: { layout: "list", issue: "query-invalid", code: "invalid-definition" },
				}),
			),
		),
	);
});
