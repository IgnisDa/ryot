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
		source: {
			type: "generated",
			orderBy: [orderBy],
			fields: [
				...projections.table.fields,
				field("ownerPluginId", column(entity, "entitySchemaPluginId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			],
			entitySchemaSlugs: [entitySchemaSlug],
		},
		layout: { type: "table", mapping: projections.table.mappings },
	}).document;
	return {
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		dataSources,
		settings: {
			pageSize: 20,
			sourceName: "savedView",
			defaultLayout: "grid" as const,
			layouts: ["grid", "list", "table"] as const,
			entityIdField: "entityId",
			ownerPluginIdField: "ownerPluginId",
			entitySchemaSlugField: "entitySchemaSlug",
			searchFields: ["column0"],
			sortChoices: [],
			tableColumns: projections.table.mappings.columns,
			addAction: { type: "provider-search" as const, ownerPluginId: "fixture", entitySchemaSlug },
		},
	};
};

const pokemonCard = {
	title: name,
	primaryMetadata: json("types"),
	callout: number("baseExperience"),
	overline: number("pokedexNumber"),
	secondaryMetadata: json("abilities"),
	image: castJson(jsonPath(column(entity, "properties"), "images", 0)),
};

const pokemonProjections = buildSavedViewLayoutProjections({
	grid: { entity, card: pokemonCard },
	list: { entity, card: pokemonCard },
	table: {
		entity,
		image: pokemonCard.image,
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

const moveCard = {
	image: null,
	title: name,
	overline: text("type"),
	callout: number("power"),
	primaryMetadata: text("damageClass"),
	secondaryMetadata: text("generation"),
};

const moveProjections = buildSavedViewLayoutProjections({
	grid: { entity, card: moveCard },
	list: { entity, card: moveCard },
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
