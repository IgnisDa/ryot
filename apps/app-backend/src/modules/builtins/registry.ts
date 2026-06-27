import {
	type GeneratedBuiltinSandboxScript,
	sandboxAnimeDotAnilistScript,
	sandboxAnimeDotMyanimelistScript,
	sandboxAudiobookDashGroupDotAudibleScript,
	sandboxAudiobookDotAudibleScript,
	sandboxBookDashGroupDotHardcoverScript,
	sandboxBookDotGoogleDashBooksScript,
	sandboxBookDotHardcoverScript,
	sandboxBookDotOpenlibraryScript,
	sandboxCompanyDotAnilistScript,
	sandboxCompanyDotHardcoverScript,
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	sandboxMangaDotAnilistScript,
	sandboxMangaDotMangaDashUpdatesScript,
	sandboxMangaDotMyanimelistScript,
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxMovieDotTmdbScript,
	sandboxMovieDotTvdbScript,
	sandboxPersonDotAnilistScript,
	sandboxPersonDotAudibleScript,
	sandboxPersonDotHardcoverScript,
	sandboxPersonDotMangaDashUpdatesScript,
	sandboxPersonDotOpenlibraryScript,
	sandboxPersonDotTmdbScript,
	sandboxPersonDotTvdbScript,
	sandboxPodcastDotItunesScript,
	sandboxPodcastDotListennotesScript,
	sandboxShowDotTmdbScript,
	sandboxShowDotTvdbScript,
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
	sandboxTriggerDotJellyfinDashPushScript,
	sandboxTriggerDotRadarrDashPushScript,
	sandboxTriggerDotSonarrDashPushScript,
} from "./generated-sandbox/registry";
import giantBombCompanyScriptCode from "./sandbox-scripts/providers/company/giant-bomb.sandbox.js" with { type: "text" };
import igdbCompanyScriptCode from "./sandbox-scripts/providers/company/igdb.sandbox.js" with { type: "text" };
import vndbCompanyScriptCode from "./sandbox-scripts/providers/company/vndb.sandbox.js" with { type: "text" };
import freeExerciseDbScriptCode from "./sandbox-scripts/providers/fitness/exercise/free-exercise-db.sandbox.js" with { type: "text" };
import giantBombVideoGameGroupScriptCode from "./sandbox-scripts/providers/media-group/giant-bomb.sandbox.js" with { type: "text" };
import igdbVideoGameGroupScriptCode from "./sandbox-scripts/providers/media-group/igdb.sandbox.js" with { type: "text" };
import metronComicBookGroupScriptCode from "./sandbox-scripts/providers/media-group/metron.sandbox.js" with { type: "text" };
import musicBrainzMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/music-brainz.sandbox.js" with { type: "text" };
import spotifyMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/spotify.sandbox.js" with { type: "text" };
import youtubeMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/youtube-music.sandbox.js" with { type: "text" };
import metronComicBookScriptCode from "./sandbox-scripts/providers/media/comic-book/metron.sandbox.js" with { type: "text" };
import musicBrainzMusicScriptCode from "./sandbox-scripts/providers/media/music/music-brainz.sandbox.js" with { type: "text" };
import spotifyMusicScriptCode from "./sandbox-scripts/providers/media/music/spotify.sandbox.js" with { type: "text" };
import youtubeMusicScriptCode from "./sandbox-scripts/providers/media/music/youtube-music.sandbox.js" with { type: "text" };
import giantBombVideoGameScriptCode from "./sandbox-scripts/providers/media/video-game/giant-bomb.sandbox.js" with { type: "text" };
import igdbVideoGameScriptCode from "./sandbox-scripts/providers/media/video-game/igdb.sandbox.js" with { type: "text" };
import vndbVisualNovelScriptCode from "./sandbox-scripts/providers/media/visual-novel/vndb.sandbox.js" with { type: "text" };
import giantBombPersonScriptCode from "./sandbox-scripts/providers/person/giant-bomb.sandbox.js" with { type: "text" };
import metronPersonScriptCode from "./sandbox-scripts/providers/person/metron.sandbox.js" with { type: "text" };
import musicBrainzPersonScriptCode from "./sandbox-scripts/providers/person/music-brainz.sandbox.js" with { type: "text" };
import spotifyPersonScriptCode from "./sandbox-scripts/providers/person/spotify.sandbox.js" with { type: "text" };
import youtubeMusicPersonScriptCode from "./sandbox-scripts/providers/person/youtube-music.sandbox.js" with { type: "text" };

const BUILTIN_ALLOWED_HOST_FUNCTIONS: string[] = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
];

