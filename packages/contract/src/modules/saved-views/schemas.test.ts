import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CreateSavedViewBody,
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
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
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [{ slug: "record", owner: { kind: "plugin", pluginId: "plugin-a" } }],
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
				value: { type: "local", key: "covers/item.webp" },
			}),
		).toEqual({ displayKind: "managed-asset", value: { type: "local", key: "covers/item.webp" } });
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(SavedViewDisplayValue)({
					displayKind: "managed-asset",
					value: { type: "local", url: "https://example.com/item.webp" },
				}),
			),
		).toBe(true);
	});

	it("decodes year display values as finite numbers", () => {
		expect(Schema.decodeSync(SavedViewDisplayValue)({ value: 1995, displayKind: "year" })).toEqual({
			value: 1995,
			displayKind: "year",
		});
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(SavedViewDisplayValue)({ value: "1995", displayKind: "year" }),
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
			summary: { image: null, subtitle: null },
			tableColumns: [{ label: "Name", field: "name", displayKind: "text" }],
			sortChoices: [
				{ name: "newest", label: "Newest", orderBy: [{ direction: "desc", field: "createdAt" }] },
			],
			subject: {
				entityAlias: "entity",
				schemas: [{ slug: "record", owner: { kind: "plugin", pluginId: "plugin-a" } }],
			},
			addAction: {
				type: "provider-search",
				schema: { slug: "record", owner: { kind: "plugin", pluginId: "plugin-a" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
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

	it("rejects calendar renderer configs in create and update bodies", () => {
		const config = {
			settings: {},
			dataSources: null,
			renderer: { kind: "kernel", name: "calendar" },
		};
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(CreateSavedViewBody)({
					...config,
					name: "Mine",
					icon: "calendar",
				}),
			),
		).toBe(true);
		const update: unknown = { ...config, isHidden: false };
		expect(Result.isFailure(Schema.decodeUnknownResult(UpdateSavedViewBody)(update))).toBe(true);
		expect(Result.isFailure(Schema.decodeUnknownResult(SavedViewRendererConfig)(config))).toBe(
			true,
		);
	});
});
