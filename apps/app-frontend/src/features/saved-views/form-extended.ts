import { z } from "zod";
import type { AppSavedView } from "./model";

const sortFieldRowSchema = z.object({
	id: z.string(),
	value: z.string(),
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
	field: z.string(),
	value: z.string(),
	op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "isNull"]),
});

export type FilterRow = z.infer<typeof filterRowSchema>;

function buildFilterRow(
	field: string,
	op: FilterRow["op"],
	value: string,
	id?: string,
): FilterRow {
	return { field, op, value, id: id ?? crypto.randomUUID() };
}

export function buildDefaultFilterRow(): FilterRow {
	return buildFilterRow("", "eq", "");
}

const propertyArraySchema = z.array(z.string());

const gridDisplayConfigSchema = z.object({
	imageProperty: propertyArraySchema.nullable(),
	titleProperty: propertyArraySchema.nullable(),
	badgeProperty: propertyArraySchema.nullable(),
	subtitleProperty: propertyArraySchema.nullable(),
});

const displayConfigurationSchema = z.object({
	list: z.any(),
	table: z.any(),
	grid: gridDisplayConfigSchema,
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

export function buildSavedViewExtendedFormValues(
	view: AppSavedView,
): SavedViewExtendedFormValues {
	return {
		displayConfiguration: view.displayConfiguration,
		entitySchemaSlugs: view.queryDefinition.entitySchemaSlugs,
		filters: view.queryDefinition.filters.map((filter) =>
			buildFilterRow(
				filter.field,
				filter.op as FilterRow["op"],
				String(filter.value ?? ""),
			),
		),
		sort: {
			direction: view.queryDefinition.sort.direction,
			fields: view.queryDefinition.sort.fields.map((field) =>
				buildSortFieldRow(field),
			),
		},
	};
}

type ApiFilterExpression =
	| { field: string; op: "isNull"; value?: null }
	| { field: string; op: "in"; value: unknown[] }
	| {
			field: string;
			op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
			value: unknown;
	  };

function buildApiFilter(filter: FilterRow): ApiFilterExpression {
	if (filter.op === "isNull") {
		return { field: filter.field, op: filter.op, value: null };
	}

	if (filter.op === "in") {
		return {
			op: filter.op,
			field: filter.field,
			value: filter.value.split(",").map((v) => v.trim()),
		};
	}

	const numValue = Number(filter.value);
	let parsedValue: unknown = filter.value;
	if (!Number.isNaN(numValue)) {
		parsedValue = numValue;
	} else if (filter.value === "true") {
		parsedValue = true;
	} else if (filter.value === "false") {
		parsedValue = false;
	}

	return { field: filter.field, op: filter.op, value: parsedValue };
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
		displayConfiguration: values.displayConfiguration,
		queryDefinition: {
			filters: values.filters.map((filter) => buildApiFilter(filter)),
			entitySchemaSlugs: values.entitySchemaSlugs,
			sort: {
				direction: values.sort.direction,
				fields: values.sort.fields.map((field) => field.value),
			},
		},
		...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
	};
}
