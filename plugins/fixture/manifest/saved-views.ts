import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	AuthoredEntityBrowserAddAction,
	AuthoredEntityBrowserSavedViewSettings,
	SavedViewTableColumn,
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
type TableColumn = SavedViewTableColumn & { readonly expression: ScalarExpression };

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
				label: "Search",
				defaultValue: "",
				description: "Search library entries",
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
	const imageColumn = { label: "Image", field: "image", displayKind: "managed-asset" as const };
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

const nameColumn = { field: "name", label: "Name", expression: name, displayKind: "text" } as const;

const pokemonColumns = [
	nameColumn,
	{ label: "Pokedex Number", ...number("pokedexNumber") },
	{ label: "Types", ...json("types") },
	{ label: "Abilities", ...json("abilities") },
	{ label: "Height (dm)", ...number("height") },
	{ label: "Weight (hg)", ...number("weight") },
	{ label: "Base Experience", ...number("baseExperience") },
] satisfies NonEmptyColumns;

const moveColumns = [
	nameColumn,
	{ label: "Type", ...text("type") },
	{ label: "Damage Class", ...text("damageClass") },
	{ label: "Power", ...number("power") },
	{ label: "Accuracy", ...number("accuracy") },
	{ label: "PP", ...number("pp") },
	{ label: "Priority", ...number("priority") },
	{ label: "Generation", ...text("generation") },
] satisfies NonEmptyColumns;

const allFieldControlsColumns = [
	nameColumn,
	{ label: "Text", ...text("text") },
	{ label: "Website", ...text("website") },
	{ label: "Email", ...text("email") },
	{ label: "Timezone", ...text("timezone") },
	{ label: "Decimal", ...number("decimal") },
	{ label: "Integer", ...number("integer") },
	{ label: "Enabled", field: "enabled", displayKind: "boolean", expression: property("enabled") },
	{ label: "Date", field: "date", displayKind: "date", expression: property("date") },
	{ label: "Date and time", ...text("datetime") },
	{ label: "Choice", ...text("choice") },
	{ label: "Choices", ...json("choices") },
	{ label: "Tags", ...json("tags") },
	{ label: "Details", ...json("details") },
	{ label: "Entries", ...json("entries") },
	{ label: "Chip choice", ...text("chipChoice") },
	{ label: "Assets", ...json("assets") },
] satisfies NonEmptyColumns;

export const fixtureSavedViews = [
	{
		sortOrder: 0,
		icon: "sparkles",
		name: "All Pokemon",
		slug: "all-pokemon",
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
		name: "All Moves",
		slug: "all-moves",
		...buildDefinition("move", ascending(name), null, moveColumns, {
			field: "type",
			displayKind: "text",
		}),
	},
	{
		icon: "list",
		sortOrder: 2,
		name: "All Field Controls",
		slug: "all-field-controls",
		...buildDefinition(
			"all-field-controls",
			ascending(name),
			castJson(property("asset")),
			allFieldControlsColumns,
			{ field: "text", displayKind: "text" },
		),
	},
] as const;
