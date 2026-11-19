import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	AuthoredEntityBrowserAddAction,
	AuthoredEntityBrowserSavedViewSettings,
	AuthoredSavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	castJson,
	castNumber,
	column,
	contains,
	document,
	entitySchemaPredicate,
	field,
	jsonPath,
	rows,
	table,
} from "@ryot-app/ryotql";
import { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";
import { Array as Arr } from "effect";

import { catalogMessage } from "../shared/messages.generated";

const entity = table("entity", "entity");
const name = column(entity, "name");
const property = (key: string) => jsonPath(column(entity, "properties"), key);
const json = (key: string) => ({
	field: key,
	expression: property(key),
	displayKind: "json" as const,
});
const text = (key: string) => ({
	field: key,
	expression: property(key),
	displayKind: "text" as const,
});
const number = (key: string) => ({
	field: key,
	expression: property(key),
	displayKind: "number" as const,
});

type NonEmptyColumns = readonly [TableColumn, ...TableColumn[]];
type TableColumn = AuthoredSavedViewTableColumn & { readonly expression: ScalarExpression };

const buildDefinition = (
	entitySchemaSlug: string,
	orderBy: ReturnType<typeof ascending>,
	image: null | ScalarExpression,
	columns: NonEmptyColumns,
	subtitle: AuthoredEntityBrowserSavedViewSettings["summary"]["subtitle"],
) => {
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
	const base = rows(entity, {
		orderBy: [orderBy],
		where: entitySchemaPredicate(entity, entitySchemaSlug, { kind: "self" }),
		fields: [
			field("entityId", column(entity, "id")),
			...(image === null ? [] : [field("image", image)]),
			...columns.map((tableColumn) => field(tableColumn.field, tableColumn.expression)),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		],
	});
	const subtitleField = subtitle;
	const subtitleExpression =
		subtitleField === null
			? undefined
			: columns.find((tableColumn) => tableColumn.field === subtitleField.field)?.expression;
	const browse = {
		alias: entity.alias,
		kind: "browse" as const,
		schemas: [{ slug: entitySchemaSlug, owner: { kind: "self" as const } }] as const,
	};
	const dataSources = {
		parameters: args.schema,
		controls: { sort: browse, filter: browse },
		...document({
			savedView: {
				...base,
				output: { ...base.output, orderBy: sort([orderBy]) },
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
				searchExpressions: [column(entity, "name")],
				...(image === null ? {} : { image }),
				...(subtitleField && subtitleExpression
					? { subtitle: { expression: subtitleExpression, displayKind: subtitleField.displayKind } }
					: {}),
			}).document,
		}),
	};
	const tableColumns = Arr.map(columns, ({ expression: _, ...tableColumn }) => tableColumn);
	const imageColumn = {
		field: "image",
		displayKind: "managed-asset" as const,
		label: catalogMessage("table-column.image"),
	};
	return {
		dataSources,
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			pageSize: 20,
			sourceName: "savedView",
			defaultLayout: "grid" as const,
			layouts: ["grid", "list", "table"] as const,
			controls: { sort: true, filter: true, search: "search" },
			summary: { subtitle, image: image === null ? null : "image" },
			tableColumns: image === null ? tableColumns : Arr.prepend(tableColumns, imageColumn),
			subject: {
				entityAlias: "entity",
				schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make(entitySchemaSlug) }],
			},
			addAction: {
				type: "provider-search",
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(entitySchemaSlug) },
				library: {
					entryEvent: null,
					librarySchemaSlug: "fixture-library",
					relationshipSlug: "in-fixture-library",
				},
			} satisfies AuthoredEntityBrowserAddAction,
		} satisfies AuthoredEntityBrowserSavedViewSettings,
	};
};

const pokemonImage = castJson(jsonPath(column(entity, "properties"), "images", 0));

const nameColumn = {
	field: "name",
	expression: name,
	displayKind: "text",
	label: catalogMessage("table-column.name"),
} as const;

const pokemonColumns = [
	nameColumn,
	{ label: catalogMessage("property.pokedex-number"), ...number("pokedexNumber") },
	{ label: catalogMessage("property.types"), ...json("types") },
	{ label: catalogMessage("property.abilities"), ...json("abilities") },
	{ label: catalogMessage("table-column.height"), ...number("height") },
	{ label: catalogMessage("table-column.weight"), ...number("weight") },
	{ label: catalogMessage("property.base-experience"), ...number("baseExperience") },
] satisfies NonEmptyColumns;

const moveColumns = [
	nameColumn,
	{ label: catalogMessage("property.type"), ...text("type") },
	{ label: catalogMessage("property.damage-class"), ...text("damageClass") },
	{ label: catalogMessage("property.power"), ...number("power") },
	{ label: catalogMessage("property.accuracy"), ...number("accuracy") },
	{ label: catalogMessage("property.pp"), ...number("pp") },
	{ label: catalogMessage("property.priority"), ...number("priority") },
	{ label: catalogMessage("property.generation"), ...text("generation") },
] satisfies NonEmptyColumns;

const allFieldControlsColumns = [
	nameColumn,
	{ label: catalogMessage("property.text"), ...text("text") },
	{ label: catalogMessage("property.website"), ...text("website") },
	{ label: catalogMessage("property.email"), ...text("email") },
	{ label: catalogMessage("property.timezone"), ...text("timezone") },
	{ label: catalogMessage("property.decimal"), ...number("decimal") },
	{ label: catalogMessage("property.integer"), ...number("integer") },
	{
		field: "enabled",
		displayKind: "boolean",
		expression: property("enabled"),
		label: catalogMessage("property.enabled"),
	},
	{
		field: "date",
		displayKind: "date",
		expression: property("date"),
		label: catalogMessage("property.date"),
	},
	{ label: catalogMessage("property.date-and-time"), ...text("datetime") },
	{ label: catalogMessage("property.choice"), ...text("choice") },
	{ label: catalogMessage("property.choices"), ...json("choices") },
	{ label: catalogMessage("property.tags"), ...json("tags") },
	{ label: catalogMessage("property.details"), ...json("details") },
	{ label: catalogMessage("property.entries"), ...json("entries") },
	{ label: catalogMessage("property.chip-choice"), ...text("chipChoice") },
	{ label: catalogMessage("property.assets"), ...json("assets") },
] satisfies NonEmptyColumns;

export const fixtureSavedViews = [
	{
		sortOrder: 0,
		icon: "sparkles",
		slug: "all-pokemon",
		name: catalogMessage("saved-view.all-pokemon.name"),
		...buildDefinition(
			"pokemon",
			ascending(castNumber(property("pokedexNumber"))),
			pokemonImage,
			pokemonColumns,
			null,
		),
	},
	{
		icon: "zap",
		sortOrder: 1,
		slug: "all-moves",
		name: catalogMessage("saved-view.all-moves.name"),
		...buildDefinition("move", ascending(name), null, moveColumns, {
			field: "type",
			displayKind: "text",
		}),
	},
	{
		icon: "list",
		sortOrder: 2,
		slug: "all-field-controls",
		name: catalogMessage("saved-view.all-field-controls.name"),
		...buildDefinition(
			"all-field-controls",
			ascending(name),
			castJson(property("asset")),
			allFieldControlsColumns,
			{ field: "text", displayKind: "text" },
		),
	},
] as const;
