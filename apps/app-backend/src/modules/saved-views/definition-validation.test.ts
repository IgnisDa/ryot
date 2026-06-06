import { it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
import { ascending, column, document, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";
import { expect } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";

import { getSavedViewValidationError, validateSavedViewDefinition } from "./definition-validation";

const book = table("entity", "book");
const queryDocument = document({
	savedView: rows(book, {
		orderBy: [ascending(column(book, "name"))],
		fields: [field("id", column(book, "id")), field("name", column(book, "name"))],
	}),
}) satisfies RyotQLDocument;

const displayConfiguration = {
	entityIdField: "id",
	table: { columns: [{ label: "Name", field: "name" }] },
	grid: {
		imageField: null,
		titleField: "name",
		eyebrowField: null,
		calloutField: null,
		primarySubtitleField: null,
		secondarySubtitleField: null,
	},
	list: {
		titleField: "name",
		imageField: null,
		eyebrowField: null,
		calloutField: null,
		primarySubtitleField: null,
		secondarySubtitleField: null,
	},
} satisfies SavedViewDisplayConfiguration;

it.effect("accepts a valid saved view definition", () =>
	Effect.gen(function* () {
		expect(getSavedViewValidationError({ queryDocument, displayConfiguration })).toBeNull();
		yield* validateSavedViewDefinition({ queryDocument, displayConfiguration });
	}),
);

it.effect("rejects a non-text entity ID expression", () =>
	Effect.gen(function* () {
		const invalidQueryDocument = {
			...queryDocument,
			queries: {
				savedView: {
					...queryDocument.queries.savedView,
					output: {
						...queryDocument.queries.savedView.output,
						fields: [...queryDocument.queries.savedView.output.fields, field("count", literal(1))],
					},
				},
			},
		} as RyotQLDocument;
		const exit = yield* Effect.exit(
			validateSavedViewDefinition({
				queryDocument: invalidQueryDocument,
				displayConfiguration: { ...displayConfiguration, entityIdField: "count" },
			}),
		);
		expect(
			getSavedViewValidationError({
				queryDocument: invalidQueryDocument,
				displayConfiguration: { ...displayConfiguration, entityIdField: "count" },
			}),
		).toBe("Saved view entityIdField must resolve to text");

		assertExitFails(
			exit,
			new BadRequest({ message: "Saved view entityIdField must resolve to text" }),
		);
	}),
);
