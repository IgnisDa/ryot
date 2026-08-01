import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

import {
	builtinMediaEntitySchemaSlugs,
	mediaLibraryEligibleEntitySchemaSlugs,
} from "../backend/contracts/schema-slugs";
import { mediaConfigSchema } from "./config";
import { mediaSavedViews } from "./saved-views";
import { mediaEntitySchemas } from "./schemas/entity";
import { builtinRelationshipSchemas } from "./schemas/relationship";
import { mediaSignalSchemas } from "./schemas/signal";

const entitySchemas = mediaEntitySchemas();

const relationshipSchemas = builtinRelationshipSchemas();

const importDocs = (page: string) => ({ docsUrl: `https://docs.ryot.io/importing/${page}.html` });

const uploadInputSchema = (
	label: string,
	description: string,
	allowedFileExtensions: string[],
) => ({
	unknownKeys: "strict" as const,
	fields: {
		uploadToken: {
			label,
			position: 0,
			description,
			type: "string" as const,
			format: { kind: "upload" as const, allowedFileExtensions },
			validation: { minLength: 1 as const, required: true as const },
		},
	},
});

const apiKeyInputSchema = (name: string, apiKeyDescription = `${name} API token`) => ({
	unknownKeys: "strict" as const,
	fields: {
		apiUrl: {
			position: 0,
			label: "Server URL",
			type: "string" as const,
			format: { kind: "url" as const },
			description: `${name} server URL`,
			validation: { required: true as const },
		},
		apiKey: {
			position: 1,
			label: "API key",
			secret: true as const,
			type: "string" as const,
			description: apiKeyDescription,
			validation: { minLength: 1, required: true as const },
		},
		allowInsecureConnections: {
			position: 2,
			type: "boolean" as const,
			label: "Allow insecure connections",
			description: "Allow connections with invalid TLS certificates",
		},
	},
});

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

type ProviderOperation = "details" | "resolve" | "search" | "search-options" | "translate";

const provider = (
	rootEntitySchemaSlug: string,
	slug: string,
	name: string,
	source: string,
	operations: readonly ["details", ...ProviderOperation[]],
	canonicalLanguage?: string,
) => ({
	name,
	slug,
	rootEntitySchemaSlug,
	information: canonicalLanguage ? { source, canonicalLanguage } : { source },
	operations: {
		details: `${slug}.details`,
		...(operations.includes("resolve") ? { resolve: `${slug}.resolve` } : {}),
		...(operations.includes("search") ? { search: `${slug}.search` } : {}),
		...(operations.includes("search-options") ? { searchOptions: `${slug}.search-options` } : {}),
		...(operations.includes("translate") ? { translate: `${slug}.translate` } : {}),
	},
});

