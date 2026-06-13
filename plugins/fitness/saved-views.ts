import type { OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import { column, descending, castDate, jsonPath, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import { fitnessEntitySchemas } from "./backend/schemas/entity-schemas";
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
		{
			name: "All Exercises",
			slug: "all-exercises",
			entitySchemaSlug: "exercise",
		},
		{
			name: "All Workouts",
			slug: "all-workouts",
			entitySchemaSlug: "workout",
		},
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
		const entityId = column(entity, "id");
		const expressions = buildViewExpressions(input.entitySchemaSlug, schema.name);
		const projections = buildSavedViewLayoutProjections({
			table: { entityId, ...expressions.table },
			grid: { entityId, card: expressions.grid },
			list: { entityId, card: expressions.list },
		});
		const cardQueryDocument = (projection: typeof projections.grid) =>
			savedViewRecipe({
				layout: { type: "card", mapping: projection.mappings },
				source: {
					type: "generated",
					fields: projection.fields,
					orderBy: input.orderBy,
					entitySchemaSlugs: [input.entitySchemaSlug],
				},
			}).document;
		const tableQueryDocument = (projection: typeof projections.table) =>
			savedViewRecipe({
				layout: { type: "table", mapping: projection.mappings },
				source: {
					type: "generated",
					fields: projection.fields,
					orderBy: input.orderBy,
					entitySchemaSlugs: [input.entitySchemaSlug],
				},
			}).document;
		return {
			sortOrder,
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			pluginSlug: "fitness",
			entitySchemaSlug: input.entitySchemaSlug,
			layouts: {
				grid: {
					...projections.grid.mappings,
					queryDocument: cardQueryDocument(projections.grid),
				},
				list: {
					...projections.list.mappings,
					queryDocument: cardQueryDocument(projections.list),
				},
				table: {
					...projections.table.mappings,
					queryDocument: tableQueryDocument(projections.table),
				},
			},
		};
	});
};
