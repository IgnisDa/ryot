import { it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
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
			field("count", literal(1)),
		],
	}),
}) satisfies RyotQLDocument;

const displayConfiguration = {
	entityIdField: "id",
	table: { imageField: "image", columns: [{ label: "Name", field: "name" }] },
	grid: {
		titleField: "name",
		calloutField: null,
		overlineField: null,
		imageField: "image",
		primaryMetadataField: null,
		secondaryMetadataField: null,
	},
	list: {
		titleField: "name",
		calloutField: null,
		imageField: "image",
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

it.effect("rejects non-text titles and non-JSON image expressions", () =>
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
				expected: "Saved view grid imageField must resolve to JSON AssetLocator",
				value: {
					...displayConfiguration,
					grid: { ...displayConfiguration.grid, imageField: "name" },
				},
			},
			{
				expected: "Saved view list imageField must resolve to JSON AssetLocator",
				value: {
					...displayConfiguration,
					list: { ...displayConfiguration.list, imageField: "name" },
				},
			},
			{
				expected: "Saved view table imageField must resolve to JSON AssetLocator",
				value: {
					...displayConfiguration,
					table: { ...displayConfiguration.table, imageField: "name" },
				},
			},
			{
				expected: "Saved view grid imageField must resolve to JSON AssetLocator",
				value: {
					...displayConfiguration,
					grid: { ...displayConfiguration.grid, imageField: "imageUrl" },
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
