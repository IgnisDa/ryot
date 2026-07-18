import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

import { mediaLibraryMemberEntitySchemaSlugs } from "../backend/contracts/schema-slugs";
import { builtinMediaEntitySchemaSlugs, mediaGroupSlugs } from "../shared/media-schema-slugs";
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
			format: { allowedFileExtensions, kind: "upload" as const },
			validation: { minLength: 1 as const, required: true as const },
		},
	},
});

const apiKeyInputSchema = (name: string, apiKeyDescription = `${name} API token`) => ({
	unknownKeys: "strict" as const,
	fields: {
		allowInsecureConnections: {
			position: 2,
			type: "boolean" as const,
			label: "Allow insecure connections",
			description: "Allow connections with invalid TLS certificates",
		},
		apiKey: {
			position: 1,
			label: "API key",
			secret: true as const,
			type: "string" as const,
			description: apiKeyDescription,
			validation: { minLength: 1, required: true as const },
		},
		apiUrl: {
			position: 0,
			label: "Server URL",
			type: "string" as const,
			format: { kind: "url" as const },
			description: `${name} server URL`,
			validation: { required: true as const },
		},
	},
});

const eventHookTarget = (qualifiedSlug: string) => {
	const separator = qualifiedSlug.indexOf(":");
	return {
		resource: "event" as const,
		operation: "create" as const,
		entitySchemaSlug: qualifiedSlug.slice(0, separator),
		eventSchemaSlug: qualifiedSlug.slice(separator + 1),
	};
};

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
		settingsSchema: providerSettings("emby"),
		description: "Receive Emby playback webhooks",
	},
	{
		lot: "sink",
		slug: "kodi",
		name: "Kodi",
		scriptSlug: "integration.kodi",
		settingsSchema: providerSettings("kodi"),
		description: "Receive Kodi playback webhooks",
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
			apiKey: stringSetting("API key", "Radarr API key", true, true),
			profileId: stringSetting("Profile ID", "Radarr quality profile ID"),
			rootFolderPath: stringSetting("Root folder path", "Radarr root folder path"),
			tagIds: {
				type: "array",
				label: "Tag IDs",
				description: "Radarr tag IDs",
				items: { type: "integer", label: "Tag ID", description: "Radarr tag ID" },
			},
			syncCollectionIds: {
				type: "array",
				label: "Collections",
				description: "Collection IDs synchronized to Radarr",
				items: stringSetting("Collection ID", "Collection ID", false),
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
			username: stringSetting("Username", "Jellyfin username"),
			baseUrl: stringSetting("Base URL", "Jellyfin instance URL"),
			password: stringSetting("Password", "Jellyfin password", false, true),
		}),
	},
] as const;

const detailPageExport = (slug: string) => ({
	[`${slug}-detail`]: {
		kind: "page" as const,
		settingsSchema: { fields: {} },
		entry: `client/${slug}/screen.tsx`,
		automaticEntityPresentations: false,
	},
});

const schemaClient = (slug: string) => ({
	slug,
	entity: {
		detailPage: `${slug}-detail`,
		listPresentation: `${slug}-row`,
		gridPresentation: `${slug}-card`,
	},
	exports: {
		[`${slug}-row`]: {
			kind: "presentation" as const,
			automaticEntityPresentations: false,
			entry: `client/${slug}-row-presentation.ts`,
		},
		[`${slug}-card`]: {
			kind: "presentation" as const,
			automaticEntityPresentations: false,
			entry: `client/${slug}-card-presentation.ts`,
		},
		...detailPageExport(slug),
	},
});

const schemaClients = [
	"show",
	"anime",
	"movie",
	"music",
	"book",
	"manga",
	"podcast",
	"audiobook",
	"comic-book",
	"video-game",
	"visual-novel",
	...mediaGroupSlugs,
].map(schemaClient);

const creatorClients = ["person", "company"].map((slug) => ({
	slug,
	exports: detailPageExport(slug),
	entity: {
		detailPage: `${slug}-detail`,
		listPresentation: "media-row",
		gridPresentation: "media-card",
	},
}));

const entityClients = [...schemaClients, ...creatorClients];

