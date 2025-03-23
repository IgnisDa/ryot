import { z } from "zod";
import type { AppSavedView } from "./model";

export const savedViewExtendedFormSchema = z.object({
	displayConfiguration: z.any(),
	filters: z.array(z.any()),
	entitySchemaSlugs: z.array(z.string()).min(1, "At least one schema required"),
	sort: z.object({
		direction: z.enum(["asc", "desc"]),
		fields: z.array(z.string()).min(1),
	}),
});

export type SavedViewExtendedFormValues = z.infer<
	typeof savedViewExtendedFormSchema
>;

export function buildSavedViewExtendedFormValues(
	view: AppSavedView,
): SavedViewExtendedFormValues {
	return {
		sort: view.queryDefinition.sort,
		filters: view.queryDefinition.filters,
		displayConfiguration: view.displayConfiguration,
		entitySchemaSlugs: view.queryDefinition.entitySchemaSlugs,
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
			sort: values.sort,
			filters: values.filters,
			entitySchemaSlugs: values.entitySchemaSlugs,
		},
		...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
	};
}
