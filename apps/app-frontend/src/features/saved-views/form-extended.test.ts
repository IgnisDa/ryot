import { describe, expect, it } from "bun:test";
import {
	createSavedViewFixture,
	defaultSavedViewDisplayConfiguration,
} from "#/features/test-fixtures";
import {
	buildDefaultFilterRow,
	buildDefaultPropertyPathRow,
	buildDefaultTableColumnRow,
	buildSavedViewExtendedFormValues,
	buildSavedViewExtendedUpdatePayload,
	savedViewExtendedFormSchema,
} from "./form-extended";

function toPropertyRows(values: string[]) {
	return values.map((value) => ({ ...buildDefaultPropertyPathRow(), value }));
}

function schemaField(schemaSlug: string, property: string) {
	if (
		property === "name" ||
		property === "image" ||
		property === "createdAt" ||
		property === "updatedAt" ||
		property.startsWith("@")
	) {
		return `entity.${schemaSlug}.${property.startsWith("@") ? property : `@${property}`}`;
	}

	return `entity.${schemaSlug}.${property}`;
}

function toTableColumn(label: string, property: string[]) {
	return {
		...buildDefaultTableColumnRow(),
		label,
		property: toPropertyRows(property),
	};
}

describe("savedViewExtendedFormSchema", () => {
	it("rejects empty entitySchemaSlugs array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: [],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				grid: {
					badgeProperty: null,
					imageProperty: null,
					titleProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(false);
	});

	it("accepts valid extended form values", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			sort: {
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
				direction: "desc",
			},
			displayConfiguration: {
				table: { columns: [] },
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: toPropertyRows([schemaField("smartphones", "name")]),
					imageProperty: toPropertyRows([schemaField("smartphones", "image")]),
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
			expect(result.data.sort.fields[0]?.value).toBe(
				schemaField("smartphones", "@name"),
			);
		}
	});

	it("rejects table columns without a label", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			sort: {
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
				direction: "desc",
			},
			displayConfiguration: {
				table: {
					columns: [toTableColumn("", [schemaField("smartphones", "@name")])],
				},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: toPropertyRows([schemaField("smartphones", "name")]),
					imageProperty: toPropertyRows([schemaField("smartphones", "image")]),
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

	it("rejects empty sort fields array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [] },
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
			eventJoins: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
					{ id: "1", value: schemaField("smartphones", "@name") },
					{ id: "2", value: "entity.smartphones.year" },
					{ id: "3", value: "entity.tablets.release_year" },
				],
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sort.fields.map((f) => f.value)).toEqual([
				schemaField("smartphones", "@name"),
				"entity.smartphones.year",
				"entity.tablets.release_year",
			]);
			expect(result.data.sort.direction).toBe("asc");
		}
	});

	it("validates grid display configuration with all four properties", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				grid: {
					badgeProperty: toPropertyRows([schemaField("smartphones", "status")]),
					subtitleProperty: toPropertyRows([
						schemaField("smartphones", "year"),
					]),
					imageProperty: toPropertyRows([
						schemaField("smartphones", "image"),
						schemaField("smartphones", "photo"),
					]),
					titleProperty: toPropertyRows([
						schemaField("smartphones", "@name"),
						schemaField("smartphones", "brand"),
					]),
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(
				result.data.displayConfiguration.grid.imageProperty?.map(
					(row) => row.value,
				),
			).toEqual([
				schemaField("smartphones", "image"),
				schemaField("smartphones", "photo"),
			]);

			expect(
				result.data.displayConfiguration.grid.titleProperty?.map(
					(row) => row.value,
				),
			).toEqual([
				schemaField("smartphones", "@name"),
				schemaField("smartphones", "brand"),
			]);
			expect(
				result.data.displayConfiguration.grid.subtitleProperty?.map(
					(row) => row.value,
				),
			).toEqual([schemaField("smartphones", "year")]);
			expect(
				result.data.displayConfiguration.grid.badgeProperty?.map(
					(row) => row.value,
				),
			).toEqual([schemaField("smartphones", "status")]);
		}
	});

	it("allows badgeProperty to be null", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				grid: {
					badgeProperty: null,
					imageProperty: toPropertyRows([schemaField("smartphones", "image")]),
					titleProperty: toPropertyRows([schemaField("smartphones", "@name")]),
					subtitleProperty: toPropertyRows([
						schemaField("smartphones", "year"),
					]),
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
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: toPropertyRows([schemaField("smartphones", "@name")]),
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
			expect(
				result.data.displayConfiguration.grid.titleProperty?.map(
					(row) => row.value,
				),
			).toEqual([schemaField("smartphones", "@name")]);
			expect(result.data.displayConfiguration.grid.imageProperty).toBeNull();
		}
	});

	it("rejects non-array values for grid properties", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: {},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("smartphones", "@name")],
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
			isBuiltin: false,
			name: "Test View",
			trackerId: "tracker-1",
			accentColor: "#2DD4BF",
			queryDefinition: {
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["smartphones", "tablets"],
				sort: {
					direction: "asc",
					fields: [schemaField("smartphones", "@name")],
				},
			},
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
				grid: {
					...defaultSavedViewDisplayConfiguration.grid,
					titleProperty: [schemaField("smartphones", "@name")],
					imageProperty: [schemaField("smartphones", "@image")],
				},
				list: {
					...defaultSavedViewDisplayConfiguration.list,
					titleProperty: [schemaField("smartphones", "@name")],
					imageProperty: [schemaField("smartphones", "@image")],
				},
				table: {
					columns: [
						{
							label: "Name",
							property: [schemaField("smartphones", "@name")],
						},
					],
				},
			},
		});

		const values = buildSavedViewExtendedFormValues(view);

		expect(values.entitySchemaSlugs).toEqual(["smartphones", "tablets"]);
		expect(values.filters).toEqual([]);
		expect(values.sort.fields.length).toBe(1);
		expect(values.sort.fields[0]?.value).toBe(
			schemaField("smartphones", "@name"),
		);
		expect(values.sort.direction).toBe("asc");
		expect(
			values.displayConfiguration.grid.titleProperty?.map((row) => row.value),
		).toEqual([schemaField("smartphones", "@name")]);
		expect(
			values.displayConfiguration.list.imageProperty?.map((row) => row.value),
		).toEqual([schemaField("smartphones", "@image")]);
		expect(
			values.displayConfiguration.table.columns[0]?.property.map(
				(row) => row.value,
			),
		).toEqual([schemaField("smartphones", "@name")]);
	});
});

