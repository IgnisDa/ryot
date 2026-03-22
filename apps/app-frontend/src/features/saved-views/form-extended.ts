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

export const savedViewExtendedFormSchema = z.object({
	displayConfiguration: z.any(),
	filters: z.array(z.any()),
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
		filters: view.queryDefinition.filters,
		displayConfiguration: view.displayConfiguration,
		entitySchemaSlugs: view.queryDefinition.entitySchemaSlugs,
		sort: {
			direction: view.queryDefinition.sort.direction,
			fields: view.queryDefinition.sort.fields.map((field) =>
				buildSortFieldRow(field),
			),
		},
	};
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
			filters: values.filters,
			entitySchemaSlugs: values.entitySchemaSlugs,
			sort: {
				direction: values.sort.direction,
				fields: values.sort.fields.map((field) => field.value),
			},
		},
		...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
	};
}
