import { NOTIFICATION_SCRIPT_SLUG } from "#modules/automations/notification-install";

import mediaEntityChangedScriptCode from "./sandbox-scripts/automations/media-entity-changed.sandbox.js" with { type: "text" };
import mediaRelationshipChangedScriptCode from "./sandbox-scripts/automations/media-relationship-changed.sandbox.js" with { type: "text" };
import reviewCreatedScriptCode from "./sandbox-scripts/automations/review-created.sandbox.js" with { type: "text" };
import sendSignalNotificationScriptCode from "./sandbox-scripts/automations/send-signal-notification.sandbox.js" with { type: "text" };
import workoutCreatedScriptCode from "./sandbox-scripts/automations/workout-created.sandbox.js" with { type: "text" };
import anilistCompanyScriptCode from "./sandbox-scripts/providers/company/anilist.sandbox.js" with { type: "text" };
import giantBombCompanyScriptCode from "./sandbox-scripts/providers/company/giant-bomb.sandbox.js" with { type: "text" };
import hardcoverCompanyScriptCode from "./sandbox-scripts/providers/company/hardcover.sandbox.js" with { type: "text" };
import igdbCompanyScriptCode from "./sandbox-scripts/providers/company/igdb.sandbox.js" with { type: "text" };
import tmdbCompanyScriptCode from "./sandbox-scripts/providers/company/tmdb.sandbox.js" with { type: "text" };
import tvdbCompanyScriptCode from "./sandbox-scripts/providers/company/tvdb.sandbox.js" with { type: "text" };
import vndbCompanyScriptCode from "./sandbox-scripts/providers/company/vndb.sandbox.js" with { type: "text" };
import freeExerciseDbScriptCode from "./sandbox-scripts/providers/fitness/exercise/free-exercise-db.sandbox.js" with { type: "text" };
import audibleAudiobookGroupScriptCode from "./sandbox-scripts/providers/media-group/audible.sandbox.js" with { type: "text" };
import giantBombVideoGameGroupScriptCode from "./sandbox-scripts/providers/media-group/giant-bomb.sandbox.js" with { type: "text" };
import hardcoverBookGroupScriptCode from "./sandbox-scripts/providers/media-group/hardcover.sandbox.js" with { type: "text" };
import igdbVideoGameGroupScriptCode from "./sandbox-scripts/providers/media-group/igdb.sandbox.js" with { type: "text" };
import metronComicBookGroupScriptCode from "./sandbox-scripts/providers/media-group/metron.sandbox.js" with { type: "text" };
import musicBrainzMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/music-brainz.sandbox.js" with { type: "text" };
import spotifyMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/spotify.sandbox.js" with { type: "text" };
import tmdbMovieGroupScriptCode from "./sandbox-scripts/providers/media-group/tmdb.sandbox.js" with { type: "text" };
import tvdbMovieGroupScriptCode from "./sandbox-scripts/providers/media-group/tvdb.sandbox.js" with { type: "text" };
import youtubeMusicGroupScriptCode from "./sandbox-scripts/providers/media-group/youtube-music.sandbox.js" with { type: "text" };
import anilistAnimeScriptCode from "./sandbox-scripts/providers/media/anime/anilist.sandbox.js" with { type: "text" };
import myanimelistAnimeScriptCode from "./sandbox-scripts/providers/media/anime/myanimelist.sandbox.js" with { type: "text" };
import audibleAudiobookScriptCode from "./sandbox-scripts/providers/media/audiobook/audible.sandbox.js" with { type: "text" };
import googleBooksBookScriptCode from "./sandbox-scripts/providers/media/book/google-books.sandbox.js" with { type: "text" };
import hardcoverBookScriptCode from "./sandbox-scripts/providers/media/book/hardcover.sandbox.js" with { type: "text" };
import openLibraryBookScriptCode from "./sandbox-scripts/providers/media/book/openlibrary.sandbox.js" with { type: "text" };
import metronComicBookScriptCode from "./sandbox-scripts/providers/media/comic-book/metron.sandbox.js" with { type: "text" };
import anilistMangaScriptCode from "./sandbox-scripts/providers/media/manga/anilist.sandbox.js" with { type: "text" };
import mangaUpdatesMangaScriptCode from "./sandbox-scripts/providers/media/manga/manga-updates.sandbox.js" with { type: "text" };
import myanimelistMangaScriptCode from "./sandbox-scripts/providers/media/manga/myanimelist.sandbox.js" with { type: "text" };
import tmdbMovieScriptCode from "./sandbox-scripts/providers/media/movie/tmdb.sandbox.js" with { type: "text" };
import tvdbMovieScriptCode from "./sandbox-scripts/providers/media/movie/tvdb.sandbox.js" with { type: "text" };
import musicBrainzMusicScriptCode from "./sandbox-scripts/providers/media/music/music-brainz.sandbox.js" with { type: "text" };
import spotifyMusicScriptCode from "./sandbox-scripts/providers/media/music/spotify.sandbox.js" with { type: "text" };
import youtubeMusicScriptCode from "./sandbox-scripts/providers/media/music/youtube-music.sandbox.js" with { type: "text" };
import itunesPodcastScriptCode from "./sandbox-scripts/providers/media/podcast/itunes.sandbox.js" with { type: "text" };
import listennotesPodcastScriptCode from "./sandbox-scripts/providers/media/podcast/listennotes.sandbox.js" with { type: "text" };
import tmdbShowScriptCode from "./sandbox-scripts/providers/media/show/tmdb.sandbox.js" with { type: "text" };
import tvdbShowScriptCode from "./sandbox-scripts/providers/media/show/tvdb.sandbox.js" with { type: "text" };
import giantBombVideoGameScriptCode from "./sandbox-scripts/providers/media/video-game/giant-bomb.sandbox.js" with { type: "text" };
import igdbVideoGameScriptCode from "./sandbox-scripts/providers/media/video-game/igdb.sandbox.js" with { type: "text" };
import vndbVisualNovelScriptCode from "./sandbox-scripts/providers/media/visual-novel/vndb.sandbox.js" with { type: "text" };
import anilistPersonScriptCode from "./sandbox-scripts/providers/person/anilist.sandbox.js" with { type: "text" };
import audiblePersonScriptCode from "./sandbox-scripts/providers/person/audible.sandbox.js" with { type: "text" };
import giantBombPersonScriptCode from "./sandbox-scripts/providers/person/giant-bomb.sandbox.js" with { type: "text" };
import hardcoverPersonScriptCode from "./sandbox-scripts/providers/person/hardcover.sandbox.js" with { type: "text" };
import mangaUpdatesPersonScriptCode from "./sandbox-scripts/providers/person/manga-updates.sandbox.js" with { type: "text" };
import metronPersonScriptCode from "./sandbox-scripts/providers/person/metron.sandbox.js" with { type: "text" };
import musicBrainzPersonScriptCode from "./sandbox-scripts/providers/person/music-brainz.sandbox.js" with { type: "text" };
import openLibraryPersonScriptCode from "./sandbox-scripts/providers/person/openlibrary.sandbox.js" with { type: "text" };
import spotifyPersonScriptCode from "./sandbox-scripts/providers/person/spotify.sandbox.js" with { type: "text" };
import tmdbPersonScriptCode from "./sandbox-scripts/providers/person/tmdb.sandbox.js" with { type: "text" };
import tvdbPersonScriptCode from "./sandbox-scripts/providers/person/tvdb.sandbox.js" with { type: "text" };
import youtubeMusicPersonScriptCode from "./sandbox-scripts/providers/person/youtube-music.sandbox.js" with { type: "text" };
import integrationPushHelperCode from "./sandbox-scripts/script-helpers/integration-push.sandbox.js" with { type: "text" };
import titleCaseDelimiterHelperCode from "./sandbox-scripts/script-helpers/title-case-delimiters.sandbox.js" with { type: "text" };
import titleCaseHelperCode from "./sandbox-scripts/script-helpers/title-case.sandbox.js" with { type: "text" };
import autoCompleteOnFullProgressScriptCode from "./sandbox-scripts/triggers/auto-complete-on-full-progress.sandbox.js" with { type: "text" };
import integrationProgressPolicyScriptCode from "./sandbox-scripts/triggers/integration-progress-policy.sandbox.js" with { type: "text" };
import jellyfinPushScriptCode from "./sandbox-scripts/triggers/jellyfin-push.sandbox.js" with { type: "text" };
import radarrPushScriptCode from "./sandbox-scripts/triggers/radarr-push.sandbox.js" with { type: "text" };
import sonarrPushScriptCode from "./sandbox-scripts/triggers/sonarr-push.sandbox.js" with { type: "text" };

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