const mediaProviders = [
	provider(
		"anime",
		"anime.anilist",
		"Anilist",
		"anilist",
		["details", "search", "translate"],
		"en",
	),
	provider("anime", "anime.myanimelist", "MyAnimeList", "myanimelist", ["details", "search"]),
	provider("audiobook-group", "audiobook-group.audible", "Audible", "audible", [
		"details",
		"search",
	]),
	provider("audiobook", "audiobook.audible", "Audible", "audible", ["details", "search"]),
	provider("book-group", "book-group.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("book", "book.google-books", "Google Books", "google-books", [
		"details",
		"resolve",
		"search",
	]),
	provider("book", "book.hardcover", "Hardcover", "hardcover", ["details", "resolve", "search"]),
	provider("book", "book.openlibrary", "OpenLibrary", "openlibrary", [
		"details",
		"resolve",
		"search",
	]),
	provider("comic-book-group", "comic-book-group.metron", "Metron", "metron", [
		"details",
		"search",
	]),
	provider("comic-book", "comic-book.metron", "Metron", "metron", ["details", "search"]),
	provider("company", "company.anilist", "Anilist", "anilist", ["details", "search"]),
	provider("company", "company.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("company", "company.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("company", "company.igdb", "IGDB", "igdb", ["details", "search"]),
	provider("company", "company.tmdb", "TMDB", "tmdb", ["details", "search"]),
	provider("company", "company.tvdb", "TVDB", "tvdb", ["details", "search"]),
	provider(
		"manga",
		"manga.anilist",
		"Anilist",
		"anilist",
		["details", "search", "translate"],
		"en",
	),
	provider("manga", "manga.manga-updates", "MangaUpdates", "manga-updates", ["details", "search"]),
	provider("manga", "manga.myanimelist", "MyAnimeList", "myanimelist", ["details", "search"]),
	provider(
		"movie-group",
		"movie-group.tmdb",
		"TMDB",
		"tmdb",
		["details", "search", "translate"],
		"en",
	),
	provider(
		"movie-group",
		"movie-group.tvdb",
		"TVDB",
		"tvdb",
		["details", "search", "translate"],
		"en",
	),
	provider(
		"movie",
		"movie.tmdb",
		"TMDB",
		"tmdb",
		["details", "resolve", "search", "translate"],
		"en",
	),
	provider("movie", "movie.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("music-group", "music-group.music-brainz", "MusicBrainz", "music-brainz", [
		"details",
		"search",
	]),
	provider("music-group", "music-group.spotify", "Spotify", "spotify", ["details", "search"]),
	provider(
		"music-group",
		"music-group.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider("music", "music.music-brainz", "MusicBrainz", "music-brainz", ["details", "search"]),
	provider("music", "music.spotify", "Spotify", "spotify", ["details", "search"]),
	provider(
		"music",
		"music.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider("person", "person.anilist", "Anilist", "anilist", ["details", "search"]),
	provider("person", "person.audible", "Audible", "audible", ["details", "search"]),
	provider("person", "person.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("person", "person.hardcover", "Hardcover", "hardcover", ["details", "search"]),
	provider("person", "person.manga-updates", "MangaUpdates", "manga-updates", [
		"details",
		"search",
	]),
	provider("person", "person.metron", "Metron", "metron", ["details", "search"]),
	provider("person", "person.music-brainz", "MusicBrainz", "music-brainz", ["details", "search"]),
	provider("person", "person.openlibrary", "OpenLibrary", "openlibrary", ["details"]),
	provider("person", "person.spotify", "Spotify", "spotify", ["details", "search"]),
	provider("person", "person.tmdb", "TMDB", "tmdb", ["details", "search", "translate"], "en"),
	provider("person", "person.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("person", "person.vndb", "VNDB", "vndb", ["details", "search"]),
	provider(
		"person",
		"person.youtube-music",
		"YouTube Music",
		"youtube-music",
		["details", "search", "translate"],
		"en",
	),
	provider(
		"podcast",
		"podcast.itunes",
		"iTunes",
		"itunes",
		["details", "search", "translate"],
		"en",
	),
	provider("podcast", "podcast.listennotes", "Listen Notes", "listennotes", ["details", "search"]),
	provider(
		"show",
		"show.tmdb",
		"TMDB",
		"tmdb",
		["details", "resolve", "search", "translate"],
		"en",
	),
	provider("show", "show.tvdb", "TVDB", "tvdb", ["details", "search", "translate"], "en"),
	provider("video-game-group", "video-game-group.giant-bomb", "GiantBomb", "giant-bomb", [
		"details",
		"search",
	]),
	provider("video-game-group", "video-game-group.igdb", "IGDB", "igdb", ["details", "search"]),
	provider("video-game", "video-game.giant-bomb", "GiantBomb", "giant-bomb", ["details", "search"]),
	provider("video-game", "video-game.igdb", "IGDB", "igdb", [
		"details",
		"search",
		"search-options",
	]),
	provider("visual-novel", "visual-novel.vndb", "VNDB", "vndb", ["details", "search"]),
] as const;

const stringSetting = (label: string, description: string, required = true, secret = false) => ({
	label,
	description,
	type: "string" as const,
	...(secret ? { secret: true as const } : {}),
	...(required ? { validation: { required: true as const } } : {}),
});

const kindSetting = (kind: string) => ({
	defaultValue: kind,
	type: "enum" as const,
	label: "Provider kind",
	validation: { required: true as const },
	description: "Integration provider discriminator",
	choices: { kind: "static" as const, values: [{ value: kind }] },
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
				label: "Metadata provider",
				description: "Provider used to identify Jellyfin media",
				choices: { kind: "static", values: [{ value: "tmdb" }, { value: "tvdb" }] },
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
		requiresProKey: true,
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
		requiresProKey: true,
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
			profileId: stringSetting("Profile ID", "Radarr quality profile ID"),
			rootFolderPath: stringSetting("Root folder path", "Radarr root folder path"),
			apiKey: stringSetting("API key", "Radarr API key", true, true),
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
			profileId: stringSetting("Profile ID", "Sonarr quality profile ID"),
			rootFolderPath: stringSetting("Root folder path", "Sonarr root folder path"),
			apiKey: stringSetting("API key", "Sonarr API key", true, true),
			tagIds: {
				type: "array",
				label: "Tag IDs",
				description: "Sonarr tag IDs",
				items: { type: "integer", label: "Tag ID", description: "Sonarr tag ID" },
			},
			syncCollectionIds: {
				type: "array",
				label: "Collections",
				description: "Collection IDs synchronized to Sonarr",
				items: stringSetting("Collection ID", "Collection ID", false),
			},
		}),
	},
	{
		lot: "push",
		requiresProKey: true,
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
	providers: mediaProviders,
	savedViews: mediaSavedViews(),
	configSchema: mediaConfigSchema,
	client: {
		apiVersion: 1,
		entry: "client/index.tsx",
		exports: {
			"show-progress": {
				kind: "component",
				entry: "client/show/progress.tsx",
				automaticEntityPresentations: false,
			},
		},
	},
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	httpRateLimits: [
		{ requests: 90, key: "anilist", intervalMs: 60_000, origins: ["https://graphql.anilist.co"] },
		{ requests: 1, intervalMs: 1_000, key: "musicbrainz", origins: ["https://musicbrainz.org"] },
	],
	userBootstrap: [
		{
			slug: "initialize-workspace",
			scriptSlug: "bootstrap.media-workspace",
			description: "Initialize the user's media workspace",
		},
	],
	importSources: [
		{
			slug: "netflix",
			name: "Netflix",
			workflowSlug: "import",
			exportHelp: importDocs("netflix"),
			requiredPluginConfigKeys: ["tmdbAccessToken"],
			description: "Import viewing activity, ratings, and watchlist entries from Netflix",
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					...uploadInputSchema("Netflix export", "Netflix data export ZIP", ["zip"]).fields,
					profileName: {
						position: 1,
						type: "string",
						label: "Profile name",
						description: "Only import viewing activity for this Netflix profile",
					},
				},
			},
		},
		{
			slug: "goodreads",
			name: "Goodreads",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("goodreads"),
			description: "Import books, reading history, reviews, and shelves from Goodreads",
			inputSchema: uploadInputSchema("Goodreads export", "Goodreads library export CSV", ["csv"]),
		},
		{
			slug: "storygraph",
			name: "StoryGraph",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("storygraph"),
			description: "Import books, reading history, reviews, and tags from StoryGraph",
			inputSchema: uploadInputSchema("StoryGraph export", "StoryGraph library export CSV", ["csv"]),
		},
		{
			slug: "hardcover",
			name: "Hardcover",
			workflowSlug: "import",
			exportHelp: importDocs("hardcover"),
			requiredPluginConfigKeys: ["hardcoverApiKey"],
			description: "Import books, reading history, reviews, lists, and ownership from Hardcover",
			inputSchema: uploadInputSchema("Hardcover export", "Hardcover library export CSV", ["csv"]),
		},
		{
			slug: "anilist",
			name: "AniList",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("anilist"),
			inputSchema: uploadInputSchema("AniList export", "AniList JSON export", ["json"]),
			description:
				"Import anime, manga, progress, reviews, favorites, and custom lists from AniList",
		},
		{
			slug: "trakt",
			name: "Trakt",
			workflowSlug: "import",
			exportHelp: importDocs("trakt"),
			requiredPluginConfigKeys: [],
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					mode: {
						position: 0,
						type: "enum",
						label: "Import method",
						validation: { required: true },
						description: "How to import Trakt data",
						choices: {
							kind: "static",
							values: [
								{ value: "export", label: "Export file" },
								{ value: "user", label: "Username" },
								{ value: "list", label: "List" },
							],
						},
					},
					exportUploadToken: {
						position: 1,
						type: "string",
						label: "Export file",
						description: "Trakt data export ZIP",
						validation: { minLength: 1, required: true },
						format: { kind: "upload", allowedFileExtensions: ["zip"] },
					},
					username: {
						position: 2,
						type: "string",
						label: "Username",
						description: "Public Trakt profile slug",
						validation: { minLength: 1, required: true },
					},
					url: {
						position: 3,
						type: "string",
						label: "List URL",
						format: { kind: "url" },
						validation: { required: true },
						description: "Public Trakt list URL",
					},
					collection: {
						position: 4,
						type: "string",
						label: "Collection",
						validation: { minLength: 1, required: true },
						description: "Ryot collection for imported list items",
					},
				},
				rules: [
					{
						kind: "visibility",
						path: ["exportUploadToken"],
						visibility: { hidden: true },
						when: { path: ["mode"], value: "export", operator: "neq" },
					},
					{
						path: ["username"],
						kind: "visibility",
						visibility: { hidden: true },
						when: { path: ["mode"], value: "user", operator: "neq" },
					},
					{
						path: ["url"],
						kind: "visibility",
						visibility: { hidden: true },
						when: { path: ["mode"], value: "list", operator: "neq" },
					},
					{
						kind: "visibility",
						path: ["collection"],
						visibility: { hidden: true },
						when: { path: ["mode"], value: "list", operator: "neq" },
					},
				],
			},
			description:
				"Import movies, shows, history, ratings, watchlist, lists, and ownership from Trakt",
		},
		{
			slug: "imdb",
			name: "IMDb",
			workflowSlug: "import",
			exportHelp: importDocs("imdb"),
			requiredPluginConfigKeys: ["tmdbAccessToken"],
			description: "Import movie and show watchlist entries from IMDb",
			inputSchema: uploadInputSchema("IMDb export", "IMDb watchlist export CSV", ["csv"]),
		},
		{
			slug: "igdb",
			name: "IGDB",
			workflowSlug: "import",
			exportHelp: importDocs("igdb"),
			requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
			description: "Import video games into a selected collection from IGDB",
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					...uploadInputSchema("IGDB export", "IGDB game export CSV", ["csv"]).fields,
					collection: {
						position: 1,
						type: "string",
						label: "Collection",
						validation: { minLength: 1, required: true },
						description: "Ryot collection for imported games",
					},
				},
			},
		},
		{
			slug: "grouvee",
			name: "Grouvee",
			workflowSlug: "import",
			exportHelp: importDocs("grouvee"),
			requiredPluginConfigKeys: ["giantBombApiKey"],
			description: "Import video games, play history, reviews, ratings, and shelves from Grouvee",
			inputSchema: uploadInputSchema("Grouvee export", "Grouvee game export CSV", ["csv"]),
		},
		{
			slug: "watcharr",
			name: "Watcharr",
			workflowSlug: "import",
			exportHelp: importDocs("watcharr"),
			requiredPluginConfigKeys: ["tmdbAccessToken"],
			description: "Import movies, shows, episode history, reviews, and collections from Watcharr",
			inputSchema: uploadInputSchema("Watcharr export", "Watcharr JSON export", ["json"]),
		},
		{
			slug: "movary",
			name: "Movary",
			workflowSlug: "import",
			exportHelp: importDocs("movary"),
			requiredPluginConfigKeys: ["tmdbAccessToken"],
			description: "Import movie history, ratings, and watchlist entries from Movary",
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					historyUploadToken: {
						position: 0,
						type: "string",
						label: "History export",
						description: "Movary history.csv export",
						validation: { minLength: 1, required: true },
						format: { kind: "upload", allowedFileExtensions: ["csv"] },
					},
					ratingsUploadToken: {
						position: 1,
						type: "string",
						label: "Ratings export",
						description: "Movary ratings.csv export",
						validation: { minLength: 1, required: true },
						format: { kind: "upload", allowedFileExtensions: ["csv"] },
					},
					watchlistUploadToken: {
						position: 2,
						type: "string",
						label: "Watchlist export",
						description: "Movary watchlist.csv export",
						validation: { minLength: 1, required: true },
						format: { kind: "upload", allowedFileExtensions: ["csv"] },
					},
				},
			},
		},
		{
			slug: "myanimelist",
			name: "MyAnimeList",
			workflowSlug: "import",
			exportHelp: importDocs("myanimelist"),
			requiredPluginConfigKeys: ["malClientId"],
			description: "Import anime and manga history, progress, ratings, and status from MyAnimeList",
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					animeUploadToken: {
						position: 0,
						type: "string",
						label: "Anime export",
						validation: { minLength: 1 },
						description: "MyAnimeList anime export",
						format: { kind: "upload", allowedFileExtensions: ["gz", "xml"] },
					},
					mangaUploadToken: {
						position: 1,
						type: "string",
						label: "Manga export",
						validation: { minLength: 1 },
						description: "MyAnimeList manga export",
						format: { kind: "upload", allowedFileExtensions: ["gz", "xml"] },
					},
				},
				rules: [
					{
						kind: "validation",
						path: ["animeUploadToken"],
						validation: { required: true },
						when: { path: ["mangaUploadToken"], operator: "not_exists" },
					},
					{
						kind: "validation",
						path: ["mangaUploadToken"],
						validation: { required: true },
						when: { path: ["animeUploadToken"], operator: "not_exists" },
					},
				],
			},
		},
		{
			slug: "jellyfin",
			name: "Jellyfin",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("jellyfin"),
			description: "Import watched movies, episodes, and favorites from Jellyfin",
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					apiUrl: {
						position: 0,
						type: "string",
						label: "Server URL",
						format: { kind: "url" },
						validation: { required: true },
						description: "Jellyfin server URL",
					},
					username: {
						position: 1,
						type: "string",
						label: "Username",
						description: "Jellyfin username",
						validation: { minLength: 1, required: true },
					},
					password: {
						secret: true,
						position: 2,
						type: "string",
						label: "Password",
						validation: { minLength: 1 },
						description: "Jellyfin password",
					},
					allowInsecureConnections: {
						position: 3,
						type: "boolean",
						label: "Allow insecure connections",
						description: "Allow connections with invalid TLS certificates",
					},
				},
			},
		},
		{
			slug: "plex",
			name: "Plex",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("plex"),
			inputSchema: apiKeyInputSchema("Plex", "Plex authentication token"),
			description: "Import watched movies and episodes from Plex",
		},
		{
			slug: "audiobookshelf",
			name: "Audiobookshelf",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("audiobookshelf"),
			inputSchema: apiKeyInputSchema("Audiobookshelf"),
			description: "Import finished audiobooks, ebooks, podcasts, and library collections",
		},
		{
			name: "MediaTracker",
			slug: "media_tracker",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("mediatracker"),
			inputSchema: apiKeyInputSchema("MediaTracker"),
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
			slug: "media-monitoring",
			schedule: { tier: "infrequent" },
			scriptSlug: "workflow.media-monitoring-sweep",
			description: "Refresh monitored provider-backed media",
		},
		{
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
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
	bindings: {
		signalAutomations: [],
		providerEntityImportAutomations: mediaLibraryEligibleEntitySchemaSlugs.map(
			(entitySchemaSlug) => ({
				entitySchemaSlug,
				scriptSlug: "automation.media-library-membership-on-import",
			}),
		),
		entityAutomations: [
			...[...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].map(
				(entitySchemaSlug) => ({
					entitySchemaSlug,
					operation: "update" as const,
					scriptSlug: "automation.media-entity-updated",
				}),
			),
			...["show", "podcast"].map((entitySchemaSlug) => ({
				entitySchemaSlug,
				operation: "update" as const,
				scriptSlug: "automation.media-auto-complete-episodic-parent",
			})),
		],
		eventAutomations: [
			...entitySchemas.flatMap((schema) =>
				schema.eventSchemas.map(({ slug }) => ({
					position: 1000,
					kind: "policy" as const,
					eventSchemaSlug: `${schema.slug}:${slug}`,
					metadata: { batchMode: "subject" as const },
					scriptSlug: "policy.media-library-membership",
				})),
			),
			{
				kind: "policy",
				position: 1000,
				scriptSlug: "policy.media-library-membership",
				eventSchemaSlug: "collection:add-entity-to-collection",
			},
			...[...eventSlugs("review"), "collection:review"].map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "automation.review-created",
			})),
			...eventSlugs("progress").flatMap((eventSchemaSlug) => [
				{
					eventSchemaSlug,
					kind: "subscription" as const,
					metadata: { inheritedProperties: ["consumedOn"] },
					scriptSlug: "trigger.auto-complete-on-full-progress",
				},
				{
					position: 100,
					eventSchemaSlug,
					kind: "policy" as const,
					metadata: { origins: ["integration"] as const },
					scriptSlug: "trigger.integration-progress-policy",
				},
			]),
			...[
				"show:backlog",
				"show:complete",
				"show:dropped",
				"show:on_hold",
				"show-episode:progress",
				"show-episode:complete",
				"podcast:backlog",
				"podcast:complete",
				"podcast:dropped",
				"podcast:on_hold",
				"podcast-episode:progress",
				"podcast-episode:complete",
			].map((eventSchemaSlug) => ({
				position: 200,
				eventSchemaSlug,
				kind: "policy" as const,
				scriptSlug: "policy.media-episodic-session",
			})),
			...["show-episode:complete", "podcast-episode:complete"].map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "automation.media-auto-complete-episodic-parent",
			})),
			{
				kind: "subscription",
				scriptSlug: "trigger.radarr-push",
				eventSchemaSlug: "collection:add-entity-to-collection",
			},
			{
				kind: "subscription",
				scriptSlug: "trigger.sonarr-push",
				eventSchemaSlug: "collection:add-entity-to-collection",
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
