import { describe, expect, it } from "bun:test";
import {
	buildSavedViewExtendedFormValues,
	buildSavedViewExtendedUpdatePayload,
	savedViewExtendedFormSchema,
} from "./form-extended";
import type { AppSavedView } from "./model";

describe("savedViewExtendedFormSchema", () => {
	it("rejects empty entitySchemaSlugs array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: [],
			displayConfiguration: {},
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
		});

		expect(result.success).toBe(false);
	});

	it("accepts valid extended form values", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			sort: { fields: [{ id: "1", value: "@name" }], direction: "desc" },
			displayConfiguration: {
				grid: { titleProperty: ["name"], imageProperty: ["image"] },
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.entitySchemaSlugs).toEqual(["smartphones", "tablets"]);
			expect(result.data.sort.direction).toBe("desc");
			expect(result.data.sort.fields[0]?.value).toBe("@name");
		}
	});

	it("rejects empty sort fields array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			displayConfiguration: {},
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [] },
		});

		expect(result.success).toBe(false);
	});

	it("accepts multiple sort fields", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			displayConfiguration: {},
			sort: {
				direction: "asc",
				fields: [
					{ id: "1", value: "@name" },
					{ id: "2", value: "smartphones.year" },
					{ id: "3", value: "tablets.release_year" },
				],
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sort.fields.map((f) => f.value)).toEqual([
				"@name",
				"smartphones.year",
				"tablets.release_year",
			]);
			expect(result.data.sort.direction).toBe("asc");
		}
	});
});

describe("buildSavedViewExtendedFormValues", () => {
	it("extracts queryDefinition and displayConfiguration from view", () => {
		const view: AppSavedView = {
			id: "view-1",
			icon: "star",
			sortOrder: 1,
			isBuiltin: false,
			name: "Test View",
			isDisabled: false,
			accentColor: "#2DD4BF",
			trackerId: "tracker-1",
			createdAt: "2026-03-20T10:00:00.000Z",
			updatedAt: "2026-03-20T10:05:00.000Z",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphones", "tablets"],
				sort: { direction: "asc", fields: ["@name"] },
			},
			displayConfiguration: {
				table: { columns: [{ label: "Name", property: ["@name"] }] },
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		};

		const values = buildSavedViewExtendedFormValues(view);

		expect(values.entitySchemaSlugs).toEqual(["smartphones", "tablets"]);
		expect(values.filters).toEqual([]);
		expect(values.sort.fields.length).toBe(1);
		expect(values.sort.fields[0]?.value).toBe("@name");
		expect(values.sort.direction).toBe("asc");
		expect(values.displayConfiguration).toEqual(view.displayConfiguration);
	});
});

describe("buildSavedViewExtendedUpdatePayload", () => {
	it("combines view metadata with updated queryDefinition and displayConfiguration", () => {
		const view: AppSavedView = {
			id: "view-1",
			icon: "star",
			sortOrder: 1,
			isBuiltin: false,
			isDisabled: false,
			name: "Original View",
			accentColor: "#2DD4BF",
			trackerId: "tracker-1",
			createdAt: "2026-03-20T10:00:00.000Z",
			updatedAt: "2026-03-20T10:05:00.000Z",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["old-schema"],
				sort: { direction: "asc", fields: ["@name"] },
			},
			displayConfiguration: {
				table: { columns: [{ label: "Name", property: ["@name"] }] },
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		};

		const formValues = {
			entitySchemaSlugs: ["smartphones", "tablets"],
			filters: [{ field: "year", op: "gte" as const, value: 2020 }],
			sort: {
				direction: "desc" as const,
				fields: [
					{ id: "1", value: "@name" },
					{ id: "2", value: "year" },
				],
			},
			displayConfiguration: {
				grid: {
					badgeProperty: null,
					imageProperty: ["image"],
					subtitleProperty: ["year"],
					titleProperty: ["brand", "model"],
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					imageProperty: ["image"],
					titleProperty: ["brand"],
				},
				table: {
					columns: [
						{ label: "Brand", property: ["brand"] },
						{ label: "Year", property: ["year"] },
					],
				},
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		// Preserves view metadata
		expect(payload.name).toBe("Original View");
		expect(payload.icon).toBe("star");
		expect(payload.accentColor).toBe("#2DD4BF");
		expect(payload.isDisabled).toBe(false);
		expect(payload.trackerId).toBe("tracker-1");

		// Uses updated queryDefinition from form
		expect(payload.queryDefinition.entitySchemaSlugs).toEqual([
			"smartphones",
			"tablets",
		]);
		expect(payload.queryDefinition.filters).toEqual([
			{ field: "year", op: "gte", value: 2020 },
		]);
		expect(payload.queryDefinition.sort.fields).toEqual(["@name", "year"]);
		expect(payload.queryDefinition.sort.direction).toBe("desc");

		// Uses updated displayConfiguration from form
		expect(payload.displayConfiguration.grid.titleProperty).toEqual([
			"brand",
			"model",
		]);
		expect(payload.displayConfiguration.table.columns).toEqual([
			{ label: "Brand", property: ["brand"] },
			{ label: "Year", property: ["year"] },
		]);
	});

	it("omits trackerId when view has null trackerId", () => {
		const view: AppSavedView = {
			id: "view-1",
			sortOrder: 1,
			icon: "globe",
			trackerId: null,
			isBuiltin: false,
			isDisabled: false,
			accentColor: "#FF5733",
			name: "Standalone View",
			createdAt: "2026-03-20T10:00:00.000Z",
			updatedAt: "2026-03-20T10:05:00.000Z",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["schema-1"],
				sort: { fields: ["@name"], direction: "asc" },
			},
			displayConfiguration: {
				table: { columns: [] },
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
				},
				list: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
				},
			},
		};

		const formValues = {
			filters: [],
			entitySchemaSlugs: ["new-schema"],
			displayConfiguration: view.displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: "@name" }],
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.trackerId).toBeUndefined();
		expect("trackerId" in payload).toBe(false);
	});
});
