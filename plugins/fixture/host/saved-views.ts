import { ascending, castJson, castNumber, column, field, jsonPath, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

const entity = table("entity", "entity");
const name = column(entity, "name");
const property = (key: string) => jsonPath(column(entity, "properties"), key);
const json = (key: string) => ({ expression: property(key), displayKind: "json" as const });
const text = (key: string) => ({ expression: property(key), displayKind: "text" as const });
const number = (key: string) => ({ expression: property(key), displayKind: "number" as const });

const buildDefinition = (
	entitySchemaSlug: string,
	orderBy: ReturnType<typeof ascending>,
	projections: ReturnType<typeof buildSavedViewLayoutProjections>,
) => {
	const dataSources = savedViewRecipe({
		layout: { type: "table", mapping: projections.table.mappings },
		source: {
			type: "generated",
			orderBy: [orderBy],
			entitySchemaSlugs: [entitySchemaSlug],
			fields: [
				...projections.table.fields,
				field("ownerPluginId", column(entity, "entitySchemaPluginId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			],
		},
	}).document;
	return {
		dataSources,
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			pageSize: 20,
			sortChoices: [],
			sourceName: "savedView",
			searchFields: ["column0"],
			entityIdField: "entityId",
			defaultLayout: "grid" as const,
			ownerPluginIdField: "ownerPluginId",
			entitySchemaSlugField: "entitySchemaSlug",
			layouts: ["grid", "list", "table"] as const,
			addAction: { type: "provider-search" as const, ownerPluginId: "fixture", entitySchemaSlug },
			tableColumns: [
				...(projections.table.mappings.imageField === null
					? []
					: [
							{
								label: "Image",
								displayKind: "managed-asset" as const,
								field: projections.table.mappings.imageField,
							},
						]),
				...projections.table.mappings.columns,
			],
		},
	};
};

const pokemonImage = castJson(jsonPath(column(entity, "properties"), "images", 0));

const pokemonProjections = buildSavedViewLayoutProjections({
	table: {
		entity,
		image: pokemonImage,
		columns: [
			{ label: "Name", expression: name, displayKind: "text" },
			{ label: "Pokedex Number", ...number("pokedexNumber") },
			{ label: "Types", ...json("types") },
			{ label: "Abilities", ...json("abilities") },
			{ label: "Height (dm)", ...number("height") },
			{ label: "Weight (hg)", ...number("weight") },
			{ label: "Base Experience", ...number("baseExperience") },
		],
	},
});

const moveProjections = buildSavedViewLayoutProjections({
	table: {
		entity,
		image: null,
		columns: [
			{ label: "Name", expression: name, displayKind: "text" },
			{ label: "Type", ...text("type") },
			{ label: "Damage Class", ...text("damageClass") },
			{ label: "Power", ...number("power") },
			{ label: "Accuracy", ...number("accuracy") },
			{ label: "PP", ...number("pp") },
			{ label: "Priority", ...number("priority") },
			{ label: "Generation", ...text("generation") },
		],
	},
});

export const fixtureSavedViews = [
	{
		sortOrder: 0,
		icon: "sparkles",
		name: "All Pokemon",
		slug: "all-pokemon",
		pluginSlug: "fixture",
		...buildDefinition(
			"pokemon",
			ascending(castNumber(property("pokedexNumber"))),
			pokemonProjections,
		),
	},
	{
		icon: "zap",
		sortOrder: 1,
		name: "All Moves",
		slug: "all-moves",
		pluginSlug: "fixture",
		...buildDefinition("move", ascending(name), moveProjections),
	},
] as const;
