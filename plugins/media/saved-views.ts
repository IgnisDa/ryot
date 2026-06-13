import { column, table } from "@ryot-app/ryotql";
import { buildSavedViewLayoutProjections } from "@ryot-app/ryotql-recipes/saved-views";

import { mediaEntitySchemas } from "./backend/schemas/entity-schemas";
import { slugify } from "./backend/shared/slug";
import { buildViewExpressions } from "./backend/shared/view-helpers";
import { defaultMediaSavedViewRecipe } from "./query-recipes";

const mediaEntitySchemaSlugs = [
	"show",
	"book",
	"movie",
	"music",
	"manga",
	"anime",
	"podcast",
	"audiobook",
	"video-game",
	"comic-book",
	"book-group",
	"movie-group",
	"music-group",
	"visual-novel",
	"audiobook-group",
	"comic-book-group",
	"video-game-group",
] as const;

const mediaViewName: Record<(typeof mediaEntitySchemaSlugs)[number], string> = {
	book: "All Books",
	show: "All Shows",
	anime: "All Anime",
	manga: "All Manga",
	music: "All Music",
	movie: "All Movies",
	podcast: "All Podcasts",
	audiobook: "All Audiobooks",
	"book-group": "All Book Series",
	"comic-book": "All Comic Books",
	"video-game": "All Video Games",
	"movie-group": "All Movie Series",
	"music-group": "All Music Albums",
	"visual-novel": "All Visual Novels",
	"audiobook-group": "All Audiobook Series",
	"comic-book-group": "All Comic Book Series",
	"video-game-group": "All Video Game Franchises",
};

export const mediaSavedViews = () => {
	const schemas = new Map(mediaEntitySchemas().map((schema) => [schema.slug, schema]));
	const entity = table("entity", "entity");
	const definitions = [
		{ name: "All Persons", slug: "all-persons", entitySchemaSlug: "person" },
		{ name: "All Companies", slug: "all-companies", entitySchemaSlug: "company" },
		...mediaEntitySchemaSlugs.map((entitySchemaSlug) => ({
			entitySchemaSlug,
			name: mediaViewName[entitySchemaSlug],
			slug: slugify(mediaViewName[entitySchemaSlug]),
		})),
	] as const;

	return definitions.map((view, sortOrder) => {
		const schema = schemas.get(view.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing media entity schema: ${view.entitySchemaSlug}`);
		}
		const entityId = column(entity, "id");
		const expressions = buildViewExpressions(view.entitySchemaSlug, schema.name);
		const projections = buildSavedViewLayoutProjections({
			table: { entityId, ...expressions.table },
			grid: { entityId, card: expressions.grid },
			list: { entityId, card: expressions.list },
		});
		return {
			sortOrder,
			name: view.name,
			slug: view.slug,
			icon: schema.icon,
			pluginSlug: "media",
			entitySchemaSlug: view.entitySchemaSlug,
			layouts: {
				grid: {
					...projections.grid.mappings,
					queryDocument: defaultMediaSavedViewRecipe({
						fields: projections.grid.fields,
						schemas: [view.entitySchemaSlug],
						layout: { type: "card", mapping: projections.grid.mappings },
					}).document,
				},
				list: {
					...projections.list.mappings,
					queryDocument: defaultMediaSavedViewRecipe({
						fields: projections.list.fields,
						schemas: [view.entitySchemaSlug],
						layout: { type: "card", mapping: projections.list.mappings },
					}).document,
				},
				table: {
					...projections.table.mappings,
					queryDocument: defaultMediaSavedViewRecipe({
						fields: projections.table.fields,
						schemas: [view.entitySchemaSlug],
						layout: { type: "table", mapping: projections.table.mappings },
					}).document,
				},
			},
		};
	});
};
