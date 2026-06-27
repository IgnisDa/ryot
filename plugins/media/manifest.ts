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
				builtinMediaEntitySchemaSlugs.some((slug) => slug === targetEntitySchemaSlug));
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

const stringSetting = (label: string, description: string, required = true, secret = false) => ({
	type: "string" as const,
	label,
	description,
	...(secret ? { secret: true as const } : {}),
	...(required ? { validation: { required: true as const } } : {}),
});
const kindSetting = (kind: string) => ({
	options: [kind],
	defaultValue: kind,
	type: "enum" as const,
	label: "Provider kind",
	validation: { required: true as const },
	description: "Integration provider discriminator",
});
const providerSettings = (kind: string, fields = {}) => ({
	fields: { kind: kindSetting(kind), ...fields },
});
const integrationProviders = [
	{
		lot: "sink",
		slug: "plex_sink",
		name: "Plex sink",
		scriptSlug: "integration.plex-sink",
		description: "Receive Plex playback webhooks",
		settingsSchema: providerSettings("plex_sink", {
			username: stringSetting("Username", "Only process playback for this Plex user", false),
		}),
	},
	{
		lot: "sink",
		slug: "jellyfin_sink",
		name: "Jellyfin sink",
		scriptSlug: "integration.jellyfin-sink",
		description: "Receive Jellyfin playback webhooks",
		settingsSchema: providerSettings("jellyfin_sink", {
			username: stringSetting("Username", "Only process playback for this Jellyfin user", false),
			metadataProvider: {
				type: "enum",
				defaultValue: "tmdb",
				options: ["tmdb", "tvdb"],
				label: "Metadata provider",
				description: "Provider used to identify Jellyfin media",
			},
		}),
	},
	{
		lot: "sink",
		slug: "emby",
		name: "Emby",
		scriptSlug: "integration.emby",
		description: "Receive Emby playback webhooks",
		settingsSchema: providerSettings("emby"),
	},
	{
		lot: "sink",
		slug: "kodi",
		name: "Kodi",
		scriptSlug: "integration.kodi",
		description: "Receive Kodi playback webhooks",
		settingsSchema: providerSettings("kodi"),
	},
	{
		lot: "sink",
		slug: "ryot_browser_extension",
		name: "Ryot browser extension",
		scriptSlug: "integration.browser-extension",
		description: "Receive playback from the Ryot browser extension",
		settingsSchema: providerSettings("ryot_browser_extension", {
			disabledSites: {
				type: "array",
				label: "Disabled sites",
				description: "Sites ignored by the browser extension",
				items: stringSetting("Site", "Hostname to ignore", false),
			},
		}),
	},
	{
		lot: "sink",
		slug: "generic_json",
		name: "Generic JSON",
		scriptSlug: "integration.generic-json",
		description: "Receive generic JSON playback webhooks",
		settingsSchema: providerSettings("generic_json"),
	},
	{
		lot: "yank",
		slug: "komga",
		name: "Komga",
		scriptSlug: "integration.komga",
		description: "Import progress and ownership from Komga",
		settingsSchema: providerSettings("komga", {
			baseUrl: stringSetting("Base URL", "Komga instance URL"),
			apiKey: stringSetting("API key", "Komga API key", true, true),
		}),
	},
	{
		lot: "yank",
		slug: "plex_yank",
		name: "Plex yank",
		scriptSlug: "integration.plex-yank",
		description: "Import watched media and ownership from Plex",
		settingsSchema: providerSettings("plex_yank", {
			baseUrl: stringSetting("Base URL", "Plex instance URL"),
			token: stringSetting("Token", "Plex access token", true, true),
		}),
	},
	{
		lot: "yank",
		slug: "audiobookshelf",
		name: "Audiobookshelf",
		scriptSlug: "integration.audiobookshelf",
		description: "Import finished media and ownership from Audiobookshelf",
		settingsSchema: providerSettings("audiobookshelf", {
			baseUrl: stringSetting("Base URL", "Audiobookshelf instance URL"),
			token: stringSetting("Token", "Audiobookshelf access token", true, true),
		}),
	},
	{
		lot: "yank",
		slug: "youtube_music",
		name: "YouTube Music",
		scriptSlug: "integration.youtube-music",
		description: "Import listening history from YouTube Music",
		settingsSchema: providerSettings("youtube_music", {
			timezone: stringSetting("Timezone", "Timezone used for daily history synchronization"),
			authCookie: stringSetting(
				"Authentication cookie",
				"YouTube Music authentication cookie",
				true,
				true,
			),
		}),
	},
	{
		lot: "push",
		slug: "radarr",
		name: "Radarr",
		description: "Push collection movies to Radarr",
		settingsSchema: providerSettings("radarr", {
			baseUrl: stringSetting("Base URL", "Radarr instance URL"),
			apiKey: stringSetting("API key", "Radarr API key", true, true),
			profileId: stringSetting("Profile ID", "Radarr quality profile ID"),
			rootFolderPath: stringSetting("Root folder path", "Radarr root folder path"),
			syncCollectionIds: {
				type: "array",
				label: "Collections",
				description: "Collection IDs synchronized to Radarr",
				items: stringSetting("Collection ID", "Collection ID", false),
			},
			tagIds: {
				type: "array",
				label: "Tag IDs",
				description: "Radarr tag IDs",
				items: { type: "integer", label: "Tag ID", description: "Radarr tag ID" },
			},
		}),
	},
	{
		lot: "push",
		slug: "sonarr",
		name: "Sonarr",
		description: "Push collection shows to Sonarr",
		settingsSchema: providerSettings("sonarr", {
			baseUrl: stringSetting("Base URL", "Sonarr instance URL"),
			apiKey: stringSetting("API key", "Sonarr API key", true, true),
			profileId: stringSetting("Profile ID", "Sonarr quality profile ID"),
			rootFolderPath: stringSetting("Root folder path", "Sonarr root folder path"),
			syncCollectionIds: {
				type: "array",
				label: "Collections",
				description: "Collection IDs synchronized to Sonarr",
				items: stringSetting("Collection ID", "Collection ID", false),
			},
			tagIds: { type: "integer", label: "Tag ID", description: "Sonarr tag ID" },
		}),
	},
	{
		lot: "push",
		slug: "jellyfin_push",
		name: "Jellyfin push",
		description: "Update watched state in Jellyfin",
		settingsSchema: providerSettings("jellyfin_push", {
			baseUrl: stringSetting("Base URL", "Jellyfin instance URL"),
			username: stringSetting("Username", "Jellyfin username"),
			password: stringSetting("Password", "Jellyfin password", false, true),
		}),
	},
] as const;

