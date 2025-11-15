export const integrationLots = ["yank", "sink", "push"] as const;

export const integrationProviders = [
	"emby",
	"kodi",
	"komga",
	"radarr",
	"sonarr",
	"plex_sink",
	"plex_yank",
	"generic_json",
	"youtube_music",
	"jellyfin_push",
	"jellyfin_sink",
	"audiobookshelf",
	"ryot_browser_extension",
] as const;

const sinkProviders = [
	"kodi",
	"emby",
	"plex_sink",
	"generic_json",
	"jellyfin_sink",
	"ryot_browser_extension",
] as const;

export type IntegrationLot = (typeof integrationLots)[number];
export type IntegrationProvider = (typeof integrationProviders)[number];

export const isIntegrationProvider = (provider: string): provider is IntegrationProvider =>
	integrationProviders.some((candidate) => candidate === provider);

export const providerLotByProvider: Record<IntegrationProvider, IntegrationLot> = {
	emby: "sink",
	kodi: "sink",
	komga: "yank",
	radarr: "push",
	sonarr: "push",
	plex_sink: "sink",
	plex_yank: "yank",
	generic_json: "sink",
	youtube_music: "yank",
	jellyfin_push: "push",
	jellyfin_sink: "sink",
	audiobookshelf: "yank",
	ryot_browser_extension: "sink",
};

export const isSinkProvider = (provider: string): provider is (typeof sinkProviders)[number] =>
	sinkProviders.some((candidate) => candidate === provider);
