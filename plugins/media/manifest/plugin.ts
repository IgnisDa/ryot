import { CHANGE_SET_LIMITS } from "@ryot-app/contract/modules/changes/change-set";
import { FOLD_LIMITS } from "@ryot-app/contract/modules/events/folds";
import type { AuthoredEntitySchemaBrowse } from "@ryot-app/contract/modules/filters/browse";
import {
	CLIENT_API_VERSION,
	definePlugin,
	type KernelCollectionEventHookTarget,
	type PluginEntityEditor,
	type PluginHook,
} from "@ryot-app/contract/modules/plugins/manifest";
import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";

import {
	CONSUMED_ON_ITEM_LIMIT,
	CONSUMED_ON_LIST_LIMIT,
	consumedOnSettingKeys,
} from "../shared/consumed-on-settings";
import {
	MetadataLookupInput,
	MetadataLookupOutput,
	ResolveEpisodesInput,
	ResolveEpisodesOutput,
} from "../shared/integration-operations";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "../shared/lifecycle-expressions";
import {
	MediaActivityDeleteInput,
	MediaActivityEditOutput,
	MediaActivityLogInput,
	MediaActivityLogOutput,
	MediaActivityUpdateInput,
} from "../shared/media-activity-operations";
import {
	isMediaChildEntitySchemaSlug,
	mediaEntityCreateRoute,
	mediaEntityEditorRoutes,
	mediaEntityEditors,
} from "../shared/media-entity-editors";
import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
	MediaMonitoringStatusInput,
} from "../shared/media-monitoring-operations";
import { MediaCopyWriteInput, MediaCopyWriteOutput } from "../shared/media-ownership-operations";
import {
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewOutput,
	MediaReviewUpdateInput,
} from "../shared/media-review-operations";
import {
	builtinMediaEntitySchemaSlugs,
	mediaFoldEventSchemaSlugs,
	mediaGroupSlugs,
	mediaLibraryMemberEntitySchemaSlugs,
} from "../shared/media-schema-slugs";
import { MediaUserDataInput, MediaUserDataOutput } from "../shared/media-user-data-operations";
import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { mediaPresentationDeclaration } from "../shared/presentation-sources";
import {
	DEFAULT_UPCOMING_DAYS_AHEAD,
	MAX_UPCOMING_DAYS_AHEAD,
	UPCOMING_DAYS_AHEAD_SETTING,
	UPCOMING_ONE_PER_TITLE_SETTING,
} from "../shared/upcoming-settings";
import { mediaBrowse } from "./browse";
import { mediaCalendarSources } from "./calendar-sources";
import { mediaConfigSchema } from "./config";
import { mediaProviders } from "./providers";
import { mediaDeclaredQueries } from "./queries";
import { mediaSavedViews } from "./saved-views";
import {
	hasConsumptionProjection,
	mediaConsumptionProjection,
} from "./schemas/consumption-projection";
import { mediaEntitySchemas } from "./schemas/entity";
import { builtinRelationshipSchemas } from "./schemas/relationship";
import { mediaSignalSchemas } from "./schemas/signal";
import { mediaSignalSchedules } from "./signal-schedules";
import { mediaUserStatePolicy } from "./user-state";
import { watchProviderUserSettingFields } from "./watch-provider-settings";

/**
 * What the history fold reads of a title: its release date, and for a show or podcast its production
 * status and its episodes' releases and numbers.
 */
const foldEntityProperties = (schema: ReturnType<typeof mediaEntitySchemas>[number]) => {
	const episodic = [showEpisodicKindConfig, podcastEpisodicKindConfig].find(
		({ parentSchemaSlug }) => parentSchemaSlug === schema.slug,
	);
	const [read, ...reads] = [
		...(episodic ? ["productionStatus"] : []),
		"publishDate",
		"publishYear",
	].filter((property) => Object.hasOwn(schema.propertiesSchema.fields, property));
	return [
		...(read === undefined
			? []
			: [{ entitySchemaSlug: schema.slug, properties: [read, ...reads] as const }]),
		...(episodic
			? [
					{
						entitySchemaSlug: episodic.episodeSchemaSlug,
						properties: ["airingAt", "episodeNumber", "publishDate"] as const,
					},
				]
			: []),
	];
};

const entitySchemas = mediaEntitySchemas().map(
	(
		schema,
	): ReturnType<typeof mediaEntitySchemas>[number] & {
		readonly editor?: PluginEntityEditor;
		readonly browse?: AuthoredEntitySchemaBrowse;
	} => {
		const editor = Object.hasOwn(mediaEntityEditors, schema.slug)
			? mediaEntityEditors[schema.slug]
			: undefined;
		const browse = mediaBrowse(schema);
		const browsed = browse === undefined ? schema : Object.assign({}, schema, { browse });
		const definition = mediaLibraryMemberEntitySchemaSlugs.some((slug) => slug === schema.slug)
			? Object.assign({}, browsed, {
					userState: mediaUserStatePolicy(schema.slug),
					fold: {
						scriptSlug: "fold.media-history",
						eventSchemaSlugs: mediaFoldEventSchemaSlugs,
						entityProperties: foldEntityProperties(schema),
					},
				})
			: browsed;
		const projected = [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].some(
			(slug) => slug === schema.slug,
		)
			? Object.assign({}, definition, {
					eventSchemas: definition.eventSchemas.map((event) =>
						hasConsumptionProjection(event.slug)
							? Object.assign({}, event, { projection: mediaConsumptionProjection })
							: event,
					),
				})
			: definition;
		return editor === undefined ? projected : Object.assign({}, projected, { editor });
	},
);

const relationshipSchemas = builtinRelationshipSchemas();

const streamingProviders = [
	"Netflix",
	"Amazon Prime",
	"Disney+",
	"HBO Max",
	"Apple TV",
	"Peacock",
	"Hulu",
];