export const mediaPlugin = definePlugin({
	boot: [],
	entitySchemas,
	relationshipSchemas,
	integrationProviders,
	scripts: mediaScripts,
	providers: mediaProviders,
	savedViews: mediaSavedViews(),
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	importSources: [
		{
			lot: "single",
			input: "file",
			slug: "netflix",
			name: "Netflix",
			workflowSlug: "import",
			allowedFileExtensions: ["zip"],
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
			description: "Import viewing activity, ratings, and watchlist entries from Netflix",
		},
		{
			lot: "single",
			input: "file",
			slug: "goodreads",
			name: "Goodreads",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			allowedFileExtensions: ["csv"],
			description: "Import books, reading history, reviews, and shelves from Goodreads",
		},
		{
			lot: "single",
			input: "file",
			slug: "storygraph",
			name: "StoryGraph",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			allowedFileExtensions: ["csv"],
			description: "Import books, reading history, reviews, and tags from StoryGraph",
		},
		{
			lot: "single",
			input: "file",
			slug: "hardcover",
			name: "Hardcover",
			workflowSlug: "import",
			allowedFileExtensions: ["csv"],
			requiredAppConfigKeys: ["books.hardcoverApiKey"],
			description: "Import books, reading history, reviews, lists, and ownership from Hardcover",
		},
		{
			lot: "single",
			input: "file",
			slug: "anilist",
			name: "AniList",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			allowedFileExtensions: ["json"],
			description:
				"Import anime, manga, progress, reviews, favorites, and custom lists from AniList",
		},
		{
			slug: "trakt",
			name: "Trakt",
			input: "payload",
			workflowSlug: "import",
			requiredAppConfigKeys: ["server.traktClientId"],
			description:
				"Import movies, shows, history, ratings, watchlist, lists, and ownership from Trakt",
		},
		{
			slug: "imdb",
			name: "IMDb",
			input: "file",
			lot: "single",
			workflowSlug: "import",
			allowedFileExtensions: ["csv"],
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
			description: "Import movie and show watchlist entries from IMDb",
		},
		{
			slug: "igdb",
			name: "IGDB",
			lot: "single",
			input: "file",
			workflowSlug: "import",
			allowedFileExtensions: ["csv"],
			requiredAppConfigKeys: ["videoGames.twitchClientId", "videoGames.twitchClientSecret"],
			description: "Import video games into a selected collection from IGDB",
		},
		{
			lot: "single",
			input: "file",
			slug: "grouvee",
			name: "Grouvee",
			workflowSlug: "import",
			allowedFileExtensions: ["csv"],
			requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
			description: "Import video games, play history, reviews, ratings, and shelves from Grouvee",
		},
		{
			lot: "single",
			input: "file",
			slug: "watcharr",
			name: "Watcharr",
			workflowSlug: "import",
			allowedFileExtensions: ["json"],
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
			description: "Import movies, shows, episode history, reviews, and collections from Watcharr",
		},
		{
			lot: "named",
			input: "file",
			slug: "movary",
			name: "Movary",
			workflowSlug: "import",
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
			description: "Import movie history, ratings, and watchlist entries from Movary",
			artifacts: [
				{
					required: true,
					key: "historyFilePath",
					allowedFileExtensions: ["csv"],
					uploadTokenField: "historyUploadToken",
				},
				{
					required: true,
					key: "ratingsFilePath",
					allowedFileExtensions: ["csv"],
					uploadTokenField: "ratingsUploadToken",
				},
				{
					required: true,
					key: "watchlistFilePath",
					allowedFileExtensions: ["csv"],
					uploadTokenField: "watchlistUploadToken",
				},
			],
		},
		{
			lot: "named",
			input: "file",
			slug: "myanimelist",
			name: "MyAnimeList",
			workflowSlug: "import",
			requiredAppConfigKeys: ["animeAndManga.malClientId"],
			description: "Import anime and manga history, progress, ratings, and status from MyAnimeList",
			artifacts: [
				{
					required: false,
					key: "animeFilePath",
					uploadTokenField: "animeUploadToken",
					allowedFileExtensions: ["gz", "xml"],
				},
				{
					required: false,
					key: "mangaFilePath",
					uploadTokenField: "mangaUploadToken",
					allowedFileExtensions: ["gz", "xml"],
				},
			],
		},
		{
			input: "payload",
			slug: "jellyfin",
			name: "Jellyfin",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			description: "Import watched movies, episodes, and favorites from Jellyfin",
		},
		{
			slug: "plex",
			name: "Plex",
			input: "payload",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			description: "Import watched movies and episodes from Plex",
		},
		{
			input: "payload",
			slug: "audiobookshelf",
			name: "Audiobookshelf",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			description: "Import finished audiobooks, ebooks, podcasts, and library collections",
		},
		{
			input: "payload",
			name: "MediaTracker",
			slug: "media_tracker",
			workflowSlug: "import",
			requiredAppConfigKeys: [],
			description:
				"Import media history, reviews, lifecycle states, and collections from MediaTracker",
		},
	],
	workflows: [
		{ slug: "import", scriptSlug: "workflow.media-import" },
		{ slug: "media-monitoring-sweep", scriptSlug: "workflow.media-monitoring-sweep" },
		{ slug: "media-import-population", scriptSlug: "workflow.media-import-population" },
		{ slug: "media-import-resolution", scriptSlug: "workflow.media-import-resolution" },
	],
	crons: [
		{
			lot: "workflow",
			slug: "media-monitoring",
			schedule: { tier: "infrequent" },
			workflowSlug: "media-monitoring-sweep",
			description: "Refresh monitored provider-backed media",
		},
		{
			lot: "script",
			slug: "media-trending",
			scriptSlug: "media-trending",
			schedule: { tier: "infrequent" },
			description: "Refresh global media trending rankings",
		},
	],
	operations: [
		{
			auth: "user",
			slug: "media-monitoring-status",
			description: "Read media monitoring status",
			scriptSlug: "operation.media-monitoring-status",
		},
		{
			auth: "user",
			slug: "media-monitoring-enable",
			description: "Enable media monitoring",
			scriptSlug: "operation.media-monitoring-enable",
		},
		{
			auth: "user",
			slug: "media-monitoring-disable",
			description: "Disable media monitoring",
			scriptSlug: "operation.media-monitoring-disable",
		},
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
