import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { castDate, column, descending, jsonPath, table } from "@ryot/ryotql";
import { buildSavedViewDocument } from "@ryot/ryotql-recipes/saved-views";

import { fitnessEntitySchemas } from "./schemas/entity-schemas";
import { buildDisplayConfig } from "./shared/view-helpers";

export const fitnessSavedViews = () => {
	const schemas = new Map(fitnessEntitySchemas().map((schema) => [schema.slug, schema]));
	const entity = table("entity", "entity");
	const inputs: ReadonlyArray<{
		readonly name: string;
		readonly slug: string;
		readonly entitySchemaSlug: "exercise" | "measurement" | "workout" | "workout-template";
		readonly queryDocument?: RyotQLDocument;
	}> = [
		{ name: "All Exercises", slug: "all-exercises", entitySchemaSlug: "exercise" },
		{ name: "All Workouts", slug: "all-workouts", entitySchemaSlug: "workout" },
		{
			slug: "all-measurements",
			name: "All Measurements",
			entitySchemaSlug: "measurement",
			queryDocument: buildSavedViewDocument({
				entitySchemaSlugs: ["measurement"],
				orderBy: [descending(castDate(jsonPath(column(entity, "properties"), "recordedAt")))],
			}),
		},
		{
			slug: "all-workout-templates",
			name: "All Workout Templates",
			entitySchemaSlug: "workout-template",
			queryDocument: buildSavedViewDocument({
				entitySchemaSlugs: ["workout-template"],
				orderBy: [descending(column(entity, "createdAt"))],
			}),
		},
	] as const;
	return inputs.map((input, sortOrder) => {
		const schema = schemas.get(input.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing fitness entity schema: ${input.entitySchemaSlug}`);
		}
		return {
			sortOrder,
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			pluginSlug: "fitness",
			accentColor: schema.accentColor,
			displayConfiguration: buildDisplayConfig(input.entitySchemaSlug),
			queryDocument:
				input.queryDocument ??
				buildSavedViewDocument({ entitySchemaSlugs: [input.entitySchemaSlug] }),
		};
	});
};
