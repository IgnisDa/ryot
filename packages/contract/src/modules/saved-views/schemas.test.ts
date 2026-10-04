import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	CreateSavedViewBody,
	SavedViewDisplayValue,
	SavedViewRendererConfig,
	UpdateSavedViewBody,
} from "./schemas";

const browserSettings = {
	pageSize: 25,
	sortChoices: [],
	addAction: null,
	layouts: ["grid"],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "entities",
	searchFields: ["name"],
	subject: {
		entityAlias: "entity",
		schemas: [{ slug: "movie", owner: { kind: "plugin", pluginId: "media-plugin" } }],
	},
} as const;

const emptyDocument = { queries: {} };

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
			Schema.decodeSync(SavedViewDisplayValue)({
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
		const browser = Schema.decodeSync(EntityBrowserSavedViewSettings)({
			pageSize: 25,
			sourceName: "entities",
			defaultLayout: "table",
			searchFields: ["name"],
			layouts: ["grid", "table"],
			tableColumns: [{ label: "Name", field: "name", displayKind: "text" }],
			sortChoices: [
				{ name: "newest", label: "Newest", orderBy: [{ direction: "desc", field: "createdAt" }] },
			],
			subject: {
				entityAlias: "entity",
				schemas: [{ slug: "movie", owner: { kind: "plugin", pluginId: "media-plugin" } }],
			},
			addAction: {
				type: "provider-search",
				schema: { slug: "movie", owner: { kind: "plugin", pluginId: "media-plugin" } },
				library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
			},
		});
		const resultsInput = {
			pageSize: 50,
			sourceName: "events",
			rowKeyFields: ["eventId", "sequence"],
			entityLink: { entityIdField: "entityId" },
			columns: [{ label: "Occurred", field: "occurredAt", displayKind: "date" }],
		} as const;
		const results = Schema.decodeSync(ResultsTableSavedViewSettings)(resultsInput);
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
					Schema.decodeResult(ResultsTableSavedViewSettings)({ ...resultsInput, pageSize }),
				),
			).toBe(true);
		}
	});

	it("requires an entity-browser subject and rejects removed provenance fields", () => {
		const { subject: _subject, ...withoutSubject } = browserSettings;
		expect(
			Result.isFailure(Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(withoutSubject)),
		).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)({
					...browserSettings,
					entityIdField: "id",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)({
					...browserSettings,
					subject: { ...browserSettings.subject, schemas: [] },
				}),
			),
		).toBe(true);
	});

	it("types renderer config by renderer", () => {
		const entityBrowser = { kind: "kernel", name: "entity-browser" } as const;
		expect(
			Result.isSuccess(
				Schema.decodeResult(SavedViewRendererConfig)({
					renderer: entityBrowser,
					settings: browserSettings,
					dataSources: emptyDocument,
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(SavedViewRendererConfig)({
					renderer: entityBrowser,
					dataSources: emptyDocument,
					settings: { ...browserSettings, subject: undefined },
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				Schema.decodeResult(SavedViewRendererConfig)({
					dataSources: null,
					settings: { anything: [1, "two"] },
					renderer: { pluginId: "p", kind: "plugin", exportName: "view" },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(CreateSavedViewBody)({
					icon: "table",
					name: "Browser",
					renderer: entityBrowser,
					dataSources: emptyDocument,
					settings: { pageSize: 10 },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(CreateSavedViewBody)({
					icon: "table",
					name: "Browser",
					dataSources: null,
					renderer: entityBrowser,
					settings: browserSettings,
				}),
			),
		).toBe(true);
	});

	it("accepts update bodies with no config or a full config and rejects partial configs", () => {
		const decode = Schema.decodeUnknownResult(UpdateSavedViewBody);
		const renderer = { pluginId: "p", kind: "plugin", exportName: "view" } as const;
		expect(Result.isSuccess(decode({ isHidden: true, name: "Renamed" }))).toBe(true);
		expect(
			Result.isSuccess(decode({ renderer, settings: {}, isHidden: false, dataSources: null })),
		).toBe(true);
		expect(Result.isFailure(decode({ renderer, isHidden: false }))).toBe(true);
		expect(Result.isFailure(decode({ settings: {}, isHidden: false }))).toBe(true);
		expect(Result.isFailure(decode({ renderer, settings: {}, isHidden: false }))).toBe(true);
	});
});
