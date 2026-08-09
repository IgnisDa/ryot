import { ascending, castJson, castNumber, column, jsonPath, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

const entity = table("entity", "entity");
const property = (name: string) => jsonPath(column(entity, "properties"), name);
const json = (name: string) => ({ expression: property(name), displayKind: "json" as const });
const number = (name: string) => ({ expression: property(name), displayKind: "number" as const });

const card = {
	primaryMetadata: json("types"),
	callout: number("baseExperience"),
	overline: number("pokedexNumber"),
	secondaryMetadata: json("abilities"),
	title: column(entity, "name"),
	image: castJson(jsonPath(column(entity, "properties"), "images", 0)),
};

const projections = buildSavedViewLayoutProjections({
	grid: { card, entityId: column(entity, "id") },
	list: { card, entityId: column(entity, "id") },
	table: {
		image: card.image,
		entityId: column(entity, "id"),
		columns: [
			{ label: "Name", expression: column(entity, "name"), displayKind: "text" },
			{ label: "Pokedex Number", ...number("pokedexNumber") },
			{ label: "Types", ...json("types") },
			{ label: "Abilities", ...json("abilities") },
			{ label: "Height (dm)", ...number("height") },
			{ label: "Weight (hg)", ...number("weight") },
			{ label: "Base Experience", ...number("baseExperience") },
		],
	},
});

const document = (layout: "grid" | "list" | "table") =>
	savedViewRecipe({
		source: {
			type: "generated",
			entitySchemaSlugs: ["pokemon"],
			fields: projections[layout].fields,
			orderBy: [ascending(castNumber(property("pokedexNumber")))],
		},
		layout:
			layout === "table"
				? { type: "table", mapping: projections.table.mappings }
				: { type: "card", mapping: projections[layout].mappings },
	}).document;

export const fixtureSavedViews = [
	{
		sortOrder: 0,
		icon: "sparkles",
		name: "All Pokemon",
		slug: "all-pokemon",
		pluginSlug: "fixture",
		entitySchemaSlug: "pokemon",
		layouts: {
			grid: { ...projections.grid.mappings, queryDocument: document("grid") },
			list: { ...projections.list.mappings, queryDocument: document("list") },
			table: { ...projections.table.mappings, queryDocument: document("table") },
		},
	},
] as const;
