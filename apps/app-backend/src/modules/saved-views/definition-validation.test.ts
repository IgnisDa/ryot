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
		fields: [
			field("id", column(book, "id")),
			field("name", column(book, "name")),
			field("count", literal(1)),
		],
	}),
}) satisfies RyotQLDocument;

const displayConfiguration = {
	entityIdField: "id",
	table: { imageField: null, columns: [{ label: "Name", field: "name" }] },
	grid: {
		imageField: null,
		titleField: "name",
		calloutField: null,
		overlineField: null,
		primaryMetadataField: null,
		secondaryMetadataField: null,
	},
	list: {
		imageField: null,
		titleField: "name",
		calloutField: null,
		overlineField: null,
		primaryMetadataField: null,
		secondaryMetadataField: null,
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
		const exit = yield* Effect.exit(
			validateSavedViewDefinition({
				queryDocument,
				displayConfiguration: { ...displayConfiguration, entityIdField: "count" },
			}),
		);
		expect(
			getSavedViewValidationError({
				queryDocument,
				displayConfiguration: { ...displayConfiguration, entityIdField: "count" },
			}),
		).toBe("Saved view entityIdField must resolve to text");

		assertExitFails(
			exit,
			new BadRequest({ message: "Saved view entityIdField must resolve to text" }),
		);
	}),
);

it.effect("rejects non-text title and image expressions", () =>
	Effect.sync(() => {
		const invalidConfigurations = [
			{
				expected: "Saved view grid titleField must resolve to text",
				value: {
					...displayConfiguration,
					grid: { ...displayConfiguration.grid, titleField: "count" },
				},
			},
			{
				expected: "Saved view list titleField must resolve to text",
				value: {
					...displayConfiguration,
					list: { ...displayConfiguration.list, titleField: "count" },
				},
			},
			{
				expected: "Saved view grid imageField must resolve to text",
				value: {
					...displayConfiguration,
					grid: { ...displayConfiguration.grid, imageField: "count" },
				},
			},
			{
				expected: "Saved view list imageField must resolve to text",
				value: {
					...displayConfiguration,
					list: { ...displayConfiguration.list, imageField: "count" },
				},
			},
			{
				expected: "Saved view table imageField must resolve to text",
				value: {
					...displayConfiguration,
					table: { ...displayConfiguration.table, imageField: "count" },
				},
			},
		] satisfies ReadonlyArray<{
			readonly expected: string;
			readonly value: SavedViewDisplayConfiguration;
		}>;

		for (const { expected, value } of invalidConfigurations) {
			expect(getSavedViewValidationError({ queryDocument, displayConfiguration: value })).toBe(
				expected,
			);
		}
	}),
);
