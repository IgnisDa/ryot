import type { OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	ascending,
	castDate,
	column,
	countDistinct,
	descending,
	document,
	eq,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import {
	fitnessPresentationSource,
	workoutPresentationSource,
} from "../shared/entity-presentations";
import { fitnessLibraryLinkExists } from "../shared/library-recipes";
import { fitnessEntitySchemas } from "./schemas/entity";
import { buildViewExpressions } from "./view-helpers";

export const fitnessSavedViews = () => {
	const schemas = new Map(fitnessEntitySchemas().map((schema) => [schema.slug, schema]));
	const entity = table("entity", "entity");
	const workoutSet = table("event", "savedViewWorkoutSet");
	const inputs: ReadonlyArray<{
		readonly name: string;
		readonly slug: string;
		readonly orderBy?: readonly OrderBy[] | undefined;
		readonly entitySchemaSlug: "exercise" | "measurement" | "workout" | "workout-template";
	}> = [
		{
			name: "All Exercises",
			slug: "all-exercises",
			entitySchemaSlug: "exercise",
			orderBy: [
				descending(
					countDistinct(workoutSet, column(workoutSet, "sessionEntityId"), {
						where: and(
							eq(column(workoutSet, "entityId"), column(entity, "id")),
							eq(column(workoutSet, "eventSchemaSlug"), literal("workout-set")),
						),
					}),
				),
				ascending(column(entity, "name")),
			],
		},
		{
			name: "All Workouts",
			slug: "all-workouts",
			entitySchemaSlug: "workout",
			orderBy: [descending(castDate(jsonPath(column(entity, "properties"), "endedAt")))],
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
		const expressions = buildViewExpressions(input.entitySchemaSlug);
		const projections = buildSavedViewLayoutProjections({
			table: { ...expressions.table, entity },
		});
		const presentation =
			input.entitySchemaSlug === "workout"
				? workoutPresentationSource()
				: fitnessPresentationSource(input.entitySchemaSlug);
		const fields = [
			...projections.table.fields,
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			...presentation.fields,
		];
		const where = and(
			eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
			...(input.entitySchemaSlug === "exercise"
				? [fitnessLibraryLinkExists(entity, "fitnessLibrary")]
				: []),
		);
		const dataSources = savedViewRecipe({
			layout: { type: "table", mapping: projections.table.mappings },
			source: {
				type: "persisted",
				queryDocument: document({
					savedView: rows(entity, {
						where,
						fields,
						orderBy: input.orderBy,
						...(presentation.include === undefined ? {} : { include: presentation.include }),
					}),
				}),
			},
		}).document;
		return {
			sortOrder,
			dataSources,
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			pluginSlug: "fitness",
			renderer: { kind: "kernel", name: "entity-browser" } as const,
			settings: {
				pageSize: 20,
				sortChoices: [],
				defaultLayout: "grid",
				sourceName: "savedView",
				entityIdField: "entityId",
				searchFields: ["column0"],
				layouts: ["grid", "list", "table"],
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
				tableColumns: projections.table.mappings.columns,
				addAction: {
					type: "provider-search",
					ownerPluginId: "fitness",
					entitySchemaSlug: input.entitySchemaSlug,
				},
			},
		};
	});
};
