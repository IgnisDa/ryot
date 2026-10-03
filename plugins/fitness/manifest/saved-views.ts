import type { OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	entitySchemaPredicate,
	schemaOwnerPredicate,
	and,
	ascending,
	column,
	countDistinct,
	descending,
	document,
	eq,
	field,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import { fitnessPresentationSource } from "../shared/entity-presentations";
import { fitnessLibraryLinkExists } from "../shared/library-recipes";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fitnessEntitySchemas } from "./schemas/entity";
import { buildViewExpressions } from "./view-helpers";

const addAction = (slug: string): JsonValue =>
	slug === "exercise"
		? {
				type: "provider-search",
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(slug) },
			}
		: { search: {}, type: "plugin-route", path: "/templates/new", packageId: PLUGIN_PACKAGE_ID };

export const fitnessSavedViews = () => {
	const schemas = new Map(fitnessEntitySchemas.map((schema) => [schema.slug, schema]));
	const iconOf = (slug: (typeof fitnessEntitySchemas)[number]["slug"]) => {
		const schema = schemas.get(slug);
		if (!schema) {
			throw new Error(`Missing fitness entity schema: ${slug}`);
		}
		return schema.icon;
	};
	const entity = table("entity", "entity");
	const workoutSet = table("event", "savedViewWorkoutSet");
	const inputs: ReadonlyArray<{
		readonly name: string;
		readonly slug: string;
		readonly sortOrder: number;
		readonly orderBy?: readonly OrderBy[] | undefined;
		readonly entitySchemaSlug: "exercise" | "workout-template";
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
			sortOrder: 3,
			slug: "all-workout-templates",
			name: "All Workout Templates",
			entitySchemaSlug: "workout-template",
			orderBy: [descending(column(entity, "createdAt"))],
		},
	];
	const entityBrowserViews = inputs.map((input) => {
		const expressions = buildViewExpressions(input.entitySchemaSlug);
		const projections = buildSavedViewLayoutProjections({
			table: { ...expressions.table, entity },
		});
		const presentation = fitnessPresentationSource(input.entitySchemaSlug);
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
					savedView: rows(entity, { where, fields, orderBy: input.orderBy }),
				}),
			},
		}).document;
		return {
			dataSources,
			name: input.name,
			slug: input.slug,
			sortOrder: input.sortOrder,
			icon: iconOf(input.entitySchemaSlug),
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
				addAction: addAction(input.entitySchemaSlug),
				tableColumns: projections.table.mappings.columns,
			},
		};
	});
	const pageView = (input: {
		readonly name: string;
		readonly slug: string;
		readonly sortOrder: number;
		readonly exportName: string;
		readonly entitySchemaSlug: "measurement-metric" | "workout";
	}) => ({
		settings: {},
		name: input.name,
		slug: input.slug,
		dataSources: null,
		sortOrder: input.sortOrder,
		icon: iconOf(input.entitySchemaSlug),
		renderer: { kind: "plugin", exportName: input.exportName } as const,
	});
	return [
		...entityBrowserViews,
		pageView({
			sortOrder: 1,
			name: "All Workouts",
			slug: "all-workouts",
			exportName: "workouts",
			entitySchemaSlug: "workout",
		}),
		pageView({
			sortOrder: 2,
			name: "All Measurements",
			slug: "all-measurements",
			exportName: "measurements",
			entitySchemaSlug: "measurement-metric",
		}),
	].sort((left, right) => left.sortOrder - right.sortOrder);
};
