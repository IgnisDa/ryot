import { z } from "zod";
import type { AppSavedView } from "./model";

const schemaQualifiedPropertyPattern = /^[^.\s]+\.[^.\s]+$/;
const builtinPropertyPattern = /^@[^.\s]+$/;

function isValidPropertyReference(value: string) {
	return (
		builtinPropertyPattern.test(value) ||
		schemaQualifiedPropertyPattern.test(value)
	);
}

const propertyReferenceSchema = z
	.string()
	.refine(
		isValidPropertyReference,
		"Use a built-in field or schema.property path",
	);

const sortFieldRowSchema = z.object({
	id: z.string(),
	value: propertyReferenceSchema,
});

export type SortFieldRow = z.infer<typeof sortFieldRowSchema>;

function buildSortFieldRow(value: string, id?: string): SortFieldRow {
	return { value, id: id ?? crypto.randomUUID() };
}

export function buildDefaultSortFieldRow(): SortFieldRow {
	return buildSortFieldRow("");
}

const filterRowSchema = z.object({
	id: z.string(),
	field: propertyReferenceSchema,
	value: z.union([z.string(), z.number(), z.boolean()]),
	op: z.enum([
		"eq",
		"ne",
		"gt",
		"gte",
		"lt",
		"lte",
		"in",
		"isNull",
		"contains",
	]),
});

export type FilterRow = z.infer<typeof filterRowSchema>;

function buildFilterRow(
	field: string,
	op: FilterRow["op"],
	value: FilterRow["value"],
	id?: string,
): FilterRow {
	return { field, op, value, id: id ?? crypto.randomUUID() };
}

export function buildDefaultFilterRow(): FilterRow {
	return buildFilterRow("", "eq", "");
}

const propertyPathRowSchema = z.object({
	id: z.string(),
	value: propertyReferenceSchema,
});

export type PropertyPathRow = z.infer<typeof propertyPathRowSchema>;

function buildPropertyPathRow(value: string, id?: string): PropertyPathRow {
	return { value, id: id ?? crypto.randomUUID() };
}

export function buildDefaultPropertyPathRow(): PropertyPathRow {
	return buildPropertyPathRow("");
}

const propertyPathRowsSchema = z.array(propertyPathRowSchema);

const displayPropertySchema = propertyPathRowsSchema.nullable();

const gridDisplayConfigSchema = z.object({
	imageProperty: displayPropertySchema,
	titleProperty: displayPropertySchema,
	badgeProperty: displayPropertySchema,
	subtitleProperty: displayPropertySchema,
});

const listDisplayConfigSchema = z.object({
	imageProperty: displayPropertySchema,
	titleProperty: displayPropertySchema,
	badgeProperty: displayPropertySchema,
	subtitleProperty: displayPropertySchema,
});

const tableColumnSchema = z.object({
	id: z.string(),
	label: z.string().min(1, "Column label required"),
	property: propertyPathRowsSchema.min(
		1,
		"At least one property path required",
	),
});

export type TableColumnRow = z.infer<typeof tableColumnSchema>;

export function buildDefaultTableColumnRow(): TableColumnRow {
	return {
		label: "",
		id: crypto.randomUUID(),
		property: [buildDefaultPropertyPathRow()],
	};
}

const tableDisplayConfigSchema = z.object({
	columns: z.array(tableColumnSchema),
});

const displayConfigurationSchema = z.object({
	list: listDisplayConfigSchema,
	grid: gridDisplayConfigSchema,
	table: tableDisplayConfigSchema,
});

export const savedViewExtendedFormSchema = z.object({
	filters: z.array(filterRowSchema),
	displayConfiguration: displayConfigurationSchema,
	entitySchemaSlugs: z.array(z.string()).min(1, "At least one schema required"),
	sort: z.object({
		direction: z.enum(["asc", "desc"]),
		fields: z.array(sortFieldRowSchema).min(1),
	}),
});

export type SavedViewExtendedFormValues = z.infer<
	typeof savedViewExtendedFormSchema
>;

function buildDisplayPropertyRows(value: string[] | null) {
	if (value === null) {
		return null;
	}

	return value.map((row) => buildPropertyPathRow(row));
}

function buildTableColumnRow(
	column: AppSavedView["displayConfiguration"]["table"]["columns"][number],
): TableColumnRow {
	return {
		label: column.label,
		id: crypto.randomUUID(),
		property: column.property.map((value) => buildPropertyPathRow(value)),
	};
}

