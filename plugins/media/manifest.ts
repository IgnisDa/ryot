import { definePlugin } from "@ryot/plugin-kit/manifest";

import { mediaSavedViews } from "./saved-views";
import { mediaEntitySchemas } from "./schemas/entity-schemas";
import { builtinMediaEntitySchemaSlugs } from "./schemas/media-schema-slugs";
import { builtinRelationshipSchemas } from "./schemas/relationship-schemas";
import { mediaSignalSchemas } from "./schemas/signal-schemas";
import { mediaScripts } from "./script-catalog";

const entitySchemas = mediaEntitySchemas();
const relationshipSchemas = builtinRelationshipSchemas();
const eventSlugs = (eventSlug: string) =>
	entitySchemas.flatMap((schema) =>
		schema.eventSchemas.some(({ slug }) => slug === eventSlug)
			? [`${schema.slug}:${eventSlug}`]
			: [],
	);
const creditRelationshipSlugs = relationshipSchemas
	.filter(({ sourceEntitySchemaSlug, targetEntitySchemaSlug }) => {
		const isCreditSource =
			sourceEntitySchemaSlug === "person" || sourceEntitySchemaSlug === "company";
		const isCreditTarget =
			targetEntitySchemaSlug !== null &&
			(targetEntitySchemaSlug.endsWith("-group") ||
				builtinMediaEntitySchemaSlugs.includes(targetEntitySchemaSlug));
		return isCreditSource && isCreditTarget;
	})
	.map(({ slug }) => slug);