const consumedOnSettings = [
	{
		slug: "book",
		noun: "book",
		label: catalogMessage("user-setting.consumed-on.book"),
		hint: catalogMessage("user-setting.consumed-on.book-hint"),
		defaults: ["Paperback", "Hardcover", "Kindle", "Kobo", "Library"],
	},
	{
		slug: "comic-book",
		noun: "comic book",
		defaults: ["Print", "Kindle"],
		label: catalogMessage("user-setting.consumed-on.comic-book"),
		hint: catalogMessage("user-setting.consumed-on.comic-book-hint"),
	},
	{
		slug: "anime",
		noun: "anime",
		defaults: ["Crunchyroll", "Netflix", "HIDIVE"],
		label: catalogMessage("user-setting.consumed-on.anime"),
		hint: catalogMessage("user-setting.consumed-on.anime-hint"),
	},
	{
		slug: "movie",
		noun: "movie",
		label: catalogMessage("user-setting.consumed-on.movie"),
		defaults: [...streamingProviders, "Crunchyroll", "Cinema"],
		hint: catalogMessage("user-setting.consumed-on.movie-hint"),
	},
	{
		slug: "show",
		noun: "show",
		defaults: streamingProviders,
		label: catalogMessage("user-setting.consumed-on.show"),
		hint: catalogMessage("user-setting.consumed-on.show-hint"),
	},
	{
		slug: "manga",
		noun: "manga",
		defaults: ["Print", "Kindle", "Manga Plus"],
		label: catalogMessage("user-setting.consumed-on.manga"),
		hint: catalogMessage("user-setting.consumed-on.manga-hint"),
	},
	{
		slug: "audiobook",
		noun: "audiobook",
		defaults: ["Audible", "Libby", "Spotify"],
		label: catalogMessage("user-setting.consumed-on.audiobook"),
		hint: catalogMessage("user-setting.consumed-on.audiobook-hint"),
	},
	{
		slug: "podcast",
		noun: "podcast",
		label: catalogMessage("user-setting.consumed-on.podcast"),
		hint: catalogMessage("user-setting.consumed-on.podcast-hint"),
		defaults: ["Spotify", "Apple Podcasts", "Pocket Casts", "YouTube"],
	},
	{
		slug: "video-game",
		noun: "video game",
		label: catalogMessage("user-setting.consumed-on.video-game"),
		hint: catalogMessage("user-setting.consumed-on.video-game-hint"),
		defaults: ["PC", "PlayStation 5", "Xbox Series X|S", "Nintendo Switch", "Steam Deck"],
	},
	{
		slug: "music",
		noun: "music",
		label: catalogMessage("user-setting.consumed-on.music"),
		hint: catalogMessage("user-setting.consumed-on.music-hint"),
		defaults: ["Spotify", "Apple Music", "YouTube Music", "Vinyl", "CD"],
	},
	{
		slug: "visual-novel",
		noun: "visual novel",
		defaults: ["PC", "Nintendo Switch"],
		label: catalogMessage("user-setting.consumed-on.visual-novel"),
		hint: catalogMessage("user-setting.consumed-on.visual-novel-hint"),
	},
] as const;

const consumedOnUserSettingFields = Object.fromEntries(
	consumedOnSettings.map(({ slug, hint, noun, label, defaults }, index) => [
		consumedOnSettingKeys[slug],
		{
			hint,
			label,
			position: index + 4,
			type: "array" as const,
			defaultValue: defaults,
			validation: { maxItems: CONSUMED_ON_LIST_LIMIT },
			description: `Sources suggested when the user logs ${noun} activity.`,
			items: {
				type: "string" as const,
				description: "Where you consume it.",
				label: catalogMessage("property.source"),
				hint: catalogMessage("property.source-hint"),
				validation: { maxLength: CONSUMED_ON_ITEM_LIMIT },
			},
		},
	]),
);

const COLLECTION_RECOMMENDATIONS_ROUTE = "/collections/$collectionId/recommendations";

const importDocs = (page: string) => ({ docsUrl: `https://docs.ryot.io/importing/${page}.html` });

const uploadInputSchema = (
	label: ManifestText,
	hint: ManifestText,
	description: string,
	allowedFileExtensions: string[],
) => ({
	unknownKeys: "strict" as const,
	fields: {
		uploadToken: {
			hint,
			label,
			position: 0,
			description,
			type: "string" as const,
			format: { allowedFileExtensions, kind: "upload" as const },
			validation: { minLength: 1 as const, required: true as const },
		},
	},
});

const timezoneInputField = {
	position: 1,
	type: "string" as const,
	format: { kind: "timezone" as const },
	validation: { required: true as const },
	label: catalogMessage("property.timezone"),
	hint: catalogMessage("property.timezone-hint"),
	description: "Timezone the export's dates were recorded in",
};

const timezoneUploadInputSchema = (...args: Parameters<typeof uploadInputSchema>) => {
	const base = uploadInputSchema(...args);
	return { ...base, fields: { ...base.fields, timezone: timezoneInputField } };
};

