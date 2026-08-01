import { it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
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
import { expect } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";

import { getSavedViewValidationError, validateSavedViewDefinition } from "./definition-validation";

const book = table("entity", "book");
const queryDocument = document({
	savedView: rows(book, {
		orderBy: [ascending(column(book, "name"))],
		fields: [
			field("id", column(book, "id")),
			field("name", column(book, "name")),
			field("image", castJson(jsonPath(column(book, "properties"), "images", 0))),
			field("imageUrl", jsonPath(column(book, "properties"), "images", 0, "url")),
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
	Effect.gen(function* () {
		expect(getSavedViewValidationError({ layouts })).toBeNull();
		yield* validateSavedViewDefinition({ layouts });
	}),
);

it.effect("prefixes validation failures with the layout name", () =>
	Effect.gen(function* () {
		const invalid = { ...layouts, list: { ...layouts.list, entityIdField: "count" } };
		const exit = yield* Effect.exit(validateSavedViewDefinition({ layouts: invalid }));

		expect(getSavedViewValidationError({ layouts: invalid })).toBe(
			"List layout: entityIdField must resolve to text",
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "List layout: entityIdField must resolve to text" }),
		);
	}),
);

it("requires the entity ID mapping to project an entity primary key", () => {
	const invalid = { ...layouts, grid: { ...layouts.grid, entityIdField: "textId" } };

	expect(getSavedViewValidationError({ layouts: invalid })).toBe(
		"Grid layout: entityIdField must project an entity primary key",
	);
});

it("validates mappings against only their layout projection", () => {
	const tableDocument = document({
		savedView: rows(book, {
			fields: [field("id", column(book, "id")), field("tableName", column(book, "name"))],
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

	expect(getSavedViewValidationError({ layouts: invalid })).toBe(
		"Table layout: mapping field 'image' is not in its root projection",
	);
});

it("enforces card title text, explicit JSON image casts, and nonempty table columns", () => {
	const cases: ReadonlyArray<{ expected: string; layouts: SavedViewLayouts }> = [
		{
			expected: "Grid layout: titleField must resolve to text",
			layouts: { ...layouts, grid: { ...layouts.grid, titleField: "count" } },
		},
		{
			expected: "List layout: imageField must use an explicit JSON cast for AssetLocator",
			layouts: { ...layouts, list: { ...layouts.list, imageField: "imageUrl" } },
		},
	];

	for (const value of cases) {
		expect(getSavedViewValidationError({ layouts: value.layouts })).toBe(value.expected);
	}
});

it("enforces the document rules independently for every layout", () => {
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

	expect(
		getSavedViewValidationError({
			layouts: { ...layouts, grid: { ...layouts.grid, queryDocument: secondQuery } },
		}),
	).toBe("Grid layout: must contain exactly one named query");
	expect(
		getSavedViewValidationError({
			layouts: { ...layouts, table: { ...layouts.table, queryDocument: withCursor } },
		}),
	).toBe("Table layout: query pagination must not contain a cursor");
});
