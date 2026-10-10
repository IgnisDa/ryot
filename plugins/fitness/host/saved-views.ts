import type { OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	entitySchemaPredicate,
	schemaOwnerPredicate,
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
		readonly sortOrder: number;
		readonly orderBy?: readonly OrderBy[] | undefined;
		readonly entitySchemaSlug: "exercise" | "workout" | "workout-template";
	}> = [
		{
			sortOrder: 0,
			name: "All Exercises",
			slug: "all-exercises",
			entitySchemaSlug: "exercise",
			orderBy: [
				descending(
					countDistinct(workoutSet, column(workoutSet, "sessionEntityId"), {
						where: and(
							schemaOwnerPredicate(workoutSet, "eventSchemaPluginId", { kind: "self" }),
							eq(column(workoutSet, "entityId"), column(entity, "id")),
							eq(column(workoutSet, "eventSchemaSlug"), literal("workout-set")),
						),
					}),
				),
				ascending(column(entity, "name")),
			],
		},
		{
			sortOrder: 1,
			name: "All Workouts",
			slug: "all-workouts",
			entitySchemaSlug: "workout",
			orderBy: [descending(castDate(jsonPath(column(entity, "properties"), "endedAt")))],
		},
		{
			sortOrder: 3,
			slug: "all-workout-templates",
			name: "All Workout Templates",
			entitySchemaSlug: "workout-template",
			orderBy: [descending(column(entity, "createdAt"))],
		},
	];
	const entityBrowserViews = inputs.map((input) => {
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
			entitySchemaPredicate(entity, input.entitySchemaSlug, { kind: "self" }),
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
			dataSources,
			name: input.name,
			slug: input.slug,
			icon: schema.icon,
			sortOrder: input.sortOrder,
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
					schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(input.entitySchemaSlug) },
				},
			},
		};
	});
	const metricSchema = schemas.get("measurement-metric");
	if (!metricSchema) {
		throw new Error("Missing fitness entity schema: measurement-metric");
	}
	const measurementsView = {
		sortOrder: 2,
		settings: {},
		dataSources: null,
		icon: metricSchema.icon,
		slug: "all-measurements",
		name: "All Measurements",
		renderer: { kind: "plugin", exportName: "measurements" } as const,
	};
	return [...entityBrowserViews.slice(0, 2), measurementsView, ...entityBrowserViews.slice(2)];
};
