import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import type {
	AuthoredEntityBrowserAddAction,
	SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	castJson,
	castNumber,
	column,
	document,
	entitySchemaPredicate,
	field,
	jsonPath,
	rows,
	table,
} from "@ryot-app/ryotql";

import { movePresentationSource, pokemonPresentationSource } from "../shared/entity-presentations";

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

type TableColumn = SavedViewTableColumn & { readonly expression: ScalarExpression };

const buildDefinition = (
	entitySchemaSlug: string,
	orderBy: ReturnType<typeof ascending>,
	image: ScalarExpression | null,
	columns: readonly TableColumn[],
	presentationFields: ReturnType<typeof pokemonPresentationSource>["fields"],
) => {
	const dataSources = document({
		savedView: rows(entity, {
			orderBy: [orderBy],
			where: entitySchemaPredicate(entity, entitySchemaSlug, { kind: "self" }),
			fields: [
				field("entityId", column(entity, "id")),
				...(image === null ? [] : [field("image", image)]),
				...columns.map((tableColumn) => field(tableColumn.field, tableColumn.expression)),
				field("ownerPluginId", column(entity, "entitySchemaPluginId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				...presentationFields,
			],
		}),
	});
	return {
		dataSources,
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			pageSize: 20,
			sortChoices: [],
			searchFields: ["name"],
			sourceName: "savedView",
			entityIdField: "entityId",
			defaultLayout: "grid" as const,
			ownerPluginIdField: "ownerPluginId",
			entitySchemaSlugField: "entitySchemaSlug",
			layouts: ["grid", "list", "table"] as const,
			tableColumns: [
				...(image === null
					? []
					: [{ label: "Image", field: "image", displayKind: "managed-asset" as const }]),
				...columns.map(({ expression: _, ...tableColumn }) => tableColumn),
			],
			addAction: {
				type: "provider-search",
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(entitySchemaSlug) },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			} satisfies AuthoredEntityBrowserAddAction,
		},
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
];

const moveColumns = [
	nameColumn,
	{ label: "Type", ...text("type") },
	{ label: "Damage Class", ...text("damageClass") },
	{ label: "Power", ...number("power") },
	{ label: "Accuracy", ...number("accuracy") },
	{ label: "PP", ...number("pp") },
	{ label: "Priority", ...number("priority") },
	{ label: "Generation", ...text("generation") },
];

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
			pokemonPresentationSource().fields,
		),
	},
	{
		icon: "zap",
		sortOrder: 1,
		name: "All Moves",
		slug: "all-moves",
		...buildDefinition("move", ascending(name), null, moveColumns, movePresentationSource().fields),
	},
] as const;