describe("savedViewExtendedFormSchema - filters", () => {
	it("accepts valid filter row with eq operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "@name"),
					op: "eq",
					value: "iPhone",
				},
			],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
				field: schemaField("smartphones", "@name"),
				value: "iPhone",
			});
		}
	});

	it("rejects invalid operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "@name"),
					op: "invalid",
					value: "test",
				},
			],
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "description"),
					op: "isNull",
					value: "",
				},
			],
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "brand"),
					op: "in",
					value: "Apple,Samsung",
				},
			],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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

	it("rejects unqualified property references", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [{ id: "1", field: "brand", op: "eq", value: "Apple" }],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: { direction: "asc", fields: [{ id: "1", value: "year" }] },
			displayConfiguration: {
				table: { columns: [toTableColumn("Brand", ["brand"])] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				grid: {
					imageProperty: null,
					titleProperty: toPropertyRows(["brand"]),
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(false);
	});

	it("accepts filter with contains operator", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					op: "contains",
					value: "waterproof",
					field: schemaField("smartphones", "description"),
				},
			],
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.filters[0]?.op).toBe("contains");
			expect(result.data.filters[0]?.value).toBe("waterproof");
		}
	});

	it("accepts empty filters array", () => {
		const result = savedViewExtendedFormSchema.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc",
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			displayConfiguration: {
				table: { columns: [] },
				list: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
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
			isBuiltin: false,
			name: "Original View",
			trackerId: "tracker-1",
			accentColor: "#2DD4BF",
			queryDefinition: {
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["old-schema"],
				sort: {
					direction: "asc",
					fields: [schemaField("old-schema", "@name")],
				},
			},
		});

		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones", "tablets"],
			filters: [
				{
					id: "1",
					value: 2020,
					op: "gte" as const,
					field: schemaField("smartphones", "year"),
				},
			],
			sort: {
				direction: "desc" as const,
				fields: [
					{ id: "1", value: schemaField("smartphones", "@name") },
					{ id: "2", value: schemaField("smartphones", "year") },
				],
			},
			displayConfiguration: {
				grid: {
					badgeProperty: null,
					imageProperty: toPropertyRows([schemaField("smartphones", "image")]),
					subtitleProperty: toPropertyRows([
						schemaField("smartphones", "year"),
					]),
					titleProperty: toPropertyRows([
						schemaField("smartphones", "brand"),
						schemaField("smartphones", "model"),
					]),
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					imageProperty: toPropertyRows([schemaField("smartphones", "image")]),
					titleProperty: toPropertyRows([schemaField("smartphones", "brand")]),
				},
				table: {
					columns: [
						toTableColumn("Brand", [schemaField("smartphones", "brand")]),
						toTableColumn("Year", [schemaField("smartphones", "year")]),
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
			{ field: schemaField("smartphones", "year"), op: "gte", value: 2020 },
		]);
		expect(payload.queryDefinition.sort.fields).toEqual([
			schemaField("smartphones", "@name"),
			schemaField("smartphones", "year"),
		]);
		expect(payload.queryDefinition.sort.direction).toBe("desc");

		// Uses updated displayConfiguration from form
		expect(payload.displayConfiguration.grid.titleProperty).toEqual([
			schemaField("smartphones", "brand"),
			schemaField("smartphones", "model"),
		]);
		expect(payload.displayConfiguration.list.titleProperty).toEqual([
			schemaField("smartphones", "brand"),
		]);
		expect(payload.displayConfiguration.table.columns).toEqual([
			{ label: "Brand", property: [schemaField("smartphones", "brand")] },
			{ label: "Year", property: [schemaField("smartphones", "year")] },
		]);
	});

	it("converts isNull operator filter with null value", () => {
		const view = createSavedViewFixture({
			icon: "filter",
			trackerId: null,
			isBuiltin: false,
			name: "Test View",
			accentColor: "#2DD4BF",
			createdAt: "2026-03-22T10:00:00.000Z",
			updatedAt: "2026-03-22T10:00:00.000Z",
			queryDefinition: {
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					fields: [schemaField("smartphones", "@name")],
					direction: "asc",
				},
			},
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
				table: { columns: [] },
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("smartphones", "@name")],
				},
				list: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("smartphones", "@name")],
				},
			},
		});

		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "description"),
					op: "isNull" as const,
					value: "",
				},
			],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{
				field: schemaField("smartphones", "description"),
				op: "isNull",
				value: null,
			},
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
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					fields: [schemaField("smartphones", "@name")],
					direction: "asc",
				},
			},
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
				table: { columns: [] },
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("smartphones", "@name")],
				},
				list: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("smartphones", "@name")],
				},
			},
		});

		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "brand"),
					op: "in" as const,
					value: "Apple,Samsung,Google",
				},
			],
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{
				field: schemaField("smartphones", "brand"),
				op: "in",
				value: ["Apple", "Samsung", "Google"],
			},
		]);
	});

	it("passes number comparison value through as-is without coercion", () => {
		const view = createSavedViewFixture({ trackerId: null });
		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "year"),
					op: "gte" as const,
					value: 2020,
				},
			],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
		};
		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{ field: schemaField("smartphones", "year"), op: "gte", value: 2020 },
		]);
		expect(typeof payload.queryDefinition.filters[0]?.value).toBe("number");
	});

	it("passes boolean comparison value through as-is without coercion", () => {
		const view = createSavedViewFixture({ trackerId: null });
		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "active"),
					op: "eq" as const,
					value: true,
				},
			],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
		};
		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{ field: schemaField("smartphones", "active"), op: "eq", value: true },
		]);
		expect(typeof payload.queryDefinition.filters[0]?.value).toBe("boolean");
	});

	it("splits in operator value by comma with trimming", () => {
		const view = createSavedViewFixture({ trackerId: null });
		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "brand"),
					op: "in" as const,
					value: "Apple , Samsung , Google",
				},
			],
		};
		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{
				field: schemaField("smartphones", "brand"),
				op: "in",
				value: ["Apple", "Samsung", "Google"],
			},
		]);
	});

	it("sets isNull filter value to null regardless of form value", () => {
		const view = createSavedViewFixture({ trackerId: null });
		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			filters: [
				{
					id: "1",
					field: schemaField("smartphones", "name"),
					op: "isNull" as const,
					value: "ignored",
				},
			],
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
		};
		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{ field: schemaField("smartphones", "name"), op: "isNull", value: null },
		]);
	});

	it("passes contains filter value through as-is", () => {
		const view = createSavedViewFixture({ trackerId: null });
		const formValues = {
			eventJoins: [],
			entitySchemaSlugs: ["smartphones"],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("smartphones", "@name") }],
			},
			filters: [
				{
					id: "1",
					value: "waterproof",
					op: "contains" as const,
					field: schemaField("smartphones", "description"),
				},
			],
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.queryDefinition.filters).toEqual([
			{
				op: "contains",
				value: "waterproof",
				field: schemaField("smartphones", "description"),
			},
		]);
	});

	it("omits trackerId when view has null trackerId", () => {
		const view = createSavedViewFixture({
			icon: "globe",
			trackerId: null,
			isBuiltin: false,
			name: "Standalone View",
			accentColor: "#FF5733",
			displayConfiguration: {
				...defaultSavedViewDisplayConfiguration,
				table: { columns: [] },
				grid: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("new-schema", "@name")],
				},
				list: {
					imageProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [schemaField("new-schema", "@name")],
				},
			},
		});

		const formValues = {
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["new-schema"],
			displayConfiguration:
				buildSavedViewExtendedFormValues(view).displayConfiguration,
			sort: {
				direction: "asc" as const,
				fields: [{ id: "1", value: schemaField("new-schema", "@name") }],
			},
		};

		const payload = buildSavedViewExtendedUpdatePayload(view, formValues);

		expect(payload.trackerId).toBeUndefined();
		expect("trackerId" in payload).toBe(false);
	});
});