type ProviderOperation = "details" | "resolve" | "search" | "translate";
const provider = (
	slug: string,
	name: string,
	source: string,
	operations: readonly ["details", ...ProviderOperation[]],
	canonicalLanguage?: string,
) => ({
	name,
	slug,
	information: canonicalLanguage ? { source, canonicalLanguage } : { source },
	operations: {
		details: `${slug}.details`,
		...(operations.includes("resolve") ? { resolve: `${slug}.resolve` } : {}),
		...(operations.includes("search") ? { search: `${slug}.search` } : {}),
		...(operations.includes("translate") ? { translate: `${slug}.translate` } : {}),
	},
});
const mediaProviders = [
	provider("anime.anilist", "Anilist", "anilist", ["details", "search", "translate"], "en"),
	provider("anime.myanimelist", "MyAnimeList", "myanimelist", ["details", "search"]),
	provider("audiobook-group.audible", "Audible", "audible", ["details", "search"]),
	provider("audiobook.audible", "Audible", "audible", ["details", "search"]),
	provider("book-group.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("book.google-books", "Google Books", "google-books", ["details", "resolve", "search"]),
	provider("book.hardcover", "Hardcover", "hardcover", ["details", "resolve", "search"]),
	provider("book.openlibrary", "OpenLibrary", "openlibrary", ["details", "resolve", "search"]),
	provider("comic-book-group.metron", "Metron", "metron", ["details", "search"]),
	provider("comic-book.metron", "Metron", "metron", ["details", "search"]),
	provider("company.anilist", "Anilist", "anilist", ["details", "search"]),
	provider("company.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("company.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("company.igdb", "IGDB", "igdb", ["details", "search"]),
	provider("company.tmdb", "TMDB", "tmdb", ["details", "search"]),
	provider("company.tvdb", "TVDB", "tvdb", ["details", "search"]),
	provider("company.vndb", "VNDB", "vndb", ["details", "search"]),
	provider("manga.anilist", "Anilist", "anilist", ["details", "search", "translate"], "en"),
	provider("manga.manga-updates", "MangaUpdates", "manga-updates", ["details", "search"]),
	provider("manga.myanimelist", "MyAnimeList", "myanimelist", ["details", "search"]),
	provider("movie-group.tmdb", "TMDB", "tmdb", ["details", "search", "translate"], "en"),
	provider("movie-group.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("movie.tmdb", "TMDB", "tmdb", ["details", "resolve", "search", "translate"], "en"),
	provider("movie.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("music-group.music-brainz", "MusicBrainz", "music-brainz", ["details", "search"]),
	provider("music-group.spotify", "Spotify", "spotify", ["details", "search"]),
	provider(
		"music-group.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider("music.music-brainz", "MusicBrainz", "music-brainz", ["details", "search"]),
	provider("music.spotify", "Spotify", "spotify", ["details", "search"]),
	provider(
		"music.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider("person.anilist", "Anilist", "anilist", ["details", "search"]),
	provider("person.audible", "Audible", "audible", ["details", "search"]),
	provider("person.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("person.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("person.manga-updates", "MangaUpdates", "manga-updates", ["details", "search"]),
	provider("person.metron", "Metron", "metron", ["details", "search"]),
	provider("person.music-brainz", "MusicBrainz", "music-brainz", ["details", "search"]),
	provider("person.openlibrary", "OpenLibrary", "openlibrary", ["details"]),
	provider("person.spotify", "Spotify", "spotify", ["details", "search"]),
	provider("person.tmdb", "TMDB", "tmdb", ["details", "search", "translate"], "en"),
	provider("person.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider(
		"person.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider("podcast.itunes", "iTunes", "itunes", ["details", "search", "translate"], "en"),
	provider("podcast.listennotes", "Listen Notes", "listennotes", ["details", "search"]),
	provider("show.tmdb", "TMDB", "tmdb", ["details", "resolve", "search", "translate"], "en"),
	provider("show.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("video-game-group.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("video-game-group.igdb", "IGDB", "igdb", ["details", "search"]),
	provider("video-game.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("video-game.igdb", "IGDB", "igdb", ["details", "search"]),
	provider("visual-novel.vndb", "VNDB", "vndb", ["details", "search"]),
] as const;
const schemaProviderLinks = (
	[
		["show", "show.tmdb"],
		["show", "show.tvdb"],
		["movie", "movie.tvdb"],
		["movie", "movie.tmdb"],
		["music", "music.spotify"],
		["manga", "manga.anilist"],
		["anime", "anime.anilist"],
		["book", "book.hardcover"],
		["book", "book.openlibrary"],
		["book", "book.google-books"],
		["podcast", "podcast.itunes"],
		["music", "music.music-brainz"],
		["anime", "anime.myanimelist"],
		["manga", "manga.myanimelist"],
		["manga", "manga.manga-updates"],
		["music", "music.youtube-music"],
		["video-game", "video-game.igdb"],
		["audiobook", "audiobook.audible"],
		["podcast", "podcast.listennotes"],
		["comic-book", "comic-book.metron"],
		["visual-novel", "visual-novel.vndb"],
		["video-game", "video-game.giant-bomb"],
		["person", "person.tmdb"],
		["person", "person.tvdb"],
		["person", "person.metron"],
		["person", "person.anilist"],
		["person", "person.audible"],
		["person", "person.spotify"],
		["person", "person.hardcover"],
		["person", "person.music-brainz"],
		["person", "person.openlibrary"],
		["person", "person.youtube-music"],
		["person", "person.giant-bomb"],
		["person", "person.manga-updates"],
		["company", "company.igdb"],
		["company", "company.tmdb"],
		["company", "company.tvdb"],
		["company", "company.vndb"],
		["company", "company.anilist"],
		["company", "company.hardcover"],
		["company", "company.giant-bomb"],
		["movie-group", "movie-group.tmdb"],
		["movie-group", "movie-group.tvdb"],
		["book-group", "book-group.hardcover"],
		["music-group", "music-group.spotify"],
		["music-group", "music-group.music-brainz"],
		["music-group", "music-group.youtube-music"],
		["video-game-group", "video-game-group.igdb"],
		["audiobook-group", "audiobook-group.audible"],
		["comic-book-group", "comic-book-group.metron"],
		["video-game-group", "video-game-group.giant-bomb"],
	] as const
).map(([entitySchemaSlug, providerSlug]) => ({ entitySchemaSlug, providerSlug }));

export const mediaPlugin = definePlugin({
	boot: [],
	importSources: [],
	integrationProviders: [],
	providers: mediaProviders,
	workflows: [
		{ slug: "media-import-population", scriptSlug: "workflow.media-import-population" },
		{ slug: "media-import-resolution", scriptSlug: "workflow.media-import-resolution" },
	],
	crons: [
		{
			slug: "media-trending",
			schedule: "0 0 * * *",
			scriptSlug: "media-trending",
			description: "Refresh global media trending rankings daily",
		},
	],
	operations: [
		{
			auth: "integration",
			slug: "metadata-lookup",
			scriptSlug: "operation.metadata-lookup",
			description: "Match browser extension titles to TMDB movies and shows",
		},
		{
			auth: "user",
			slug: "resolve-episodes",
			scriptSlug: "operation.resolve-episodes",
			description: "Resolve show and podcast episode references to entity ids",
		},
	],
	metadata: {
		icon: "film",
		name: "Media",
		slug: "media",
		version: "1.0.0",
		accentColor: "#5B7FFF",
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
	scripts: mediaScripts,
	entitySchemas,
	savedViews: mediaSavedViews(),
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	relationshipSchemas,
	bindings: {
		schemaProviderLinks,
		signalAutomations: [],
		entityAutomations: [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].map(
			(entitySchemaSlug) => ({
				entitySchemaSlug,
				operation: "update" as const,
				scriptSlug: "automation.media-entity-updated",
			}),
		),
		eventAutomations: [
			...[...eventSlugs("review"), "collection:review"].map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "automation.review-created",
			})),
			...eventSlugs("progress").flatMap((eventSchemaSlug) => [
				{
					eventSchemaSlug,
					kind: "subscription" as const,
					scriptSlug: "trigger.auto-complete-on-full-progress",
					metadata: { inheritedProperties: ["consumedOn"] },
				},
				{
					position: 100,
					eventSchemaSlug,
					kind: "policy" as const,
					scriptSlug: "trigger.integration-progress-policy",
				},
			]),
			{
				kind: "subscription",
				eventSchemaSlug: "collection:add-entity-to-collection",
				scriptSlug: "trigger.radarr-push",
			},
			{
				kind: "subscription",
				eventSchemaSlug: "collection:add-entity-to-collection",
				scriptSlug: "trigger.sonarr-push",
			},
			...eventSlugs("complete").map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "trigger.jellyfin-push",
			})),
		],
		relationshipAutomations: [
			...[
				"show-to-show-season",
				"show-season-to-show-episode",
				"podcast-to-podcast-episode",
			].flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					scriptSlug: "automation.media-relationship-sync",
				})),
			),
			...creditRelationshipSlugs.flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					scriptSlug: "automation.media-association",
				})),
			),
		],
	},
});

export default mediaPlugin;
