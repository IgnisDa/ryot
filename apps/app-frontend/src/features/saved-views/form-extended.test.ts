import { describe, expect, it } from "bun:test";
import {
	createSavedViewFixture,
	defaultSavedViewDisplayConfiguration,
} from "#/features/test-fixtures";
import {
	buildDefaultFilterRow,
	buildSavedViewExtendedFormValues,
	buildSavedViewExtendedUpdatePayload,
	savedViewExtendedFormSchema,
} from "./form-extended";

describe("savedViewExtendedFormSchema", () => {
	it("rejects empty entitySchemaSlugs array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: [],
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					badgeProperty: null,
					imageProperty: null,
					titleProperty: null,
					subtitleProperty: null,
				},
			},
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
				table: {},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["name"],
					imageProperty: ["image"],
				},
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [] },
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(false);
	});

	it("accepts multiple sort fields", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
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

	it("validates grid display configuration with all four properties", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					badgeProperty: ["status"],
					subtitleProperty: ["year"],
					imageProperty: ["image", "photo"],
					titleProperty: ["@name", "brand"],
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.displayConfiguration.grid.imageProperty).toEqual([
				"image",
				"photo",
			]);
			expect(result.data.displayConfiguration.grid.titleProperty).toEqual([
				"@name",
				"brand",
			]);
			expect(result.data.displayConfiguration.grid.subtitleProperty).toEqual([
				"year",
			]);
			expect(result.data.displayConfiguration.grid.badgeProperty).toEqual([
				"status",
			]);
		}
	});

	it("allows badgeProperty to be null", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				table: {},
				grid: {
					badgeProperty: null,
					imageProperty: ["image"],
					titleProperty: ["@name"],
					subtitleProperty: ["year"],
				},
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.displayConfiguration.grid.badgeProperty).toBeNull();
		}
	});

	it("allows grid properties to be null", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				table: {},
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
				},
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.displayConfiguration.grid.titleProperty).toEqual([
				"@name",
			]);
			expect(result.data.displayConfiguration.grid.imageProperty).toBeNull();
		}
	});

	it("rejects non-array values for grid properties", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				table: {},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: "not-an-array",
				},
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(false);
	});
});

describe("buildSavedViewExtendedFormValues", () => {
	it("extracts queryDefinition and displayConfiguration from view", () => {
		const view = createSavedViewFixture({
			icon: "star",
			name: "Test View",
			trackerId: "tracker-1",
			isBuiltin: false,
			accentColor: "#2DD4BF",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphones", "tablets"],
				sort: { direction: "asc", fields: ["@name"] },
			},
		});

		const values = buildSavedViewExtendedFormValues(view);

		expect(values.entitySchemaSlugs).toEqual(["smartphones", "tablets"]);
		expect(values.filters).toEqual([]);
		expect(values.sort.fields.length).toBe(1);
		expect(values.sort.fields[0]?.value).toBe("@name");
		expect(values.sort.direction).toBe("asc");
		expect(values.displayConfiguration).toEqual(view.displayConfiguration);
	});
});

describe("savedViewExtendedFormSchema - filters", () => {
	it("accepts valid filter row with eq operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			entitySchemaSlugs: ["smartphones"],
			filters: [{ id: "1", field: "@name", op: "eq", value: "iPhone" }],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					subtitleProperty: null,
					badgeProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.filters[0]).toEqual({
				id: "1",
				op: "eq",
				field: "@name",
				value: "iPhone",
			});
		}
	});

	it("rejects invalid operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			filters: [{ id: "1", field: "@name", op: "invalid", value: "test" }],
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(false);
	});

	it("accepts filter with isNull operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			filters: [{ id: "1", field: "@description", op: "isNull", value: "" }],
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
	});

	it("accepts filter with in operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [{ id: "1", field: "brand", op: "in", value: "Apple,Samsung" }],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
	});

	it("accepts empty filters array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "@name" }] },
			displayConfiguration: {
				list: {},
				table: {},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
	});
});

describe("buildDefaultFilterRow", () => {
	it("returns empty filter row with UUID", () => {
		const row = buildDefaultFilterRow();

		expect(row.field).toBe("");
		expect(row.op).toBe("eq");
		expect(row.value).toBe("");
		expect(row.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});

describe("buildSavedViewExtendedUpdatePayload", () => {
	it("combines view metadata with updated queryDefinition and displayConfiguration", () => {
		const view = createSavedViewFixture({
			icon: "star",
			name: "Original View",
			trackerId: "tracker-1",
			isBuiltin: false,
			accentColor: "#2DD4BF",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["old-schema"],
				sort: { direction: "asc", fields: ["@name"] },
			},
		});

		const formValues = {
			entitySchemaSlugs: ["smartphones", "tablets"],
			filters: [{ id: "1", field: "year", op: "gte" as const, value: "2020" }],
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

	it("converts isNull operator filter with null value", () => {
		const view = createSavedViewFixture({
			icon: "filter",
			name: "Test View",
			trackerId: null,
			isBuiltin: false,
			accentColor: "#2DD4BF",
			createdAt: "2026-03-22T10:00:00.000Z",
			updatedAt: "2026-03-22T10:00:00.000Z",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphones"],
				sort: { fields: ["@name"], direction: "asc" },
			},
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
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
		});

		const formValues = {
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{ id: "1", field: "description", op: "isNull" as const, value: "" },
			],
			displayConfiguration: view.displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: "@name" }],
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{ field: "description", op: "isNull", value: null },
		]);
	});

	it("converts in operator filter to array", () => {
		const view = createSavedViewFixture({
			icon: "filter",
			name: "Test View",
			trackerId: null,
			isBuiltin: false,
			accentColor: "#2DD4BF",
			createdAt: "2026-03-22T10:00:00.000Z",
			updatedAt: "2026-03-22T10:00:00.000Z",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphones"],
				sort: { fields: ["@name"], direction: "asc" },
			},
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
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
		});

		const formValues = {
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{
					id: "1",
					field: "brand",
					op: "in" as const,
					value: "Apple,Samsung,Google",
				},
			],
			displayConfiguration: view.displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: "@name" }],
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{ field: "brand", op: "in", value: ["Apple", "Samsung", "Google"] },
		]);
	});

	it("omits trackerId when view has null trackerId", () => {
		const view = createSavedViewFixture({
			icon: "globe",
			name: "Standalone View",
			trackerId: null,
			isBuiltin: false,
			accentColor: "#FF5733",
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
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
		});

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
