import { column, field, table } from "@ryot-app/ryotql";
import { buildSavedViewLayoutProjections } from "@ryot-app/ryotql-recipes/saved-views";

import { slugify } from "../backend/contracts/slug";
import { mediaPluginSlug } from "../shared/media-schema-slugs";
import { defaultMediaSavedViewRecipe } from "./query-recipes";
import { mediaEntitySchemas } from "./schemas/entity";
import { buildViewExpressions } from "./view-helpers";

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
		const expressions = buildViewExpressions(view.entitySchemaSlug);
		const projections = buildSavedViewLayoutProjections({
			table: { ...expressions.table, entity },
		});
		const fields = [
			...projections.table.fields,
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		];
		return {
			sortOrder,
			name: view.name,
			slug: view.slug,
			icon: schema.icon,
			pluginSlug: mediaPluginSlug,
			renderer: { kind: "kernel", name: "entity-browser" } as const,
			dataSources: defaultMediaSavedViewRecipe({
				fields,
				schemas: [view.entitySchemaSlug],
				layout: { type: "table", mapping: projections.table.mappings },
			}).document,
			settings: {
				pageSize: 20,
				sortChoices: [],
				defaultLayout: "grid",
				sourceName: "savedView",
				searchFields: ["column0"],
				entityIdField: "entityId",
				layouts: ["grid", "list", "table"],
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
				addAction: {
					type: "provider-search",
					ownerPluginId: mediaPluginSlug,
					entitySchemaSlug: view.entitySchemaSlug,
				},
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
	});
};
