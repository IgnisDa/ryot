import type { OrderBy } from "@ryot/contract/modules/ryotql/language";
import { column, descending, castDate, jsonPath, table } from "@ryot/ryotql";
import {
	buildSavedViewDocument,
	buildSavedViewLayoutProjections,
} from "@ryot/ryotql-recipes/saved-views";

import { fitnessEntitySchemas } from "./schemas/entity-schemas";
import { buildViewExpressions } from "./shared/view-helpers";

export const fitnessSavedViews = () => {
	const schemas = new Map(fitnessEntitySchemas().map((schema) => [schema.slug, schema]));
	const entity = table("entity", "entity");
	const inputs: ReadonlyArray<{
		readonly name: string;
		readonly slug: string;
		readonly entitySchemaSlug: "exercise" | "measurement" | "workout" | "workout-template";
		readonly orderBy?: readonly OrderBy[] | undefined;
	}> = [
		{ name: "All Exercises", slug: "all-exercises", entitySchemaSlug: "exercise" },
		{ name: "All Workouts", slug: "all-workouts", entitySchemaSlug: "workout" },
		{
			slug: "all-measurements",
			name: "All Measurements",
			entitySchemaSlug: "measurement",
			orderBy: [descending(castDate(jsonPath(column(entity, "properties"), "recordedAt")))],
		},
		{
			slug: "all-workout-templates",
			name: "All Workout Templates",
			entitySchemaSlug: "workout-template",
			orderBy: [descending(column(entity, "createdAt"))],
		},
	];
	return inputs.map((input, sortOrder) => {
		const schema = schemas.get(input.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing fitness entity schema: ${input.entitySchemaSlug}`);
		}
		const itemId = column(entity, "id");
		const expressions = buildViewExpressions(input.entitySchemaSlug, schema.name);
		const projections = buildSavedViewLayoutProjections({
			table: { itemId, ...expressions.table },
			grid: { itemId, card: expressions.grid },
			list: { itemId, card: expressions.list },
		});
		const queryDocument = (fields: (typeof projections)[keyof typeof projections]["fields"]) =>
			buildSavedViewDocument({
				fields,
				orderBy: input.orderBy,
				entitySchemaSlugs: [input.entitySchemaSlug],
			});
		return {
			sortOrder,
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			pluginSlug: "fitness",
			layouts: {
				grid: {
					...projections.grid.mappings,
					queryDocument: queryDocument(projections.grid.fields),
				},
				list: {
					...projections.list.mappings,
					queryDocument: queryDocument(projections.list.fields),
				},
				table: {
					...projections.table.mappings,
					queryDocument: queryDocument(projections.table.fields),
				},
			},
		};
	});
};
