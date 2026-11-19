import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { OrderBy } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	AuthoredEntityBrowserAddAction,
	AuthoredEntityBrowserSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	contains,
	descending,
	document,
	entitySchemaPredicate,
	field,
	rows,
	table,
} from "@ryot-app/ryotql";
import { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";
import { Array as Arr } from "effect";

import { fitnessLibraryLinkExists, fitnessLibraryMembership } from "../shared/library-recipes";
import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { timesPerformed } from "./browse";
import { fitnessEntitySchemas } from "./schemas/entity";
import { buildViewExpressions } from "./view-helpers";

const addAction = (slug: string): AuthoredEntityBrowserAddAction =>
	slug === "exercise"
		? {
				type: "provider-search",
				library: fitnessLibraryMembership,
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
	const inputs: ReadonlyArray<{
		readonly slug: string;
		readonly sortOrder: number;
		readonly name: ManifestText;
		readonly orderBy?: undefined | readonly OrderBy[];
		readonly entitySchemaSlug: "exercise" | "workout-template";
	}> = [
		{
			sortOrder: 0,
			slug: "all-exercises",
			entitySchemaSlug: "exercise",
			name: catalogMessage("saved-view.all-exercises.name"),
			orderBy: [descending(timesPerformed(entity)), ascending(column(entity, "name"))],
		},
		{
			sortOrder: 3,
			slug: "all-workout-templates",
			entitySchemaSlug: "workout-template",
			orderBy: [descending(column(entity, "createdAt"))],
			name: catalogMessage("saved-view.all-workout-templates.name"),
		},
	];
	const entityBrowserViews = inputs.map((input) => {
		const { summary, table: tableExpressions } = buildViewExpressions(input.entitySchemaSlug);
		const fields = [
			field("entityId", column(entity, "id")),
			...(tableExpressions.image === null ? [] : [field("image", tableExpressions.image)]),
			...tableExpressions.columns.map((tableColumn) =>
				field(tableColumn.field, tableColumn.expression),
			),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		];
		const where = and(
			entitySchemaPredicate(entity, input.entitySchemaSlug, { kind: "self" }),
			...(input.entitySchemaSlug === "exercise"
				? [fitnessLibraryLinkExists(entity, "fitnessLibrary")]
				: []),
		);
		const args = parameters({
			fields: {
				search: {
					type: "string",
					defaultValue: "",
					description: "Search library entries",
					label: catalogMessage("query-parameter.search"),
				},
			},
		});
		const base = rows(entity, { where, fields, orderBy: input.orderBy });
		const subtitleField = summary.subtitle;
		const subtitleExpression =
			subtitleField === null
				? undefined
				: tableExpressions.columns.find((tableColumn) => tableColumn.field === subtitleField.field)
						?.expression;
		const browse = {
			alias: entity.alias,
			kind: "browse" as const,
			schemas: [{ slug: input.entitySchemaSlug, owner: { kind: "self" as const } }] as const,
		};
		const dataSources = {
			parameters: args.schema,
			controls: { sort: browse, filter: browse },
			...document({
				savedView: {
					...base,
					output: { ...base.output, orderBy: sort(input.orderBy ?? []) },
					where: and(
						base.where ?? and(),
						contains(column(entity, "name"), args.value("search")),
						filter(),
					),
				},
				librarySearch: librarySearchQuery({
					entity,
					source: base,
					search: args.value("search"),
					image: tableExpressions.image ?? undefined,
					searchExpressions: [column(entity, "name")],
					...(subtitleField && subtitleExpression
						? {
								subtitle: {
									expression: subtitleExpression,
									displayKind: subtitleField.displayKind,
								},
							}
						: {}),
				}).document,
			}),
		};
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
				defaultLayout: "grid",
				sourceName: "savedView",
				layouts: ["grid", "list", "table"],
				addAction: addAction(input.entitySchemaSlug),
				controls: { sort: true, filter: true, search: "search" },
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
		readonly slug: string;
		readonly sortOrder: number;
		readonly name: ManifestText;
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
			slug: "all-workouts",
			exportName: "workouts",
			entitySchemaSlug: "workout",
			name: catalogMessage("saved-view.all-workouts.name"),
		}),
		pageView({
			sortOrder: 2,
			slug: "all-measurements",
			exportName: "measurements",
			entitySchemaSlug: "measurement-metric",
			name: catalogMessage("saved-view.all-measurements.name"),
		}),
	].sort((left, right) => left.sortOrder - right.sortOrder);
};
