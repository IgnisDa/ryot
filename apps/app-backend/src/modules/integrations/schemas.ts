import { Schema } from "effect";

import { IntegrationId } from "#lib/schema/brands";

import { integrationLots, integrationProviders } from "./types";

export const IntegrationLot = Schema.Literal(...integrationLots);

export type IntegrationLot = typeof IntegrationLot.Type;

export const IntegrationProvider = Schema.Literal(...integrationProviders);

export type IntegrationProvider = typeof IntegrationProvider.Type;

const KodiSpecifics = Schema.Struct({ kind: Schema.Literal("kodi") });

const EmbySpecifics = Schema.Struct({ kind: Schema.Literal("emby") });

const KomgaSpecifics = Schema.Struct({
	apiKey: Schema.String,
	baseUrl: Schema.String,
	kind: Schema.Literal("komga"),
});

const RadarrSpecifics = Schema.Struct({
	apiKey: Schema.String,
	baseUrl: Schema.String,
	profileId: Schema.String,
	kind: Schema.Literal("radarr"),
	rootFolderPath: Schema.String,
	syncCollectionIds: Schema.Array(Schema.String),
	tagIds: Schema.optional(Schema.Array(Schema.Int)),
});

const SonarrSpecifics = Schema.Struct({
	apiKey: Schema.String,
	baseUrl: Schema.String,
	profileId: Schema.String,
	rootFolderPath: Schema.String,
	kind: Schema.Literal("sonarr"),
	tagIds: Schema.optional(Schema.Int),
	syncCollectionIds: Schema.Array(Schema.String),
});

const PlexYankSpecifics = Schema.Struct({
	token: Schema.String,
	baseUrl: Schema.String,
	kind: Schema.Literal("plex_yank"),
});

const PlexSinkSpecifics = Schema.Struct({
	kind: Schema.Literal("plex_sink"),
	username: Schema.optional(Schema.String),
});

const GenericJsonSpecifics = Schema.Struct({ kind: Schema.Literal("generic_json") });

const YoutubeMusicSpecifics = Schema.Struct({
	timezone: Schema.String,
	authCookie: Schema.String,
	kind: Schema.Literal("youtube_music"),
});

const JellyfinSinkSpecifics = Schema.Struct({
	kind: Schema.Literal("jellyfin_sink"),
	username: Schema.optional(Schema.String),
	metadataProvider: Schema.optional(Schema.Literal("tmdb", "tvdb")),
});

const AudiobookshelfSpecifics = Schema.Struct({
	token: Schema.String,
	baseUrl: Schema.String,
	kind: Schema.Literal("audiobookshelf"),
});

const JellyfinPushSpecifics = Schema.Struct({
	baseUrl: Schema.String,
	username: Schema.String,
	kind: Schema.Literal("jellyfin_push"),
	password: Schema.optional(Schema.String),
});

const RyotBrowserExtensionSpecifics = Schema.Struct({
	kind: Schema.Literal("ryot_browser_extension"),
	disabledSites: Schema.optional(Schema.Array(Schema.String)),
});

export const IntegrationProviderSpecifics = Schema.Union(
	KodiSpecifics,
	EmbySpecifics,
	KomgaSpecifics,
	RadarrSpecifics,
	SonarrSpecifics,
	PlexYankSpecifics,
	PlexSinkSpecifics,
	GenericJsonSpecifics,
	YoutubeMusicSpecifics,
	JellyfinSinkSpecifics,
	JellyfinPushSpecifics,
	AudiobookshelfSpecifics,
	RyotBrowserExtensionSpecifics,
);

export type IntegrationProviderSpecifics = typeof IntegrationProviderSpecifics.Type;

export const IntegrationExtraSettings = Schema.Struct({
	disableOnContinuousErrors: Schema.Boolean,
});

export type IntegrationExtraSettings = typeof IntegrationExtraSettings.Type;

export const ListedIntegration = Schema.Struct({
	id: IntegrationId,
	lot: IntegrationLot,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isDisabled: Schema.Boolean,
	provider: IntegrationProvider,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	name: Schema.NullOr(Schema.String),
	extraSettings: IntegrationExtraSettings,
	providerSpecifics: IntegrationProviderSpecifics,
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
});

export type ListedIntegration = typeof ListedIntegration.Type;

export const CreateIntegrationBody = Schema.Struct({
	provider: IntegrationProvider,
	name: Schema.optional(Schema.String),
	providerSpecifics: IntegrationProviderSpecifics,
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	extraSettings: Schema.optional(IntegrationExtraSettings),
});

export type CreateIntegrationBody = typeof CreateIntegrationBody.Type;

export const UpdateIntegrationBody = Schema.Struct({
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	extraSettings: Schema.optional(IntegrationExtraSettings),
	providerSpecifics: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type UpdateIntegrationBody = typeof UpdateIntegrationBody.Type;