const injectHelpers = (helperCode: string, names: string, code: string) =>
	`const { ${names} } = (function () {\n${helperCode}\n})();\n\n${code}`;

const withTitleCaseHelper = (code: string) =>
	injectHelpers(titleCaseHelperCode, "toTitleCase", code);

const withDelimiterTitleCaseHelper = (code: string) =>
	injectHelpers(titleCaseDelimiterHelperCode, "toTitleCase", code);

const withPushHelpers = (code: string) =>
	injectHelpers(
		integrationPushHelperCode,
		"normalizeBaseUrl, parseJsonBody, integrationsDisabledForUser, listActiveIntegrations, fetchEntity, resolveEntityProviderName, collectionSyncMatches",
		code,
	);

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
	{
		code: mediaEntityChangedScriptCode,
		name: "Media Entity Changed Detector",
		slug: "automation.media-entity-changed",
		metadata: { allowedHostFunctions: ["emitSignal"] },
	},
	{
		code: mediaRelationshipChangedScriptCode,
		name: "Media Relationship Changed Detector",
		slug: "automation.media-relationship-changed",
		metadata: { allowedHostFunctions: ["emitSignal"] },
	},
	{
		slug: NOTIFICATION_SCRIPT_SLUG,
		name: "Send Signal Notification",
		code: sendSignalNotificationScriptCode,
		metadata: { allowedHostFunctions: ["sendNotification"] },
	},
	{
		code: reviewCreatedScriptCode,
		name: "Review Created Detector",
		slug: "automation.review-created",
		metadata: { allowedHostFunctions: ["emitSignal"] },
	},
	{
		code: workoutCreatedScriptCode,
		name: "Workout Created Detector",
		slug: "automation.workout-created",
		metadata: { allowedHostFunctions: ["emitSignal"] },
	},
	providerScript(
		"Free Exercise DB",
		"exercise.free-exercise-db",
		freeExerciseDbScriptCode,
		"free-exercise-db",
	),
	providerScript(
		"OpenLibrary",
		"book.openlibrary",
		withTitleCaseHelper(openLibraryBookScriptCode),
		"openlibrary",
	),
	providerScript(
		"Audible",
		"audiobook.audible",
		withTitleCaseHelper(audibleAudiobookScriptCode),
		"audible",
	),
	translatedProviderScript("iTunes", "podcast.itunes", itunesPodcastScriptCode, "itunes", "en"),
	providerScript("VNDB", "visual-novel.vndb", vndbVisualNovelScriptCode, "vndb"),
	translatedProviderScript(
		"Anilist",
		"anime.anilist",
		withDelimiterTitleCaseHelper(anilistAnimeScriptCode),
		"anilist",
		"en",
	),
	translatedProviderScript(
		"Anilist",
		"manga.anilist",
		withDelimiterTitleCaseHelper(anilistMangaScriptCode),
		"anilist",
		"en",
	),
	providerScript("Anilist", "company.anilist", anilistCompanyScriptCode, "anilist"),
	providerScript("GiantBomb", "company.giant-bomb", giantBombCompanyScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	providerScript("Hardcover", "company.hardcover", hardcoverCompanyScriptCode, "hardcover", [
		"providers.hardcoverApiKey",
	]),
	providerScript("IGDB", "company.igdb", igdbCompanyScriptCode, "igdb", [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	providerScript("TMDB", "company.tmdb", tmdbCompanyScriptCode, "tmdb", [
		"providers.tmdbAccessToken",
	]),
	providerScript("TVDB", "company.tvdb", tvdbCompanyScriptCode, "tvdb", ["providers.tvdbApiKey"]),
	providerScript("VNDB", "company.vndb", vndbCompanyScriptCode, "vndb"),
	providerScript("Anilist", "person.anilist", anilistPersonScriptCode, "anilist"),
	providerScript("Audible", "person.audible", audiblePersonScriptCode, "audible"),
	providerScript("GiantBomb", "person.giant-bomb", giantBombPersonScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	providerScript(
		"MangaUpdates",
		"person.manga-updates",
		mangaUpdatesPersonScriptCode,
		"manga-updates",
	),
	providerScript(
		"MangaUpdates",
		"manga.manga-updates",
		mangaUpdatesMangaScriptCode,
		"manga-updates",
	),
	providerScript("MusicBrainz", "music.music-brainz", musicBrainzMusicScriptCode, "music-brainz"),
	providerScript("MusicBrainz", "person.music-brainz", musicBrainzPersonScriptCode, "music-brainz"),
	providerScript("OpenLibrary", "person.openlibrary", openLibraryPersonScriptCode, "openlibrary"),
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
	providerScript(
		"Hardcover",
		"book.hardcover",
		withTitleCaseHelper(hardcoverBookScriptCode),
		"hardcover",
		["providers.hardcoverApiKey"],
	),
	providerScript("Hardcover", "person.hardcover", hardcoverPersonScriptCode, "hardcover", [
		"providers.hardcoverApiKey",
	]),
	providerScript(
		"Google Books",
		"book.google-books",
		withTitleCaseHelper(googleBooksBookScriptCode),
		"google-books",
		["providers.googleBooksApiKey"],
	),
	providerScript(
		"ListenNotes",
		"podcast.listennotes",
		listennotesPodcastScriptCode,
		"listennotes",
		["providers.listennotesApiKey"],
	),
	providerScript("GiantBomb", "video-game.giant-bomb", giantBombVideoGameScriptCode, "giant-bomb", [
		"providers.giantBombApiKey",
	]),
	translatedProviderScript("TMDB", "movie.tmdb", tmdbMovieScriptCode, "tmdb", "en", [
		"providers.tmdbAccessToken",
	]),
	translatedProviderScript("TMDB", "show.tmdb", tmdbShowScriptCode, "tmdb", "en", [
		"providers.tmdbAccessToken",
	]),
	translatedProviderScript("TMDB", "person.tmdb", tmdbPersonScriptCode, "tmdb", "en", [
		"providers.tmdbAccessToken",
	]),
	translatedProviderScript("TVDB", "movie.tvdb", tvdbMovieScriptCode, "tvdb", "en", [
		"providers.tvdbApiKey",
	]),
	translatedProviderScript("TVDB", "show.tvdb", tvdbShowScriptCode, "tvdb", "en", [
		"providers.tvdbApiKey",
	]),
	translatedProviderScript("TVDB", "person.tvdb", tvdbPersonScriptCode, "tvdb", "en", [
		"providers.tvdbApiKey",
	]),
	providerScript(
		"MyAnimeList",
		"anime.myanimelist",
		withDelimiterTitleCaseHelper(myanimelistAnimeScriptCode),
		"myanimelist",
		["providers.malClientId"],
	),
	providerScript(
		"MyAnimeList",
		"manga.myanimelist",
		withDelimiterTitleCaseHelper(myanimelistMangaScriptCode),
		"myanimelist",
		["providers.malClientId"],
	),
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
	translatedProviderScript("TMDB", "movie-group.tmdb", tmdbMovieGroupScriptCode, "tmdb", "en", [
		"providers.tmdbAccessToken",
	]),
	translatedProviderScript("TVDB", "movie-group.tvdb", tvdbMovieGroupScriptCode, "tvdb", "en", [
		"providers.tvdbApiKey",
	]),
	providerScript("Audible", "audiobook-group.audible", audibleAudiobookGroupScriptCode, "audible"),
	providerScript("Hardcover", "book-group.hardcover", hardcoverBookGroupScriptCode, "hardcover", [
		"providers.hardcoverApiKey",
	]),
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
	{
		name: "Auto-Complete on Full Progress",
		code: autoCompleteOnFullProgressScriptCode,
		slug: "trigger.auto-complete-on-full-progress",
		metadata: {
			allowedHostFunctions: ["getEntity", "listEvents", "createEvents", "listEventSchemas"],
		},
	},
	{
		name: "Integration Progress Policy",
		code: integrationProgressPolicyScriptCode,
		slug: "trigger.integration-progress-policy",
		metadata: {
			allowedHostFunctions: [
				"listEvents",
				"getIntegration",
				"claimCachedValue",
				"getAppConfigValue",
			],
		},
	},
	{
		name: "Radarr Push",
		slug: "trigger.radarr-push",
		code: withPushHelpers(radarrPushScriptCode),
		metadata: {
			allowedHostFunctions: [
				"httpCall",
				"getEntity",
				"getEntitySchema",
				"listIntegrations",
				"getUserPreferences",
			],
		},
	},
	{
		name: "Sonarr Push",
		slug: "trigger.sonarr-push",
		code: withPushHelpers(sonarrPushScriptCode),
		metadata: {
			allowedHostFunctions: [
				"httpCall",
				"getEntity",
				"getEntitySchema",
				"listIntegrations",
				"getUserPreferences",
			],
		},
	},
	{
		name: "Jellyfin Push",
		slug: "trigger.jellyfin-push",
		code: withPushHelpers(jellyfinPushScriptCode),
		metadata: {
			allowedHostFunctions: [
				"httpCall",
				"getEntity",
				"getEntitySchema",
				"listIntegrations",
				"getUserPreferences",
			],
		},
	},
];
