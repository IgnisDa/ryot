import { column, table } from "@ryot/ryotql";
import { buildSavedViewLayoutProjections } from "@ryot/ryotql-recipes/saved-views";

import { buildDefaultMediaSavedViewQueryDocument } from "./query-recipes";
import { mediaEntitySchemas } from "./schemas/entity-schemas";
import { slugify } from "./shared/slug";
import { buildViewExpressions } from "./shared/view-helpers";

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

const searchScriptsByEntitySchema: Readonly<Record<string, ReadonlyArray<string>>> = {
	audiobook: ["audiobook.audible.search"],
	"comic-book": ["comic-book.metron.search"],
	"visual-novel": ["visual-novel.vndb.search"],
	"book-group": ["book-group.hardcover.search"],
	show: ["show.tmdb.search", "show.tvdb.search"],
	movie: ["movie.tmdb.search", "movie.tvdb.search"],
	"audiobook-group": ["audiobook-group.audible.search"],
	"comic-book-group": ["comic-book-group.metron.search"],
	anime: ["anime.anilist.search", "anime.myanimelist.search"],
	podcast: ["podcast.itunes.search", "podcast.listennotes.search"],
	"movie-group": ["movie-group.tmdb.search", "movie-group.tvdb.search"],
	"video-game": ["video-game.giant-bomb.search", "video-game.igdb.search"],
	book: ["book.google-books.search", "book.hardcover.search", "book.openlibrary.search"],
	manga: ["manga.anilist.search", "manga.manga-updates.search", "manga.myanimelist.search"],
	music: ["music.music-brainz.search", "music.spotify.search", "music.youtube-music.search"],
	"video-game-group": ["video-game-group.giant-bomb.search", "video-game-group.igdb.search"],
	company: [
		"company.anilist.search",
		"company.giant-bomb.search",
		"company.hardcover.search",
		"company.igdb.search",
		"company.tmdb.search",
		"company.tvdb.search",
		"company.vndb.search",
	],
	"music-group": [
		"music-group.music-brainz.search",
		"music-group.spotify.search",
		"music-group.youtube-music.search",
	],
	person: [
		"person.anilist.search",
		"person.audible.search",
		"person.giant-bomb.search",
		"person.hardcover.search",
		"person.manga-updates.search",
		"person.metron.search",
		"person.music-brainz.search",
		"person.spotify.search",
		"person.tmdb.search",
		"person.tvdb.search",
		"person.youtube-music.search",
	],
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
			sandboxScripts: { search: [...(searchScriptsByEntitySchema[view.entitySchemaSlug] ?? [])] },
			layouts: {
				grid: {
					...projections.grid.mappings,
					queryDocument: buildDefaultMediaSavedViewQueryDocument({
						fields: projections.grid.fields,
						schemas: [view.entitySchemaSlug],
					}),
				},
				list: {
					...projections.list.mappings,
					queryDocument: buildDefaultMediaSavedViewQueryDocument({
						fields: projections.list.fields,
						schemas: [view.entitySchemaSlug],
					}),
				},
				table: {
					...projections.table.mappings,
					queryDocument: buildDefaultMediaSavedViewQueryDocument({
						fields: projections.table.fields,
						schemas: [view.entitySchemaSlug],
					}),
				},
			},
		};
	});
};
