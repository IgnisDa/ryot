import { ascending, castJson, castNumber, column, jsonPath, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

const entity = table("entity", "entity");
const name = column(entity, "name");
const entityId = column(entity, "id");
const property = (key: string) => jsonPath(column(entity, "properties"), key);
const json = (key: string) => ({ expression: property(key), displayKind: "json" as const });
const text = (key: string) => ({ expression: property(key), displayKind: "text" as const });
const number = (key: string) => ({ expression: property(key), displayKind: "number" as const });

const buildLayouts = (
	entitySchemaSlug: string,
	orderBy: ReturnType<typeof ascending>,
	projections: ReturnType<typeof buildSavedViewLayoutProjections>,
) => {
	const document = (layout: "grid" | "list" | "table") =>
		savedViewRecipe({
			source: {
				type: "generated",
				orderBy: [orderBy],
				fields: projections[layout].fields,
				entitySchemaSlugs: [entitySchemaSlug],
			},
			layout:
				layout === "table"
					? { type: "table", mapping: projections.table.mappings }
					: { type: "card", mapping: projections[layout].mappings },
		}).document;
	return {
		grid: { ...projections.grid.mappings, queryDocument: document("grid") },
		list: { ...projections.list.mappings, queryDocument: document("list") },
		table: { ...projections.table.mappings, queryDocument: document("table") },
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
	grid: { entityId, card: pokemonCard },
	list: { entityId, card: pokemonCard },
	table: {
		entityId,
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
	grid: { entityId, card: moveCard },
	list: { entityId, card: moveCard },
	table: {
		entityId,
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
		entitySchemaSlug: "pokemon",
		layouts: buildLayouts(
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
		entitySchemaSlug: "move",
		layouts: buildLayouts("move", ascending(name), moveProjections),
	},
] as const;