const apiKeyInputSchema = (name: string, apiKeyDescription = `${name} API token`) => ({
	unknownKeys: "strict" as const,
	fields: {
		apiKey: {
			position: 1,
			secret: true as const,
			type: "string" as const,
			description: apiKeyDescription,
			label: catalogMessage("property.api-key"),
			validation: { minLength: 1, required: true as const },
		},
		apiUrl: {
			position: 0,
			type: "string" as const,
			format: { kind: "url" as const },
			description: `${name} server URL`,
			validation: { required: true as const },
			label: catalogMessage("property.server-url"),
		},
		allowInsecureConnections: {
			position: 2,
			type: "boolean" as const,
			label: catalogMessage("property.allow-insecure-connections"),
			description: "Allow connections with invalid TLS certificates",
			hint: catalogMessage("property.allow-insecure-connections-hint"),
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

const kernelCollectionEventHookTarget = (
	eventSchemaSlug: KernelCollectionEventHookTarget["eventSchemaSlug"],
): KernelCollectionEventHookTarget => ({
	eventSchemaSlug,
	resource: "event",
	operation: "create",
	owner: { kind: "kernel" },
	entitySchemaSlug: "collection",
});

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

const stringSetting = (
	label: ManifestText,
	description: string,
	required = true,
	secret = false,
) => ({
	label,
	description,
	type: "string" as const,
	...(secret ? { secret: true as const } : {}),
	...(required ? { validation: { required: true as const } } : {}),
});

const kindSetting = (kind: string) => ({
	defaultValue: kind,
	type: "enum" as const,
	validation: { required: true as const },
	label: catalogMessage("property.provider-kind"),
	description: "Integration provider discriminator",
	hint: catalogMessage("property.provider-kind-hint"),
	choices: { kind: "static" as const, values: [{ value: kind }] },
});

const providerSettings = (kind: string, fields = {}) => ({
	fields: { kind: kindSetting(kind), ...fields },
});

const syncCopiesSetting = {
	type: "boolean",
	defaultValue: false,
	label: catalogMessage("ownership.integration-setting"),
	description: "Synchronize individually addressable copies from the source library",
} as const;

const mediaServerInventoryFields = {
	baseUrl: stringSetting(catalogMessage("property.base-url"), "Media server URL"),
	userId: stringSetting(catalogMessage("ownership.server-user-id"), "Media server user ID"),
	apiKey: stringSetting(catalogMessage("property.api-key"), "Media server API key", true, true),
};

const integrationProviders = [
	{
		lot: "yank",
		slug: "jellyfin_inventory",
		scriptSlug: "integration.jellyfin-inventory",
		name: catalogMessage("ownership.jellyfin-inventory"),
		description: catalogMessage("ownership.jellyfin-inventory-description"),
		settingsSchema: providerSettings("jellyfin_inventory", mediaServerInventoryFields),
	},
	{
		lot: "yank",
		slug: "emby_inventory",
		scriptSlug: "integration.emby-inventory",
		name: catalogMessage("ownership.emby-inventory"),
		description: catalogMessage("ownership.emby-inventory-description"),
		settingsSchema: providerSettings("emby_inventory", mediaServerInventoryFields),
	},
	{
		lot: "sink",
		slug: "plex_sink",
		scriptSlug: "integration.plex-sink",
		name: catalogMessage("integration-provider.plex-sink.name"),
		description: catalogMessage("integration-provider.plex-sink.description"),
		settingsSchema: providerSettings("plex_sink", {
			username: {
				...stringSetting(
					catalogMessage("property.username"),
					"Only process playback for this Plex user",
					false,
				),
				hint: catalogMessage("property.plex-username-hint"),
			},
		}),
	},
	{
		lot: "sink",
		slug: "jellyfin_sink",
		scriptSlug: "integration.jellyfin-sink",
		name: catalogMessage("integration-provider.jellyfin-sink.name"),
		description: catalogMessage("integration-provider.jellyfin-sink.description"),
		settingsSchema: providerSettings("jellyfin_sink", {
			username: {
				...stringSetting(
					catalogMessage("property.username"),
					"Only process playback for this Jellyfin user",
					false,
				),
				hint: catalogMessage("property.jellyfin-username-hint"),
			},
			metadataProvider: {
				type: "enum",
				defaultValue: "tmdb",
				label: catalogMessage("property.metadata-provider"),
				hint: catalogMessage("property.metadata-provider-hint"),
				description: "Provider used to identify Jellyfin media",
				choices: { kind: "static", values: [{ value: "tmdb" }, { value: "tvdb" }] },
			},
		}),
	},
	{
		lot: "sink",
		slug: "emby",
		scriptSlug: "integration.emby",
		settingsSchema: providerSettings("emby"),
		name: catalogMessage("integration-provider.emby.name"),
		description: catalogMessage("integration-provider.emby.description"),
	},
	{
		lot: "sink",
		slug: "kodi",
		scriptSlug: "integration.kodi",
		settingsSchema: providerSettings("kodi"),
		name: catalogMessage("integration-provider.kodi.name"),
		description: catalogMessage("integration-provider.kodi.description"),
	},
	{
		lot: "sink",
		entitlement: "pro",
		slug: "ryot_browser_extension",
		scriptSlug: "integration.browser-extension",
		name: catalogMessage("integration-provider.ryot-browser-extension.name"),
		description: catalogMessage("integration-provider.ryot-browser-extension.description"),
		settingsSchema: providerSettings("ryot_browser_extension", {
			disabledSites: {
				type: "array",
				label: catalogMessage("property.disabled-sites"),
				hint: catalogMessage("property.disabled-sites-hint"),
				description: "Sites ignored by the browser extension",
				items: stringSetting(catalogMessage("property.site"), "Hostname to ignore", false),
			},
		}),
	},
	{
		lot: "yank",
		slug: "anilist",
		entitlement: "pro",
		scriptSlug: "integration.anilist",
		name: catalogMessage("provider.anilist.name"),
		description: catalogMessage("integration-provider.anilist.description"),
		settingsSchema: providerSettings("anilist", {
			syncAnime: {
				type: "boolean",
				defaultValue: true,
				label: catalogMessage("property.sync-anime"),
				hint: catalogMessage("property.sync-anime-hint"),
				description: "Read anime list state from AniList",
			},
			syncManga: {
				type: "boolean",
				defaultValue: true,
				label: catalogMessage("property.sync-manga"),
				hint: catalogMessage("property.sync-manga-hint"),
				description: "Read manga list state from AniList",
			},
			account: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("property.anilist-account"),
				hint: catalogMessage("property.anilist-account-hint"),
				format: { provider: "anilist", kind: "oauth-connection" },
				description: "AniList account to read anime and manga list state from",
			},
		}),
	},
	{
		lot: "yank",
		slug: "komga",
		scriptSlug: "integration.komga",
		name: catalogMessage("integration-provider.komga.name"),
		description: catalogMessage("integration-provider.komga.description"),
		settingsSchema: providerSettings("komga", {
			syncCopies: syncCopiesSetting,
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Komga instance URL"),
			apiKey: stringSetting(catalogMessage("property.api-key"), "Komga API key", true, true),
		}),
	},
	{
		lot: "yank",
		slug: "plex_yank",
		scriptSlug: "integration.plex-yank",
		name: catalogMessage("integration-provider.plex-yank.name"),
		description: catalogMessage("integration-provider.plex-yank.description"),
		settingsSchema: providerSettings("plex_yank", {
			syncCopies: syncCopiesSetting,
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Plex instance URL"),
			token: stringSetting(catalogMessage("property.token"), "Plex access token", true, true),
		}),
	},
	{
		lot: "yank",
		slug: "audiobookshelf",
		scriptSlug: "integration.audiobookshelf",
		name: catalogMessage("import-source.audiobookshelf.name"),
		description: catalogMessage("integration-provider.audiobookshelf.description"),
		settingsSchema: providerSettings("audiobookshelf", {
			syncCopies: syncCopiesSetting,
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Audiobookshelf instance URL"),
			token: stringSetting(
				catalogMessage("property.token"),
				"Audiobookshelf access token",
				true,
				true,
			),
		}),
	},
	{
		lot: "yank",
		entitlement: "pro",
		slug: "youtube_music",
		scriptSlug: "integration.youtube-music",
		name: catalogMessage("provider.youtube-music.name"),
		description: catalogMessage("integration-provider.youtube-music.description"),
		settingsSchema: providerSettings("youtube_music", {
			authCookie: stringSetting(
				catalogMessage("property.authentication-cookie"),
				"YouTube Music authentication cookie",
				true,
				true,
			),
			timezone: {
				...stringSetting(
					catalogMessage("property.timezone"),
					"Timezone used for daily history synchronization",
				),
				position: 0,
				format: { kind: "timezone" as const },
			},
		}),
	},
	{
		lot: "yank",
		slug: "spotify",
		entitlement: "pro",
		scriptSlug: "integration.spotify",
		name: catalogMessage("provider.spotify.name"),
		description: catalogMessage("integration-provider.spotify.description"),
		settingsSchema: providerSettings("spotify", {
			account: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("property.spotify-account"),
				hint: catalogMessage("property.spotify-account-hint"),
				format: { provider: "spotify", kind: "oauth-connection" },
				description: "Spotify account to read listening history from",
			},
		}),
	},
	{
		lot: "push",
		slug: "radarr",
		name: catalogMessage("integration-provider.radarr.name"),
		description: catalogMessage("integration-provider.radarr.description"),
		settingsSchema: providerSettings("radarr", {
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Radarr instance URL"),
			apiKey: stringSetting(catalogMessage("property.api-key"), "Radarr API key", true, true),
			profileId: stringSetting(catalogMessage("property.profile-id"), "Radarr quality profile ID"),
			rootFolderPath: stringSetting(
				catalogMessage("property.root-folder-path"),
				"Radarr root folder path",
			),
			syncCollectionIds: {
				type: "array",
				label: catalogMessage("property.collections"),
				hint: catalogMessage("property.collections-hint"),
				description: "Collection IDs synchronized to Radarr",
				items: stringSetting(catalogMessage("property.collection-id"), "Collection ID", false),
			},
			tagIds: {
				type: "array",
				description: "Radarr tag IDs",
				label: catalogMessage("property.tag-ids"),
				hint: catalogMessage("property.tag-ids-hint"),
				items: {
					type: "integer",
					description: "Radarr tag ID",
					label: catalogMessage("property.tag-id"),
					hint: catalogMessage("property.tag-id-hint"),
				},
			},
		}),
	},
	{
		lot: "push",
		slug: "sonarr",
		name: catalogMessage("integration-provider.sonarr.name"),
		description: catalogMessage("integration-provider.sonarr.description"),
		settingsSchema: providerSettings("sonarr", {
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Sonarr instance URL"),
			apiKey: stringSetting(catalogMessage("property.api-key"), "Sonarr API key", true, true),
			profileId: stringSetting(catalogMessage("property.profile-id"), "Sonarr quality profile ID"),
			rootFolderPath: stringSetting(
				catalogMessage("property.root-folder-path"),
				"Sonarr root folder path",
			),
			syncCollectionIds: {
				type: "array",
				label: catalogMessage("property.collections"),
				hint: catalogMessage("property.collections-hint-2"),
				description: "Collection IDs synchronized to Sonarr",
				items: stringSetting(catalogMessage("property.collection-id"), "Collection ID", false),
			},
			tagIds: {
				type: "array",
				description: "Sonarr tag IDs",
				label: catalogMessage("property.tag-ids"),
				hint: catalogMessage("property.tag-ids-hint-2"),
				items: {
					type: "integer",
					description: "Sonarr tag ID",
					label: catalogMessage("property.tag-id"),
					hint: catalogMessage("property.tag-id-hint-2"),
				},
			},
		}),
	},
	{
		lot: "push",
		entitlement: "pro",
		slug: "jellyfin_push",
		name: catalogMessage("integration-provider.jellyfin-push.name"),
		description: catalogMessage("integration-provider.jellyfin-push.description"),
		settingsSchema: providerSettings("jellyfin_push", {
			username: stringSetting(catalogMessage("property.username"), "Jellyfin username"),
			baseUrl: stringSetting(catalogMessage("property.base-url"), "Jellyfin instance URL"),
			password: stringSetting(
				catalogMessage("property.password"),
				"Jellyfin password",
				false,
				true,
			),
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
		createRoute: mediaEntityCreateRoute(slug),
		presentation: mediaPresentationDeclaration(slug),
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
		createRoute: mediaEntityCreateRoute(slug),
		presentation: mediaPresentationDeclaration(slug),
	},
}));

const entityClients = [...schemaClients, ...creatorClients];

export const mediaPlugin = definePlugin({
	entitySchemas,
	relationshipSchemas,
	providers: mediaProviders,
	savedViews: mediaSavedViews(),
	queries: mediaDeclaredQueries,
	configSchema: mediaConfigSchema,
	calendarSources: mediaCalendarSources(),
	signalSchedules: mediaSignalSchedules(),
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	metadata: {
		icon: "film",
		version: "1.0.0",
		packageId: PLUGIN_PACKAGE_ID,
		name: catalogMessage("plugin.name"),
		description: catalogMessage("plugin.description"),
	},
	userBootstrap: [
		{
			slug: "initialize-workspace",
			description: "Initialize the user's media workspace",
			entities: [{ properties: {}, name: "Media Library", entitySchemaSlug: "media-library" }],
		},
	],
	httpRateLimits: [
		{ requests: 30, key: "anilist", intervalMs: 60_000, origins: ["https://graphql.anilist.co"] },
		{ requests: 90, key: "spotify", intervalMs: 60_000, origins: ["https://api.spotify.com"] },
		{ requests: 1, intervalMs: 1_000, key: "musicbrainz", origins: ["https://musicbrainz.org"] },
	],
	integrationProviders: integrationProviders.map((integrationProvider) =>
		"scriptSlug" in integrationProvider
			? Object.assign({}, integrationProvider, {
					scriptSlug: "workflow.media-integration",
					plan: {
						selections: { "integration-adapter": { value: integrationProvider.scriptSlug } },
					},
				})
			: integrationProvider,
	),
	crons: [
		{
			slug: "media-monitoring",
			schedule: { tier: "infrequent" },
			scriptSlug: "workflow.media-monitoring-sweep",
			description: "Refresh monitored provider-backed media",
		},
		{
			slug: "media-trending",
			schedule: { tier: "infrequent" },
			scriptSlug: "workflow.media-trending",
			description: "Refresh global media trending rankings",
		},
	],
	memberships: [
		{
			slug: "media-library",
			silentEventProperty: "completionSilent",
			targetEntitySchemaSlug: "media-library",
			relationshipSchemaSlug: "in-media-library",
			recordEventSchemaSlug: "add-to-media-library",
			memberEntitySchemaSlugs: [...mediaLibraryMemberEntitySchemaSlugs],
			join: {
				events: true,
				providerImport: true,
				kernelCollectionAdd: true,
				entityCreate: mediaLibraryMemberEntitySchemaSlugs.filter(
					(slug) => !isMediaChildEntitySchemaSlug(slug),
				),
			},
		},
	],
	oauthProviders: [
		{
			scopes: [],
			pkce: "none",
			slug: "anilist",
			clientIdConfigKey: "anilistClientId",
			accessTokenLifetimeSeconds: 31_536_000,
			tokenEndpointAuth: "client_secret_post",
			clientSecretConfigKey: "anilistClientSecret",
			name: catalogMessage("provider.anilist.name"),
			tokenUrl: "https://anilist.co/api/v2/oauth/token",
			authorizeUrl: "https://anilist.co/api/v2/oauth/authorize",
		},
		{
			pkce: "S256",
			slug: "spotify",
			clientIdConfigKey: "spotifyClientId",
			scopes: ["user-read-recently-played"],
			tokenEndpointAuth: "client_secret_basic",
			clientSecretConfigKey: "spotifyClientSecret",
			name: catalogMessage("provider.spotify.name"),
			tokenUrl: "https://accounts.spotify.com/api/token",
			authorizeUrl: "https://accounts.spotify.com/authorize",
		},
	],
	workflows: [
		{ slug: "import", scriptSlug: "workflow.media-import" },
		{ slug: "integration", scriptSlug: "workflow.media-integration" },
		{ slug: "media-integration-collection", scriptSlug: "workflow.media-integration-segment" },
		{ slug: "media-integration-segment", scriptSlug: "workflow.media-integration-segment" },
		{ slug: "media-monitoring-sweep", scriptSlug: "workflow.media-monitoring-sweep" },
		{ slug: "media-trending", scriptSlug: "workflow.media-trending" },
		{ slug: "media-import-merge", scriptSlug: "workflow.media-import-merge" },
		{ slug: "media-import-collection", scriptSlug: "workflow.media-import-collection" },
		{ slug: "media-import-application", scriptSlug: "workflow.media-import-application" },
		{ slug: "media-import-population", scriptSlug: "workflow.media-import-population" },
		{ slug: "media-import-resolution", scriptSlug: "workflow.media-import-resolution" },
	],
	userSettingsSchema: {
		unknownKeys: "strict",
		fields: {
			allowNsfw: {
				position: 0,
				type: "boolean",
				defaultValue: false,
				label: catalogMessage("property.show-nsfw-content"),
				hint: catalogMessage("property.show-nsfw-content-hint"),
				description: "Allow providers to include adult metadata and results.",
			},
			[UPCOMING_ONE_PER_TITLE_SETTING]: {
				position: 2,
				type: "boolean",
				defaultValue: true,
				label: catalogMessage("property.one-upcoming-entry-per-title"),
				hint: catalogMessage("property.one-upcoming-entry-per-title-hint"),
				description: "Show only the next episode or release of each title in Upcoming.",
			},
			[UPCOMING_DAYS_AHEAD_SETTING]: {
				position: 1,
				type: "integer",
				defaultValue: DEFAULT_UPCOMING_DAYS_AHEAD,
				label: catalogMessage("property.upcoming-days-ahead"),
				hint: catalogMessage("property.upcoming-days-ahead-hint"),
				validation: { minimum: 1, maximum: MAX_UPCOMING_DAYS_AHEAD },
				description: "How many days ahead the home Upcoming rail looks.",
			},
			...watchProviderUserSettingFields,
			...consumedOnUserSettingFields,
		},
	},
	client: {
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		entities: Object.fromEntries(entityClients.map(({ slug, entity }) => [slug, entity])),
		analyticsSections: {
			media: {
				icon: "film",
				sortOrder: 10,
				exportName: "media-analytics",
				name: catalogMessage("analytics-section.media.name"),
			},
		},
		assistantStarters: [
			catalogMessage("assistant-starter.watch-next"),
			catalogMessage("assistant-starter.finished-this-month"),
			catalogMessage("assistant-starter.releasing-this-week"),
		],
		routes: {
			"/": "media-home",
			[COLLECTION_RECOMMENDATIONS_ROUTE]: "media-collection-recommendations",
			...Object.fromEntries(
				Object.keys(mediaEntityEditorRoutes).map((route) => [route, "media-entity-editor"]),
			),
		},
		collectionPages: {
			recommendations: {
				icon: "sparkles",
				route: COLLECTION_RECOMMENDATIONS_ROUTE,
				entitySchemaSlugs: [...builtinMediaEntitySchemaSlugs],
				label: catalogMessage("collection-page.recommendations.label"),
			},
		},
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
			"media-analytics": {
				kind: "analytics-section",
				automaticEntityPresentations: false,
				entry: "client/analytics/section.tsx",
			},
			"media-home": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/home/screen.tsx",
				automaticEntityPresentations: false,
			},
			"media-entity-editor": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/entity-editor/page.tsx",
			},
			"media-collection-recommendations": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/collection-recommendations/page.tsx",
			},
			...Object.fromEntries(entityClients.flatMap((client) => Object.entries(client.exports))),
		},
	},
	hooks: [
		{
			stage: "before",
			causationSources: ["api"],
			slug: "media.custom-publish-year",
			name: "Derive custom media publish year",
			scriptSlug: "policy.media-custom-publish-year",
			targets: builtinMediaEntitySchemaSlugs.flatMap((entitySchemaSlug) =>
				(["create", "update"] as const).map((operation) => ({
					operation,
					entitySchemaSlug,
					resource: "entity" as const,
				})),
			),
		},
		{
			stage: "after",
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
			frequency: "batch",
			slug: "media.relationship-sync",
			name: "Media relationship sync",
			batchMaxItems: FOLD_LIMITS.requestEntities,
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
			frequency: "batch",
			slug: "media.association",
			name: "Media association",
			batchMaxItems: CHANGE_SET_LIMITS.signals,
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
			name: "Review created",
			executionScope: "user",
			causationSources: ["api"],
			slug: "media.review-created",
			scriptSlug: "automation.review-created",
			targets: [
				...eventSlugs("review").map(eventHookTarget),
				kernelCollectionEventHookTarget("review"),
			],
		},
		{
			position: 200,
			stage: "before",
			slug: "media.consumption",
			name: "Retain consumption basis",
			scriptSlug: "policy.media-consumption",
			targets: [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].flatMap(
				(entity) => {
					const events =
						entity === "show" || entity === "podcast" ? ["complete"] : ["progress", "complete"];
					if (!entity.endsWith("-episode")) {
						events.push("dropped", "on_hold");
					}
					if (entity === "anime" || entity === "manga") {
						events.push("item-complete");
					}
					return events.flatMap((event) =>
						(["create", "update"] as const).map((operation) =>
							Object.assign({}, eventHookTarget(`${entity}:${event}`), { operation }),
						),
					);
				},
			),
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
			].flatMap((slug) => {
				const target = eventHookTarget(slug);
				return slug.includes("-episode")
					? [target, { ...target, operation: "update" as const }]
					: [target];
			}),
		},
		...(["radarr", "sonarr", "jellyfin"] as const).map(
			(prov) =>
				({
					stage: "after",
					name: `${prov} push`,
					executionScope: "user",
					slug: `media.${prov}-push`,
					scriptSlug: `trigger.${prov}-push`,
					retry: {
						maxAttempts: 1,
						maxDelayMs: 60000,
						initialDelayMs: 1000,
						externalIdempotency: "none",
					},
					targets:
						prov === "jellyfin"
							? eventSlugs("complete").map(eventHookTarget)
							: [kernelCollectionEventHookTarget("add-entity-to-collection")],
				}) satisfies Extract<PluginHook, { stage: "after" }>,
		),
		{
			stage: "after",
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
	operations: [
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-user-data",
			title: "Remove or merge title history",
			scriptSlug: "operation.media-user-data",
			input: operationJsonSchema(MediaUserDataInput),
			output: operationJsonSchema(MediaUserDataOutput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Remove media library membership and personal history, or merge that data into another title. Existing user data may be permanently deleted.",
		},
		{
			auth: "user",
			title: "Write review",
			demoAccess: "protected",
			slug: "media-review-create",
			scriptSlug: "operation.media-review-create",
			output: operationJsonSchema(MediaReviewOutput),
			input: operationJsonSchema(MediaReviewCreateInput),
			hints: { readOnly: false, idempotent: false, destructive: false },
			description:
				"Create a private media review with a rating or text, optionally linking an existing consumption event. Repeated calls can create additional review events.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-activity-log",
			title: "Log media activity",
			scriptSlug: "operation.media-activity-log",
			input: operationJsonSchema(MediaActivityLogInput),
			output: operationJsonSchema(MediaActivityLogOutput),
			hints: { readOnly: false, idempotent: false, destructive: false },
			description:
				"Record completion, progress, lifecycle state, or episode activity for a title. Returns the saved count; repeated calls can create additional events.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-activity-update",
			title: "Update media activity",
			scriptSlug: "operation.media-activity-update",
			output: operationJsonSchema(MediaActivityEditOutput),
			input: operationJsonSchema(MediaActivityUpdateInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Change existing media activity using its expected snapshot. Rejects stale edits and invalid episode or time changes.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-activity-delete",
			title: "Delete media activity",
			scriptSlug: "operation.media-activity-delete",
			output: operationJsonSchema(MediaActivityEditOutput),
			input: operationJsonSchema(MediaActivityDeleteInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete selected personal media activity events. An optional expected snapshot protects a single event from stale deletion.",
		},
		{
			auth: "user",
			title: "Update review",
			demoAccess: "protected",
			slug: "media-review-update",
			scriptSlug: "operation.media-review-update",
			output: operationJsonSchema(MediaReviewOutput),
			input: operationJsonSchema(MediaReviewUpdateInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Replace rating or text on an existing private media review. Rejects stale edits using the expected review snapshot.",
		},
		{
			auth: "user",
			title: "Delete review",
			demoAccess: "protected",
			slug: "media-review-delete",
			scriptSlug: "operation.media-review-delete",
			output: operationJsonSchema(MediaReviewOutput),
			input: operationJsonSchema(MediaReviewDeleteInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete an existing private media review and return the affected count.",
		},
		{
			auth: "user",
			demoAccess: "allowed",
			slug: "media-monitoring-status",
			title: "Read monitoring status",
			scriptSlug: "operation.media-monitoring-status",
			output: operationJsonSchema(MediaMonitoringOutput),
			input: operationJsonSchema(MediaMonitoringStatusInput),
			hints: { readOnly: true, idempotent: true, destructive: false },
			description:
				"Read library membership and monitoring status for visible provider-backed titles without changing user data.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Monitor titles",
			slug: "media-monitoring-enable",
			scriptSlug: "operation.media-monitoring-enable",
			output: operationJsonSchema(MediaMonitoringOutput),
			input: operationJsonSchema(MediaMonitoringEnableInput),
			hints: { readOnly: false, idempotent: true, destructive: false },
			description:
				"Add provider-backed titles to the media library and enable monitoring. Existing membership and monitoring are preserved.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Stop monitoring titles",
			slug: "media-monitoring-disable",
			scriptSlug: "operation.media-monitoring-disable",
			output: operationJsonSchema(MediaMonitoringOutput),
			input: operationJsonSchema(MediaMonitoringDisableInput),
			hints: { readOnly: false, idempotent: true, destructive: true },
			description:
				"Remove monitoring from provider-backed titles while retaining their library membership and personal history.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-copy-write",
			title: "Manage an owned copy",
			scriptSlug: "operation.media-copy-write",
			input: operationJsonSchema(MediaCopyWriteInput),
			output: operationJsonSchema(MediaCopyWriteOutput),
			hints: { readOnly: false, idempotent: true, destructive: true },
			description:
				"Add, update, or remove an owned copy by its stable client-selected ID. Adding the copy also saves its title to the media library.",
		},
		{
			auth: "integration",
			slug: "metadata-lookup",
			title: "Match extension titles",
			scriptSlug: "operation.metadata-lookup",
			input: operationJsonSchema(MetadataLookupInput),
			output: operationJsonSchema(MetadataLookupOutput),
			hints: { readOnly: true, idempotent: true, destructive: false },
			description:
				"Match browser extension titles against TMDB movies and shows and return provider identifiers or per-title misses. Requires a browser extension integration and does not import entities.",
		},
		{
			auth: "user",
			demoAccess: "allowed",
			slug: "resolve-episodes",
			title: "Resolve episodes",
			scriptSlug: "operation.resolve-episodes",
			input: operationJsonSchema(ResolveEpisodesInput),
			output: operationJsonSchema(ResolveEpisodesOutput),
			hints: { readOnly: true, idempotent: true, destructive: false },
			description:
				"Look up existing show seasons, show episodes, or podcast episodes by parent and number or title. Returns an entity ID or null for each caller index without importing or changing entities.",
		},
	],
	importSources: (
		[
			{
				slug: "spotify",
				workflowSlug: "import",
				exportHelp: importDocs("spotify"),
				name: catalogMessage("provider.spotify.name"),
				description: catalogMessage("import-source.spotify.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.spotify-export"),
					catalogMessage("property.spotify-export-hint"),
					"Spotify extended streaming history ZIP",
					["zip"],
				),
			},
			{
				slug: "netflix",
				workflowSlug: "import",
				exportHelp: importDocs("netflix"),
				name: catalogMessage("import-source.netflix.name"),
				description: catalogMessage("import-source.netflix.description"),
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						...uploadInputSchema(
							catalogMessage("property.netflix-export"),
							catalogMessage("property.netflix-export-hint"),
							"Netflix data export ZIP",
							["zip"],
						).fields,
						profileName: {
							position: 1,
							type: "string",
							label: catalogMessage("property.profile-name"),
							hint: catalogMessage("property.profile-name-hint"),
							description: "Only import viewing activity for this Netflix profile",
						},
					},
				},
			},
			{
				slug: "goodreads",
				workflowSlug: "import",
				exportHelp: importDocs("goodreads"),
				name: catalogMessage("import-source.goodreads.name"),
				description: catalogMessage("import-source.goodreads.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.goodreads-export"),
					catalogMessage("property.goodreads-export-hint"),
					"Goodreads library export CSV",
					["csv"],
				),
			},
			{
				slug: "storygraph",
				workflowSlug: "import",
				exportHelp: importDocs("storygraph"),
				name: catalogMessage("import-source.storygraph.name"),
				description: catalogMessage("import-source.storygraph.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.storygraph-export"),
					catalogMessage("property.storygraph-export-hint"),
					"StoryGraph library export CSV",
					["csv"],
				),
			},
			{
				slug: "hardcover",
				workflowSlug: "import",
				exportHelp: importDocs("hardcover"),
				name: catalogMessage("provider.hardcover.name"),
				description: catalogMessage("import-source.hardcover.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.hardcover-export"),
					catalogMessage("property.hardcover-export-hint"),
					"Hardcover library export CSV",
					["csv"],
				),
			},
			{
				slug: "anilist",
				workflowSlug: "import",
				exportHelp: importDocs("anilist"),
				name: catalogMessage("provider.anilist.name"),
				description: catalogMessage("import-source.anilist.description"),
				inputSchema: timezoneUploadInputSchema(
					catalogMessage("property.anilist-export"),
					catalogMessage("property.anilist-export-hint"),
					"AniList JSON export",
					["json"],
				),
			},
			{
				slug: "trakt",
				workflowSlug: "import",
				exportHelp: importDocs("trakt"),
				name: catalogMessage("import-source.trakt.name"),
				description: catalogMessage("import-source.trakt.description"),
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
							description: "Public Trakt profile slug",
							label: catalogMessage("property.username"),
							validation: { minLength: 1, required: true },
							hint: catalogMessage("property.username-hint"),
						},
						url: {
							position: 3,
							type: "string",
							format: { kind: "url" },
							validation: { required: true },
							description: "Public Trakt list URL",
							label: catalogMessage("property.list-url"),
							hint: catalogMessage("property.list-url-hint"),
						},
						collection: {
							position: 4,
							type: "string",
							label: catalogMessage("property.collection"),
							validation: { minLength: 1, required: true },
							hint: catalogMessage("property.collection-hint"),
							description: "Ryot collection for imported list items",
						},
						exportUploadToken: {
							position: 1,
							type: "string",
							description: "Trakt data export ZIP",
							validation: { minLength: 1, required: true },
							label: catalogMessage("property.export-file"),
							hint: catalogMessage("property.export-file-hint"),
							format: { kind: "upload", allowedFileExtensions: ["zip"] },
						},
						mode: {
							position: 0,
							type: "enum",
							validation: { required: true },
							description: "How to import Trakt data",
							label: catalogMessage("property.import-method"),
							hint: catalogMessage("property.import-method-hint"),
							choices: {
								kind: "static",
								values: [
									{ value: "export", label: catalogMessage("property.export-file") },
									{ value: "user", label: catalogMessage("property.username") },
									{ value: "list", label: catalogMessage("choice.list") },
								],
							},
						},
					},
				},
			},
			{
				slug: "imdb",
				workflowSlug: "import",
				exportHelp: importDocs("imdb"),
				name: catalogMessage("import-source.imdb.name"),
				description: catalogMessage("import-source.imdb.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.imdb-export"),
					catalogMessage("property.imdb-export-hint"),
					"IMDb watchlist or ratings export CSV",
					["csv"],
				),
			},
			{
				slug: "igdb",
				workflowSlug: "import",
				exportHelp: importDocs("igdb"),
				name: catalogMessage("provider.igdb.name"),
				description: catalogMessage("import-source.igdb.description"),
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						...uploadInputSchema(
							catalogMessage("property.igdb-export"),
							catalogMessage("property.igdb-export-hint"),
							"IGDB game export CSV",
							["csv"],
						).fields,
						collection: {
							position: 1,
							type: "string",
							label: catalogMessage("property.collection"),
							validation: { minLength: 1, required: true },
							description: "Ryot collection for imported games",
							hint: catalogMessage("property.collection-hint-2"),
						},
					},
				},
			},
			{
				slug: "grouvee",
				workflowSlug: "import",
				exportHelp: importDocs("grouvee"),
				name: catalogMessage("import-source.grouvee.name"),
				description: catalogMessage("import-source.grouvee.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.grouvee-export"),
					catalogMessage("property.grouvee-export-hint"),
					"Grouvee game export CSV",
					["csv"],
				),
			},
			{
				slug: "watcharr",
				workflowSlug: "import",
				exportHelp: importDocs("watcharr"),
				name: catalogMessage("import-source.watcharr.name"),
				description: catalogMessage("import-source.watcharr.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.watcharr-export"),
					catalogMessage("property.watcharr-export-hint"),
					"Watcharr JSON export",
					["json"],
				),
			},
			{
				slug: "media-history",
				workflowSlug: "import",
				exportHelp: importDocs("media-history"),
				name: catalogMessage("import-source.media-history.name"),
				description: catalogMessage("import-source.media-history.description"),
				inputSchema: uploadInputSchema(
					catalogMessage("property.media-history-file"),
					catalogMessage("property.media-history-file-hint"),
					"Media history JSON document",
					["json"],
				),
			},
			{
				slug: "movary",
				workflowSlug: "import",
				exportHelp: importDocs("movary"),
				name: catalogMessage("import-source.movary.name"),
				description: catalogMessage("import-source.movary.description"),
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						historyUploadToken: {
							position: 0,
							type: "string",
							description: "Movary history.csv export",
							validation: { minLength: 1, required: true },
							label: catalogMessage("property.history-export"),
							hint: catalogMessage("property.history-export-hint"),
							format: { kind: "upload", allowedFileExtensions: ["csv"] },
						},
						ratingsUploadToken: {
							position: 1,
							type: "string",
							description: "Movary ratings.csv export",
							validation: { minLength: 1, required: true },
							label: catalogMessage("property.ratings-export"),
							hint: catalogMessage("property.ratings-export-hint"),
							format: { kind: "upload", allowedFileExtensions: ["csv"] },
						},
						watchlistUploadToken: {
							position: 2,
							type: "string",
							description: "Movary watchlist.csv export",
							validation: { minLength: 1, required: true },
							label: catalogMessage("property.watchlist-export"),
							hint: catalogMessage("property.watchlist-export-hint"),
							format: { kind: "upload", allowedFileExtensions: ["csv"] },
						},
					},
				},
			},
			{
				slug: "myanimelist",
				workflowSlug: "import",
				exportHelp: importDocs("myanimelist"),
				name: catalogMessage("provider.myanimelist.name"),
				description: catalogMessage("import-source.myanimelist.description"),
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
							validation: { minLength: 1 },
							description: "MyAnimeList anime export",
							label: catalogMessage("property.anime-export"),
							hint: catalogMessage("property.anime-export-hint"),
							format: { kind: "upload", allowedFileExtensions: ["gz", "xml"] },
						},
						mangaUploadToken: {
							position: 1,
							type: "string",
							validation: { minLength: 1 },
							description: "MyAnimeList manga export",
							label: catalogMessage("property.manga-export"),
							hint: catalogMessage("property.manga-export-hint"),
							format: { kind: "upload", allowedFileExtensions: ["gz", "xml"] },
						},
					},
				},
			},
			{
				slug: "jellyfin",
				workflowSlug: "import",
				exportHelp: importDocs("jellyfin"),
				name: catalogMessage("import-source.jellyfin.name"),
				description: catalogMessage("import-source.jellyfin.description"),
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						username: {
							position: 1,
							type: "string",
							description: "Jellyfin username",
							label: catalogMessage("property.username"),
							validation: { minLength: 1, required: true },
							hint: catalogMessage("property.username-hint-2"),
						},
						password: {
							position: 2,
							secret: true,
							type: "string",
							validation: { minLength: 1 },
							description: "Jellyfin password",
							label: catalogMessage("property.password"),
							hint: catalogMessage("property.password-hint"),
						},
						apiUrl: {
							position: 0,
							type: "string",
							format: { kind: "url" },
							validation: { required: true },
							description: "Jellyfin server URL",
							label: catalogMessage("property.server-url"),
							hint: catalogMessage("property.server-url-hint"),
						},
						allowInsecureConnections: {
							position: 3,
							type: "boolean",
							label: catalogMessage("property.allow-insecure-connections"),
							description: "Allow connections with invalid TLS certificates",
							hint: catalogMessage("property.allow-insecure-connections-hint"),
						},
					},
				},
			},
			{
				slug: "plex",
				workflowSlug: "import",
				exportHelp: importDocs("plex"),
				name: catalogMessage("import-source.plex.name"),
				description: catalogMessage("import-source.plex.description"),
				inputSchema: apiKeyInputSchema("Plex", "Plex authentication token"),
			},
			{
				slug: "audiobookshelf",
				workflowSlug: "import",
				exportHelp: importDocs("audiobookshelf"),
				inputSchema: apiKeyInputSchema("Audiobookshelf"),
				name: catalogMessage("import-source.audiobookshelf.name"),
				description: catalogMessage("import-source.audiobookshelf.description"),
			},
			{
				slug: "media_tracker",
				workflowSlug: "import",
				exportHelp: importDocs("mediatracker"),
				inputSchema: apiKeyInputSchema("MediaTracker"),
				name: catalogMessage("import-source.media-tracker.name"),
				description: catalogMessage("import-source.media-tracker.description"),
			},
		] as const
	).map((source) =>
		Object.assign(source, {
			plan: {
				selections: {
					"source-parser":
						source.slug === "trakt"
							? { field: "mode", cases: { user: "trakt", list: "trakt", export: "trakt-export" } }
							: { value: source.slug },
				},
			},
		}),
	),
});

export default mediaPlugin;