const script = (
	name: string,
	slug: string,
	code: string,
	requiredAppConfigKeys?: string[],
	providerInformation?: { source: string; canonicalLanguage?: string },
) => ({
	name,
	slug,
	code,
	metadata: {
		providerInformation,
		requiredAppConfigKeys,
		allowedHostFunctions: BUILTIN_ALLOWED_HOST_FUNCTIONS,
	},
});

const providerScript = (
	name: string,
	slug: string,
	code: string,
	source: string,
	requiredAppConfigKeys?: string[],
) => script(name, slug, code, requiredAppConfigKeys, { source });

const translatedProviderScript = (
	name: string,
	slug: string,
	code: string,
	source: string,
	canonicalLanguage: string,
	requiredAppConfigKeys?: string[],
) => script(name, slug, code, requiredAppConfigKeys, { source, canonicalLanguage });

export const builtinSandboxScripts = () => [
	providerScript(
		"Free Exercise DB",
		"exercise.free-exercise-db",
		freeExerciseDbScriptCode,
		"free-exercise-db",
	),
	sandboxBookDotOpenlibraryScript,
	sandboxAudiobookDotAudibleScript,
	sandboxPodcastDotItunesScript,
	providerScript("VNDB", "visual-novel.vndb", vndbVisualNovelScriptCode, "vndb"),
	sandboxAnimeDotAnilistScript,
	sandboxMangaDotAnilistScript,
	sandboxCompanyDotAnilistScript,
	providerScript("GiantBomb", "company.giant-bomb", giantBombCompanyScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	sandboxCompanyDotHardcoverScript,
	providerScript("IGDB", "company.igdb", igdbCompanyScriptCode, "igdb", [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	providerScript("VNDB", "company.vndb", vndbCompanyScriptCode, "vndb"),
	sandboxPersonDotAnilistScript,
	sandboxPersonDotAudibleScript,
	providerScript("GiantBomb", "person.giant-bomb", giantBombPersonScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	sandboxPersonDotMangaDashUpdatesScript,
	sandboxMangaDotMangaDashUpdatesScript,
	providerScript("MusicBrainz", "music.music-brainz", musicBrainzMusicScriptCode, "music-brainz"),
	providerScript("MusicBrainz", "person.music-brainz", musicBrainzPersonScriptCode, "music-brainz"),
	sandboxPersonDotOpenlibraryScript,
	translatedProviderScript(
		"YouTube Music",
		"music.youtube-music",
		youtubeMusicScriptCode,
		"youtube-music",
		"en",
	),
	translatedProviderScript(
		"YouTube Music",
		"person.youtube-music",
		youtubeMusicPersonScriptCode,
		"youtube-music",
		"en",
	),
	sandboxBookDotHardcoverScript,
	sandboxPersonDotHardcoverScript,
	sandboxBookDotGoogleDashBooksScript,
	sandboxPodcastDotListennotesScript,
	providerScript("GiantBomb", "video-game.giant-bomb", giantBombVideoGameScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	sandboxMovieDotTmdbScript,
	sandboxShowDotTmdbScript,
	sandboxPersonDotTmdbScript,
	sandboxMovieDotTvdbScript,
	sandboxShowDotTvdbScript,
	sandboxPersonDotTvdbScript,
	sandboxAnimeDotMyanimelistScript,
	sandboxMangaDotMyanimelistScript,
	providerScript("Metron", "comic-book.metron", metronComicBookScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	providerScript("Metron", "person.metron", metronPersonScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	providerScript("Spotify", "music.spotify", spotifyMusicScriptCode, "spotify", [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	providerScript("Spotify", "person.spotify", spotifyPersonScriptCode, "spotify", [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	providerScript("IGDB", "video-game.igdb", igdbVideoGameScriptCode, "igdb", [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxAudiobookDashGroupDotAudibleScript,
	sandboxBookDashGroupDotHardcoverScript,
	providerScript("Metron", "comic-book-group.metron", metronComicBookGroupScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	providerScript("Spotify", "music-group.spotify", spotifyMusicGroupScriptCode, "spotify", [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	providerScript(
		"MusicBrainz",
		"music-group.music-brainz",
		musicBrainzMusicGroupScriptCode,
		"music-brainz",
	),
	translatedProviderScript(
		"YouTube Music",
		"music-group.youtube-music",
		youtubeMusicGroupScriptCode,
		"youtube-music",
		"en",
	),
	providerScript("IGDB", "video-game-group.igdb", igdbVideoGameGroupScriptCode, "igdb", [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	providerScript(
		"GiantBomb",
		"video-game-group.giant-bomb",
		giantBombVideoGameGroupScriptCode,
		"giant-bomb",
		["providers.giantBombApiKey"],
	),
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
	sandboxTriggerDotRadarrDashPushScript,
	sandboxTriggerDotSonarrDashPushScript,
	sandboxTriggerDotJellyfinDashPushScript,
];

export const entitySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "show", scriptSlug: "show.tmdb" },
		{ schemaSlug: "show", scriptSlug: "show.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tmdb" },
		{ schemaSlug: "music", scriptSlug: "music.spotify" },
		{ schemaSlug: "manga", scriptSlug: "manga.anilist" },
		{ schemaSlug: "anime", scriptSlug: "anime.anilist" },
		{ schemaSlug: "book", scriptSlug: "book.hardcover" },
		{ schemaSlug: "book", scriptSlug: "book.openlibrary" },
		{ schemaSlug: "book", scriptSlug: "book.google-books" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.itunes" },
		{ schemaSlug: "music", scriptSlug: "music.music-brainz" },
		{ schemaSlug: "anime", scriptSlug: "anime.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.manga-updates" },
		{ schemaSlug: "music", scriptSlug: "music.youtube-music" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.igdb" },
		{ schemaSlug: "audiobook", scriptSlug: "audiobook.audible" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.listennotes" },
		{ schemaSlug: "comic-book", scriptSlug: "comic-book.metron" },
		{ schemaSlug: "visual-novel", scriptSlug: "visual-novel.vndb" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.giant-bomb" },
	] as const;

export const fitnessSchemaSandboxScriptLinks = () =>
	[{ schemaSlug: "exercise", scriptSlug: "exercise.free-exercise-db" }] as const;

const triggerLink = (
	entry: GeneratedBuiltinSandboxScript,
	input: {
		readonly position: number;
		readonly eventSchemaSlug: string;
		readonly metadata: { readonly inheritedProperties?: readonly string[] };
	},
) => {
	if (entry.manifest.kind !== "trigger") {
		throw new Error(`Built-in trigger link requires a trigger manifest: ${entry.slug}`);
	}
	return { ...input, scriptSlug: entry.slug, triggerName: entry.name, phase: entry.manifest.mode };
};

export const builtinEventSchemaTriggerLinks = () => [
	triggerLink(sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript, {
		position: 1000,
		eventSchemaSlug: "progress",
		metadata: { inheritedProperties: ["consumedOn"] },
	}),
	triggerLink(sandboxTriggerDotIntegrationDashProgressDashPolicyScript, {
		metadata: {},
		position: 100,
		eventSchemaSlug: "progress",
	}),
	triggerLink(sandboxTriggerDotRadarrDashPushScript, {
		metadata: {},
		position: 1000,
		eventSchemaSlug: "add-entity-to-collection",
	}),
	triggerLink(sandboxTriggerDotSonarrDashPushScript, {
		metadata: {},
		position: 1000,
		eventSchemaSlug: "add-entity-to-collection",
	}),
	triggerLink(sandboxTriggerDotJellyfinDashPushScript, {
		metadata: {},
		position: 1000,
		eventSchemaSlug: "complete",
	}),
];

export const personSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.tmdb" },
		{ schemaSlug: "person", scriptSlug: "person.tvdb" },
		{ schemaSlug: "person", scriptSlug: "person.metron" },
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.audible" },
		{ schemaSlug: "person", scriptSlug: "person.spotify" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
		{ schemaSlug: "person", scriptSlug: "person.music-brainz" },
		{ schemaSlug: "person", scriptSlug: "person.openlibrary" },
		{ schemaSlug: "person", scriptSlug: "person.youtube-music" },
		{ schemaSlug: "person", scriptSlug: "person.giant-bomb" },
		{ schemaSlug: "person", scriptSlug: "person.manga-updates" },
	] as const;

export const companySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "company", scriptSlug: "company.igdb" },
		{ schemaSlug: "company", scriptSlug: "company.tmdb" },
		{ schemaSlug: "company", scriptSlug: "company.tvdb" },
		{ schemaSlug: "company", scriptSlug: "company.vndb" },
		{ schemaSlug: "company", scriptSlug: "company.anilist" },
		{ schemaSlug: "company", scriptSlug: "company.hardcover" },
		{ schemaSlug: "company", scriptSlug: "company.giant-bomb" },
	] as const;

export const groupSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tmdb" },
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tvdb" },
		{ schemaSlug: "book-group", scriptSlug: "book-group.hardcover" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.spotify" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.music-brainz" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.youtube-music" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.igdb" },
		{ schemaSlug: "audiobook-group", scriptSlug: "audiobook-group.audible" },
		{ schemaSlug: "comic-book-group", scriptSlug: "comic-book-group.metron" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.giant-bomb" },
	] as const;