export function buildSavedViewExtendedFormValues(
	view: AppSavedView,
): SavedViewExtendedFormValues {
	return {
		entitySchemaSlugs: view.queryDefinition.entitySchemaSlugs,
		sort: {
			direction: view.queryDefinition.sort.direction,
			fields: view.queryDefinition.sort.fields.map((field) =>
				buildSortFieldRow(field),
			),
		},
		filters: view.queryDefinition.filters.map((filter) => {
			const rawValue = "value" in filter ? filter.value : null;
			let formValue: FilterRow["value"] = "";
			if (
				typeof rawValue === "string" ||
				typeof rawValue === "number" ||
				typeof rawValue === "boolean"
			) {
				formValue = rawValue;
			}
			return buildFilterRow(
				filter.field,
				filter.op as FilterRow["op"],
				formValue,
			);
		}),
		displayConfiguration: {
			table: {
				columns: view.displayConfiguration.table.columns.map((column) =>
					buildTableColumnRow(column),
				),
			},
			grid: {
				badgeProperty: buildDisplayPropertyRows(
					view.displayConfiguration.grid.badgeProperty,
				),
				imageProperty: buildDisplayPropertyRows(
					view.displayConfiguration.grid.imageProperty,
				),
				titleProperty: buildDisplayPropertyRows(
					view.displayConfiguration.grid.titleProperty,
				),
				subtitleProperty: buildDisplayPropertyRows(
					view.displayConfiguration.grid.subtitleProperty,
				),
			},
			list: {
				badgeProperty: buildDisplayPropertyRows(
					view.displayConfiguration.list.badgeProperty,
				),
				imageProperty: buildDisplayPropertyRows(
					view.displayConfiguration.list.imageProperty,
				),
				titleProperty: buildDisplayPropertyRows(
					view.displayConfiguration.list.titleProperty,
				),
				subtitleProperty: buildDisplayPropertyRows(
					view.displayConfiguration.list.subtitleProperty,
				),
			},
		},
	};
}

type ApiFilterExpression =
	| { field: string; op: "isNull"; value?: null }
	| { field: string; op: "in"; value: unknown[] }
	| {
			field: string;
			op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
			value: unknown;
	  };

function buildApiFilter(filter: FilterRow): ApiFilterExpression {
	if (filter.op === "isNull") {
		return { field: filter.field, op: filter.op, value: null };
	}

	if (filter.op === "in") {
		const raw = typeof filter.value === "string" ? filter.value : "";
		return {
			op: filter.op,
			field: filter.field,
			value: raw.split(",").map((v) => v.trim()),
		};
	}

	return { field: filter.field, op: filter.op, value: filter.value };
}

function buildApiDisplayProperty(value: PropertyPathRow[] | null) {
	if (value === null) {
		return null;
	}

	return value.map((row) => row.value);
}

export function buildSavedViewExtendedUpdatePayload(
	view: AppSavedView,
	values: SavedViewExtendedFormValues,
) {
	return {
		name: view.name,
		icon: view.icon,
		isDisabled: view.isDisabled,
		accentColor: view.accentColor,
		queryDefinition: {
			entitySchemaSlugs: values.entitySchemaSlugs,
			filters: values.filters.map((filter) => buildApiFilter(filter)),
			sort: {
				direction: values.sort.direction,
				fields: values.sort.fields.map((field) => field.value),
			},
		},
		...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
		displayConfiguration: {
			grid: {
				badgeProperty: buildApiDisplayProperty(
					values.displayConfiguration.grid.badgeProperty,
				),
				imageProperty: buildApiDisplayProperty(
					values.displayConfiguration.grid.imageProperty,
				),
				titleProperty: buildApiDisplayProperty(
					values.displayConfiguration.grid.titleProperty,
				),
				subtitleProperty: buildApiDisplayProperty(
					values.displayConfiguration.grid.subtitleProperty,
				),
			},
			list: {
				badgeProperty: buildApiDisplayProperty(
					values.displayConfiguration.list.badgeProperty,
				),
				imageProperty: buildApiDisplayProperty(
					values.displayConfiguration.list.imageProperty,
				),
				titleProperty: buildApiDisplayProperty(
					values.displayConfiguration.list.titleProperty,
				),
				subtitleProperty: buildApiDisplayProperty(
					values.displayConfiguration.list.subtitleProperty,
				),
			},
			table: {
				columns: values.displayConfiguration.table.columns.map((column) => ({
					label: column.label,
					property: column.property.map((row) => row.value),
				})),
			},
		},
	};
}