export const mediaPlugin = definePlugin({
	boot: [],
	entitySchemas,
	relationshipSchemas,
	integrationProviders,
	providers: mediaProviders,
	savedViews: mediaSavedViews(),
	configSchema: mediaConfigSchema,
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	userBootstrap: [
		{
			slug: "initialize-workspace",
			scriptSlug: "bootstrap.media-workspace",
			description: "Initialize the user's media workspace",
		},
	],
	httpRateLimits: [
		{ requests: 90, key: "anilist", intervalMs: 60_000, origins: ["https://graphql.anilist.co"] },
		{ requests: 1, intervalMs: 1_000, key: "musicbrainz", origins: ["https://musicbrainz.org"] },
	],
	metadata: {
		icon: "film",
		name: "Media",
		slug: "media",
		version: "1.0.0",
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
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
	client: {
		apiVersion: 1,
		homeView: null,
		routes: { "/": "media-home" },
		entities: Object.fromEntries(entityClients.map(({ slug, entity }) => [slug, entity])),
		exports: {
			"show-progress": {
				kind: "component",
				entry: "client/show/progress.tsx",
				automaticEntityPresentations: false,
			},
			"media-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/media-row-presentation.ts",
			},
			"media-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/media-card-presentation.ts",
			},
			"media-home": {
				kind: "page",
				entry: "client/home.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			...Object.fromEntries(entityClients.flatMap((client) => Object.entries(client.exports))),
		},
	},
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
	hooks: [
		{
			stage: "after",
			delivery: "required",
			slug: "media.ensure-library-membership",
			name: "Ensure media library membership",
			scriptSlug: "automation.ensure-library-membership",
			targets: [
				...mediaLibraryMemberEntitySchemaSlugs.flatMap((entitySchemaSlug) => [
					{ entitySchemaSlug, resource: "entity" as const, operation: "create" as const },
					{
						entitySchemaSlug,
						operation: "complete" as const,
						resource: "provider-entity-import" as const,
					},
				]),
				...entitySchemas.flatMap((schema) =>
					schema.eventSchemas
						.filter(({ slug }) => slug !== "add-to-library")
						.map(({ slug }) => eventHookTarget(`${schema.slug}:${slug}`)),
				),
				eventHookTarget("collection:add-entity-to-collection"),
			],
		},
		{
			stage: "after",
			delivery: "required",
			slug: "media.record-library-membership-event",
			name: "Record media library membership event",
			scriptSlug: "automation.record-library-membership-event",
			targets: [
				{ operation: "create", resource: "relationship", relationshipSchemaSlug: "in-library" },
			],
		},
		{
			stage: "after",
			delivery: "async",
			slug: "media.entity-updated",
			name: "Media entity updated",
			scriptSlug: "automation.media-entity-updated",
			targets: [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].map(
				(entitySchemaSlug) => ({
					entitySchemaSlug,
					resource: "entity" as const,
					operation: "update" as const,
				}),
			),
		},
		{
			stage: "after",
			delivery: "async",
			slug: "media.relationship-sync",
			name: "Media relationship sync",
			scriptSlug: "automation.media-relationship-sync",
			targets: [
				"show-to-show-season",
				"show-season-to-show-episode",
				"podcast-to-podcast-episode",
			].flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					resource: "relationship" as const,
				})),
			),
		},
		{
			stage: "after",
			delivery: "async",
			slug: "media.association",
			name: "Media association",
			scriptSlug: "automation.media-association",
			targets: creditRelationshipSlugs.flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					resource: "relationship" as const,
				})),
			),
		},
		{
			stage: "after",
			delivery: "async",
			name: "Review created",
			causationSources: ["api"],
			slug: "media.review-created",
			scriptSlug: "automation.review-created",
			targets: [...eventSlugs("review"), "collection:review"].map(eventHookTarget),
		},
		{
			stage: "after",
			delivery: "required",
			name: "Complete full progress",
			slug: "media.auto-complete-on-full-progress",
			metadata: { inheritedProperties: ["consumedOn"] },
			scriptSlug: "trigger.auto-complete-on-full-progress",
			targets: eventSlugs("progress").map(eventHookTarget),
		},
		{
			position: 200,
			stage: "before",
			slug: "media.episodic-session",
			name: "Assign episodic session",
			scriptSlug: "policy.media-episodic-session",
			targets: [
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
			].map(eventHookTarget),
		},
		{
			stage: "after",
			delivery: "required",
			name: "Complete episodic parent",
			slug: "media.auto-complete-episodic-parent",
			scriptSlug: "automation.media-auto-complete-episodic-parent",
			targets: [
				...["show-episode:complete", "podcast-episode:complete"].map(eventHookTarget),
				...["show", "podcast"].map((entitySchemaSlug) => ({
					entitySchemaSlug,
					resource: "entity" as const,
					operation: "update" as const,
				})),
			],
		},
		...(["radarr", "sonarr", "jellyfin"] as const).map((prov) => ({
			name: `${prov} push`,
			stage: "after" as const,
			slug: `media.${prov}-push`,
			delivery: "async" as const,
			scriptSlug: `trigger.${prov}-push`,
			retry: {
				maxAttempts: 1,
				maxDelayMs: 60000,
				initialDelayMs: 1000,
				externalIdempotency: "none" as const,
			},
			targets: (prov === "jellyfin"
				? eventSlugs("complete")
				: ["collection:add-entity-to-collection"]
			).map(eventHookTarget),
		})),
		{
			stage: "after",
			delivery: "async",
			slug: "media.notification",
			name: "Media notification",
			scriptSlug: "automation.media-notification",
			retry: {
				maxAttempts: 1,
				maxDelayMs: 60000,
				initialDelayMs: 1000,
				externalIdempotency: "none",
			},
			targets: mediaSignalSchemas("media-monitoring").map(({ slug }) => ({
				signalSchemaSlug: slug,
				operation: "emit" as const,
				resource: "signal" as const,
			})),
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
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("trakt"),
			description:
				"Import movies, shows, history, ratings, watchlist, lists, and ownership from Trakt",
			inputSchema: {
				unknownKeys: "strict",
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
						when: { value: "user", path: ["mode"], operator: "neq" },
					},
					{
						path: ["url"],
						kind: "visibility",
						visibility: { hidden: true },
						when: { value: "list", path: ["mode"], operator: "neq" },
					},
					{
						kind: "visibility",
						path: ["collection"],
						visibility: { hidden: true },
						when: { value: "list", path: ["mode"], operator: "neq" },
					},
				],
				fields: {
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
					exportUploadToken: {
						position: 1,
						type: "string",
						label: "Export file",
						description: "Trakt data export ZIP",
						validation: { minLength: 1, required: true },
						format: { kind: "upload", allowedFileExtensions: ["zip"] },
					},
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
				},
			},
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
			inputSchema: uploadInputSchema("Grouvee export", "Grouvee game export CSV", ["csv"]),
			description: "Import video games, play history, reviews, ratings, and shelves from Grouvee",
		},
		{
			slug: "watcharr",
			name: "Watcharr",
			workflowSlug: "import",
			exportHelp: importDocs("watcharr"),
			requiredPluginConfigKeys: ["tmdbAccessToken"],
			inputSchema: uploadInputSchema("Watcharr export", "Watcharr JSON export", ["json"]),
			description: "Import movies, shows, episode history, reviews, and collections from Watcharr",
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
				rules: [
					{
						kind: "validation",
						path: ["animeUploadToken"],
						validation: { required: true },
						when: { operator: "not_exists", path: ["mangaUploadToken"] },
					},
					{
						kind: "validation",
						path: ["mangaUploadToken"],
						validation: { required: true },
						when: { operator: "not_exists", path: ["animeUploadToken"] },
					},
				],
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
					username: {
						position: 1,
						type: "string",
						label: "Username",
						description: "Jellyfin username",
						validation: { minLength: 1, required: true },
					},
					password: {
						position: 2,
						secret: true,
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
					apiUrl: {
						position: 0,
						type: "string",
						label: "Server URL",
						format: { kind: "url" },
						validation: { required: true },
						description: "Jellyfin server URL",
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
			description: "Import watched movies and episodes from Plex",
			inputSchema: apiKeyInputSchema("Plex", "Plex authentication token"),
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
});

export default mediaPlugin;
