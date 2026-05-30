import { z } from "@hono/zod-openapi";

export const integrationLot = z.enum(["yank", "sink", "push"]);
export type IntegrationLot = z.infer<typeof integrationLot>;

const kodiSpecifics = z.object({ kind: z.literal("kodi") });
const embySpecifics = z.object({ kind: z.literal("emby") });

const komgaSpecifics = z.object({
	apiKey: z.string(),
	baseUrl: z.string(),
	kind: z.literal("komga"),
});

const radarrSpecifics = z.object({
	apiKey: z.string(),
	baseUrl: z.string(),
	profileId: z.string(),
	rootFolderPath: z.string(),
	kind: z.literal("radarr"),
	syncCollectionIds: z.array(z.string()),
	tagIds: z.array(z.number().int()).optional(),
});

const sonarrSpecifics = z.object({
	apiKey: z.string(),
	baseUrl: z.string(),
	profileId: z.string(),
	rootFolderPath: z.string(),
	kind: z.literal("sonarr"),
	tagIds: z.number().int().optional(),
	syncCollectionIds: z.array(z.string()),
});

const plexYankSpecifics = z.object({
	token: z.string(),
	baseUrl: z.string(),
	kind: z.literal("plex_yank"),
});

const plexSinkSpecifics = z.object({
	username: z.string().optional(),
	kind: z.literal("plex_sink"),
});

const genericJsonSpecifics = z.object({ kind: z.literal("generic_json") });

const youtubeMusicSpecifics = z.object({
	timezone: z.string(),
	authCookie: z.string(),
	kind: z.literal("youtube_music"),
});

const jellyfinSinkSpecifics = z.object({
	username: z.string().optional(),
	kind: z.literal("jellyfin_sink"),
	metadataProvider: z.enum(["tmdb", "tvdb"]).optional(),
});

const audiobookshelfSpecifics = z.object({
	token: z.string(),
	baseUrl: z.string(),
	kind: z.literal("audiobookshelf"),
});

const jellyfinPushSpecifics = z.object({
	baseUrl: z.string(),
	username: z.string(),
	password: z.string().optional(),
	kind: z.literal("jellyfin_push"),
});

const ryotBrowserExtensionSpecifics = z.object({
	kind: z.literal("ryot_browser_extension"),
	disabledSites: z.array(z.string()).optional(),
});

export const integrationProviderSpecifics = z.discriminatedUnion("kind", [
	kodiSpecifics,
	embySpecifics,
	komgaSpecifics,
	radarrSpecifics,
	sonarrSpecifics,
	plexYankSpecifics,
	plexSinkSpecifics,
	genericJsonSpecifics,
	youtubeMusicSpecifics,
	jellyfinSinkSpecifics,
	jellyfinPushSpecifics,
	audiobookshelfSpecifics,
	ryotBrowserExtensionSpecifics,
]);
export type IntegrationProviderSpecifics = z.infer<typeof integrationProviderSpecifics>;

export const integrationExtraSettings = z.object({
	disableOnContinuousErrors: z.boolean(),
});
export type IntegrationExtraSettings = z.infer<typeof integrationExtraSettings>;
