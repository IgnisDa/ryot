import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine/recipes/app";

import { fitnessEntitySchemas } from "./schemas/entity-schemas";
import { buildDisplayConfig } from "./shared/view-helpers";

export const fitnessSavedViews = () => {
	const schemas = new Map(fitnessEntitySchemas().map((schema) => [schema.slug, schema]));
	const inputs: ReadonlyArray<{
		readonly name: string;
		readonly slug: string;
		readonly entitySchemaSlug: "exercise" | "measurement" | "workout" | "workout-template";
		readonly queryDocument?: QueryDocument;
	}> = [
		{ name: "All Exercises", slug: "all-exercises", entitySchemaSlug: "exercise" },
		{ name: "All Workouts", slug: "all-workouts", entitySchemaSlug: "workout" },
		{
			slug: "all-measurements",
			name: "All Measurements",
			entitySchemaSlug: "measurement",
			queryDocument: buildDefaultSavedViewQueryDocument({
				schemas: ["measurement"],
				orderBy: [
					{
						order: "desc" as const,
						expr: {
							type: "ref" as const,
							sourceAlias: "entity",
							field: {
								type: "property" as const,
								schema: "measurement",
								path: ["recordedAt"],
							},
						},
					},
				],
			}),
		},
		{
			slug: "all-workout-templates",
			name: "All Workout Templates",
			entitySchemaSlug: "workout-template",
			queryDocument: buildDefaultSavedViewQueryDocument({
				schemas: ["workout-template"],
				orderBy: [
					{
						order: "desc" as const,
						expr: {
							type: "ref" as const,
							sourceAlias: "entity",
							field: { type: "system" as const, name: "createdAt" as const },
						},
					},
				],
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
			pluginSlug: "fitness",
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			accentColor: schema.accentColor,
			displayConfiguration: buildDisplayConfig(input.entitySchemaSlug),
			queryDocument:
				input.queryDocument ??
				buildDefaultSavedViewQueryDocument({ schemas: [input.entitySchemaSlug] }),
		};
	});
};
