import { z } from "@hono/zod-openapi";

import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import { createIdParamsSchema, nonEmptyStringSchema } from "~/lib/zod";

export const integrationLot = z.enum(["yank", "sink", "push"]);
export type IntegrationLot = z.infer<typeof integrationLot>;

export const integrationProvider = z.enum([
	"audiobookshelf",
	"emby",
	"generic_json",
	"jellyfin_push",
	"jellyfin_sink",
	"kodi",
	"komga",
	"plex_sink",
	"plex_yank",
	"radarr",
	"ryot_browser_extension",
	"sonarr",
	"youtube_music",
]);
export type IntegrationProvider = z.infer<typeof integrationProvider>;

const sinkProviders = [
	"kodi",
	"emby",
	"plex_sink",
	"generic_json",
	"jellyfin_sink",
	"ryot_browser_extension",
] as const;

export const isSinkProvider = (provider: string): provider is (typeof sinkProviders)[number] =>
	sinkProviders.some((sinkProvider) => sinkProvider === provider);

const kodiSpecifics = z.object({ kind: z.literal("kodi") }).strict();
const embySpecifics = z.object({ kind: z.literal("emby") }).strict();

const komgaSpecifics = z
	.object({
		apiKey: z.string(),
		baseUrl: z.string(),
		kind: z.literal("komga"),
	})
	.strict();

const radarrSpecifics = z
	.object({
		apiKey: z.string(),
		baseUrl: z.string(),
		profileId: z.string(),
		rootFolderPath: z.string(),
		kind: z.literal("radarr"),
		syncCollectionIds: z.array(z.string()),
		tagIds: z.array(z.number().int()).optional(),
	})
	.strict();

const sonarrSpecifics = z
	.object({
		apiKey: z.string(),
		baseUrl: z.string(),
		profileId: z.string(),
		rootFolderPath: z.string(),
		kind: z.literal("sonarr"),
		tagIds: z.number().int().optional(),
		syncCollectionIds: z.array(z.string()),
	})
	.strict();

const plexYankSpecifics = z
	.object({
		token: z.string(),
		baseUrl: z.string(),
		kind: z.literal("plex_yank"),
	})
	.strict();

const plexSinkSpecifics = z
	.object({
		username: z.string().optional(),
		kind: z.literal("plex_sink"),
	})
	.strict();

const genericJsonSpecifics = z.object({ kind: z.literal("generic_json") }).strict();

const youtubeMusicSpecifics = z
	.object({
		timezone: z.string(),
		authCookie: z.string(),
		kind: z.literal("youtube_music"),
	})
	.strict();

const jellyfinSinkSpecifics = z
	.object({
		username: z.string().optional(),
		kind: z.literal("jellyfin_sink"),
		metadataProvider: z.enum(["tmdb", "tvdb"]).optional(),
	})
	.strict();

const audiobookshelfSpecifics = z
	.object({
		token: z.string(),
		baseUrl: z.string(),
		kind: z.literal("audiobookshelf"),
	})
	.strict();

const jellyfinPushSpecifics = z
	.object({
		baseUrl: z.string(),
		username: z.string(),
		password: z.string().optional(),
		kind: z.literal("jellyfin_push"),
	})
	.strict();

const ryotBrowserExtensionSpecifics = z
	.object({
		kind: z.literal("ryot_browser_extension"),
		disabledSites: z.array(z.string()).optional(),
	})
	.strict();

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

export const createIntegrationBody = z.object({
	provider: integrationProvider,
	name: z.string().optional(),
	isDisabled: z.boolean().optional(),
	syncOwnership: z.boolean().optional(),
	providerSpecifics: integrationProviderSpecifics,
	extraSettings: integrationExtraSettings.optional(),
	minimumProgress: z.number().min(0).max(100).optional(),
	maximumProgress: z.number().min(0).max(100).optional(),
});
export type CreateIntegrationBody = z.infer<typeof createIntegrationBody>;

export const patchIntegrationBody = z.object({
	name: z.string().optional(),
	isDisabled: z.boolean().optional(),
	syncOwnership: z.boolean().optional(),
	extraSettings: integrationExtraSettings.optional(),
	minimumProgress: z.number().min(0).max(100).optional(),
	maximumProgress: z.number().min(0).max(100).optional(),
	providerSpecifics: z.record(z.string(), z.unknown()).optional(),
});
export type PatchIntegrationBody = z.infer<typeof patchIntegrationBody>;

export const listedIntegrationSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	lot: integrationLot,
	provider: integrationProvider,
	isDisabled: z.boolean(),
	syncOwnership: z.boolean(),
	name: z.string().nullable(),
	minimumProgress: z.string(),
	maximumProgress: z.string(),
	webhookUrl: z.string().optional(),
	lastFinishedAt: z.date().nullable(),
	extraSettings: integrationExtraSettings,
	providerSpecifics: integrationProviderSpecifics,
});
export type ListedIntegration = z.infer<typeof listedIntegrationSchema>;

export const integrationIdParams = createIdParamsSchema("integrationId");

export const listIntegrationsQuery = z.object({
	provider: integrationProvider.optional(),
	isDisabled: z
		.string()
		.optional()
		.transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
});

export const createIntegrationResponseSchema = itemDataSchema(
	z.object({ id: nonEmptyStringSchema }),
);
export const getIntegrationResponseSchema = itemDataSchema(listedIntegrationSchema);
export const listIntegrationsResponseSchema = listDataSchema(listedIntegrationSchema);

export const webhookResponseSchema = itemDataSchema(z.object({ runId: nonEmptyStringSchema }));
