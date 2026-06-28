import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	CreateSavedViewBody,
	SavedViewDisplayValue,
} from "./schemas";

describe("saved-view schemas", () => {
	it("rejects removed layout payloads", () => {
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(CreateSavedViewBody)({
					layouts: {},
					icon: "table",
					name: "Old view",
					entitySchemaSlug: null,
				}),
			),
		).toBe(true);
	});

	it("decodes canonical managed-asset display values", () => {
		expect(
			Schema.decodeUnknownSync(SavedViewDisplayValue)({
				displayKind: "managed-asset",
				value: { type: "local", key: "covers/book.webp" },
			}),
		).toEqual({ displayKind: "managed-asset", value: { type: "local", key: "covers/book.webp" } });
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(SavedViewDisplayValue)({
					displayKind: "managed-asset",
					value: { type: "local", url: "https://example.com/book.webp" },
				}),
			),
		).toBe(true);
	});

	it("decodes canonical configured browser and general-table settings", () => {
		const browser = Schema.decodeUnknownSync(EntityBrowserSavedViewSettings)({
			pageSize: 25,
			sourceName: "entities",
			defaultLayout: "table",
			searchFields: ["name"],
			entityIdField: "entityId",
			layouts: ["grid", "table"],
			ownerPluginIdField: "ownerPluginId",
			entitySchemaSlugField: "entitySchemaSlug",
			tableColumns: [{ label: "Name", field: "name", displayKind: "text" }],
			addAction: {
				type: "provider-search",
				entitySchemaSlug: "movie",
				ownerPluginId: "media-plugin",
			},
			sortChoices: [
				{ name: "newest", label: "Newest", orderBy: [{ direction: "desc", field: "createdAt" }] },
			],
		});
		const resultsInput = {
			pageSize: 50,
			sourceName: "events",
			rowKeyFields: ["eventId", "sequence"],
			entityLink: { entityIdField: "entityId" },
			columns: [{ label: "Occurred", field: "occurredAt", displayKind: "date" }],
		} as const;
		const results = Schema.decodeUnknownSync(ResultsTableSavedViewSettings)(resultsInput);
		const { pageSize: _pageSize, ...withoutPageSize } = resultsInput;

		expect(browser.layouts).toEqual(["grid", "table"]);
		expect(browser.addAction).toMatchObject({ type: "provider-search" });
		expect(results.rowKeyFields).toEqual(["eventId", "sequence"]);
		expect(results.pageSize).toBe(50);
		expect(
			Result.isFailure(Schema.decodeUnknownResult(ResultsTableSavedViewSettings)(withoutPageSize)),
		).toBe(true);
		for (const pageSize of [0, 101]) {
			expect(
				Result.isFailure(
					Schema.decodeUnknownResult(ResultsTableSavedViewSettings)({ ...resultsInput, pageSize }),
				),
			).toBe(true);
		}
	});
});
