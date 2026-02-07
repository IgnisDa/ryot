export const importRunStatuses = ["pending", "running", "completed", "failed"] as const;

export type ImportRunStatus = (typeof importRunStatuses)[number];

export const importRunFailureStages = [
	"source_fetch",
	"database_commit",
	"provider_details",
	"provider_resolution",
	"event_before_trigger",
	"input_transformation",
] as const;

export type ImportRunFailureStage = (typeof importRunFailureStages)[number];

const importRunSources = [
	"emby",
	"hevy",
	"igdb",
	"imdb",
	"kodi",
	"plex",
	"komga",
	"trakt",
	"movary",
	"radarr",
	"sonarr",
	"anilist",
	"grouvee",
	"netflix",
	"jellyfin",
	"watcharr",
	"goodreads",
	"hardcover",
	"plex_sink",
	"plex_yank",
	"open_scale",
	"storygraph",
	"strong_app",
	"myanimelist",
	"generic_json",
	"media_tracker",
	"jellyfin_push",
	"jellyfin_sink",
	"youtube_music",
	"audiobookshelf",
	"ryot_browser_extension",
] as const;

export type ImportRunSource = (typeof importRunSources)[number];
