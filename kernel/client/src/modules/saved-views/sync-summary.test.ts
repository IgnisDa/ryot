import type {
	SavedViewCardMapping,
	SavedViewTableMapping,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type {
	SavedViewCardResultItem,
	SavedViewTableResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";
import { describe, expect, it } from "vitest";

import { cardSyncSlots, savedViewSyncSummary } from "#/modules/saved-views/sync-summary";

const cardMapping = {
	imageField: "image",
	titleField: "title",
	callout: null,
	overline: { field: "overline", displayKind: "text" },
	primaryMetadata: { field: "primary", displayKind: "text" },
	secondaryMetadata: null,
} satisfies SavedViewCardMapping;

const tableMapping = {
	imageField: "image",
	columns: [{ field: "column0", label: "Name", displayKind: "text" }],
} satisfies SavedViewTableMapping;

const card = (
	entityId: string,
	sync: SavedViewCardResultItem["sync"],
	overrides: Partial<SavedViewCardResultItem> = {},
): SavedViewCardResultItem => ({
	sync,
	entityId,
	image: null,
	title: entityId,
	overline: undefined,
	primaryMetadata: undefined,
	...overrides,
});

const complete = {
	overline: { displayKind: "text", value: "Book" },
	primaryMetadata: { displayKind: "text", value: "Clarke" },
	image: { type: "remote", url: "https://example.com/a.jpg" },
} as const;

const row = (
	entityId: string,
	sync: SavedViewTableResultItem["sync"],
	overrides: Partial<SavedViewTableResultItem> = {},
): SavedViewTableResultItem => ({
	sync,
	entityId,
	image: { type: "remote", url: "https://example.com/a.jpg" },
	cells: [{ key: "column0", label: "Name", value: { displayKind: "text", value: entityId } }],
	...overrides,
});

describe("cardSyncSlots", () => {
	it("marks only mapped, missing slots as pending while populating", () => {
		const slots = cardSyncSlots(
			card("a", { populationStatus: "pending", translationStatus: "none" }),
			cardMapping,
		);

		expect(slots).toEqual({
			image: "pending",
			callout: "absent",
			overline: "pending",
			primaryMetadata: "pending",
			secondaryMetadata: "absent",
		});
	});

	it("treats a mid-population row with complete values as settled", () => {
		const slots = cardSyncSlots(
			card("a", { populationStatus: "pending", translationStatus: "none" }, complete),
			cardMapping,
		);

		expect(Object.values(slots)).toEqual(["ready", "absent", "ready", "ready", "absent"]);
	});
});

describe("savedViewSyncSummary", () => {
	it("counts a populating card only when it actually shows a mark", () => {
		expect(
			savedViewSyncSummary({
				type: "card",
				mapping: cardMapping,
				items: [
					card("missing", { populationStatus: "pending", translationStatus: "none" }),
					card(
						"mid-population",
						{ populationStatus: "pending", translationStatus: "none" },
						complete,
					),
					card("settled", { populationStatus: "ready", translationStatus: "none" }, complete),
				],
			}),
		).toEqual({ populating: 1, translating: 0 });
	});

	it("counts every pending translation regardless of missing values", () => {
		expect(
			savedViewSyncSummary({
				type: "card",
				mapping: cardMapping,
				items: [
					card("one", { populationStatus: "ready", translationStatus: "pending" }, complete),
					card("two", { populationStatus: "ready", translationStatus: "pending" }),
					card("three", { populationStatus: "ready", translationStatus: "ready" }, complete),
				],
			}),
		).toEqual({ populating: 0, translating: 2 });
	});

	it("counts a populating table row from its image or a null cell", () => {
		expect(
			savedViewSyncSummary({
				type: "table",
				mapping: tableMapping,
				items: [
					row(
						"no-image",
						{ populationStatus: "pending", translationStatus: "none" },
						{
							image: null,
						},
					),
					row(
						"null-cell",
						{ populationStatus: "pending", translationStatus: "none" },
						{
							cells: [
								{ key: "column0", label: "Name", value: { displayKind: "text", value: null } },
							],
						},
					),
					row("complete", { populationStatus: "pending", translationStatus: "pending" }),
				],
			}),
		).toEqual({ populating: 2, translating: 1 });
	});
});
