import type { OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import type {
	AuthoredEntityBrowserAddAction,
	AuthoredEntityBrowserSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	countDistinct,
	descending,
	document,
	entitySchemaPredicate,
	eq,
	field,
	jsonPath,
	literal,
	rows,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";
import { propertyFilterFields } from "@ryot-app/ryotql-recipes/property-filter-fields";
import { Array as Arr, Result } from "effect";

import { fitnessPresentationSource } from "../shared/entity-presentations";
import { fitnessLibraryLinkExists, fitnessLibraryMembership } from "../shared/library-recipes";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fitnessEntitySchemas } from "./schemas/entity";
import { exercisePropertiesSchema } from "./schemas/property";
import { buildViewExpressions } from "./view-helpers";

const addAction = (slug: string): AuthoredEntityBrowserAddAction =>
	slug === "exercise"
		? {
				type: "provider-search",
				library: fitnessLibraryMembership,
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(slug) },
			}
		: { search: {}, type: "plugin-route", path: "/templates/new", packageId: PLUGIN_PACKAGE_ID };

const exerciseFilterProperties = ["level", "force", "mechanic", "kind"] as const;

const exerciseFilterKey = (property: (typeof exerciseFilterProperties)[number]) =>
	`${property}Value`;

const exerciseRelationshipFilter = (key: string, label: string, slug: string) =>
	({
		key,
		label,
		kind: "relationship",
		direction: "outgoing",
		relationship: { owner: { kind: "self" }, slug: RelationshipSchemaSlug.make(slug) },
	}) as const;

export const exerciseFilterFields = () => [
	...Result.getOrThrow(
		propertyFilterFields(
			exercisePropertiesSchema,
			exerciseFilterProperties.map((property) => ({
				property,
				field: exerciseFilterKey(property),
			})),
		),
	),
	exerciseRelationshipFilter("muscles", "Muscles", "exercise-targets"),
	exerciseRelationshipFilter("equipment", "Equipment", "exercise-uses-equipment"),
];

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
		readonly orderBy?: undefined | readonly OrderBy[];
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
		const { summary, table: tableExpressions } = buildViewExpressions(input.entitySchemaSlug);
		const presentation = fitnessPresentationSource(input.entitySchemaSlug);
		const fields = [
			field("entityId", column(entity, "id")),
			...(tableExpressions.image === null ? [] : [field("image", tableExpressions.image)]),
			...tableExpressions.columns.map((tableColumn) =>
				field(tableColumn.field, tableColumn.expression),
			),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			...presentation.fields,
			...(input.entitySchemaSlug === "exercise"
				? exerciseFilterProperties.map((property) =>
						field(exerciseFilterKey(property), jsonPath(column(entity, "properties"), property)),
					)
				: []),
		];
		const where = and(
			entitySchemaPredicate(entity, input.entitySchemaSlug, { kind: "self" }),
			...(input.entitySchemaSlug === "exercise"
				? [fitnessLibraryLinkExists(entity, "fitnessLibrary")]
				: []),
		);
		const dataSources = document({
			savedView: rows(entity, { where, fields, orderBy: input.orderBy }),
		});
		return {
			dataSources,
			name: input.name,
			slug: input.slug,
			sortOrder: input.sortOrder,
			icon: iconOf(input.entitySchemaSlug),
			renderer: { kind: "kernel", name: "entity-browser" } as const,
			settings: {
				summary,
				pageSize: 20,
				sortChoices: [],
				defaultLayout: "grid",
				searchFields: ["name"],
				sourceName: "savedView",
				layouts: ["grid", "list", "table"],
				addAction: addAction(input.entitySchemaSlug),
				...(input.entitySchemaSlug === "exercise" ? { filterFields: exerciseFilterFields() } : {}),
				tableColumns: Arr.map(
					tableExpressions.columns,
					({ expression: _, ...tableColumn }) => tableColumn,
				),
				subject: {
					entityAlias: "entity",
					schemas: [
						{ owner: { kind: "self" }, slug: EntitySchemaSlug.make(input.entitySchemaSlug) },
					],
				},
			} satisfies AuthoredEntityBrowserSavedViewSettings,
		};
	});
	const pageView = (input: {
		readonly name: string;
		readonly slug: string;
		readonly sortOrder: number;
		readonly exportName: string;
		readonly entitySchemaSlug: "workout" | "measurement-metric";
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
