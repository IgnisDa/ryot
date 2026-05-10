import anilistCompanyScriptCode from "#lib/sandbox/providers/company/anilist.txt";
import giantBombCompanyScriptCode from "#lib/sandbox/providers/company/giant-bomb.txt";
import hardcoverCompanyScriptCode from "#lib/sandbox/providers/company/hardcover.txt";
import igdbCompanyScriptCode from "#lib/sandbox/providers/company/igdb.txt";
import tmdbCompanyScriptCode from "#lib/sandbox/providers/company/tmdb.txt";
import tvdbCompanyScriptCode from "#lib/sandbox/providers/company/tvdb.txt";
import vndbCompanyScriptCode from "#lib/sandbox/providers/company/vndb.txt";
import freeExerciseDbScriptCode from "#lib/sandbox/providers/fitness/exercise/free-exercise-db.txt";
import audibleAudiobookGroupScriptCode from "#lib/sandbox/providers/media-group/audible.txt";
import giantBombVideoGameGroupScriptCode from "#lib/sandbox/providers/media-group/giant-bomb.txt";
import hardcoverBookGroupScriptCode from "#lib/sandbox/providers/media-group/hardcover.txt";
import igdbVideoGameGroupScriptCode from "#lib/sandbox/providers/media-group/igdb.txt";
import metronComicBookGroupScriptCode from "#lib/sandbox/providers/media-group/metron.txt";
import musicbrainzMusicGroupScriptCode from "#lib/sandbox/providers/media-group/musicbrainz.txt";
import spotifyMusicGroupScriptCode from "#lib/sandbox/providers/media-group/spotify.txt";
import tmdbMovieGroupScriptCode from "#lib/sandbox/providers/media-group/tmdb.txt";
import tvdbMovieGroupScriptCode from "#lib/sandbox/providers/media-group/tvdb.txt";
import youtubeMusicGroupScriptCode from "#lib/sandbox/providers/media-group/youtube-music.txt";
import anilistAnimeScriptCode from "#lib/sandbox/providers/media/anime/anilist.txt";
import myanimelistAnimeScriptCode from "#lib/sandbox/providers/media/anime/myanimelist.txt";
import audibleAudiobookScriptCode from "#lib/sandbox/providers/media/audiobook/audible.txt";
import googleBooksBookScriptCode from "#lib/sandbox/providers/media/book/google-books.txt";
import hardcoverBookScriptCode from "#lib/sandbox/providers/media/book/hardcover.txt";
import openLibraryBookScriptCode from "#lib/sandbox/providers/media/book/openlibrary.txt";
import metronComicBookScriptCode from "#lib/sandbox/providers/media/comic-book/metron.txt";
import anilistMangaScriptCode from "#lib/sandbox/providers/media/manga/anilist.txt";
import mangaUpdatesMangaScriptCode from "#lib/sandbox/providers/media/manga/manga-updates.txt";
import myanimelistMangaScriptCode from "#lib/sandbox/providers/media/manga/myanimelist.txt";
import tmdbMovieScriptCode from "#lib/sandbox/providers/media/movie/tmdb.txt";
import tvdbMovieScriptCode from "#lib/sandbox/providers/media/movie/tvdb.txt";
import musicbrainzMusicScriptCode from "#lib/sandbox/providers/media/music/musicbrainz.txt";
import spotifyMusicScriptCode from "#lib/sandbox/providers/media/music/spotify.txt";
import youtubeMusicScriptCode from "#lib/sandbox/providers/media/music/youtube-music.txt";
import itunesPodcastScriptCode from "#lib/sandbox/providers/media/podcast/itunes.txt";
import listennotesPodcastScriptCode from "#lib/sandbox/providers/media/podcast/listennotes.txt";
import tmdbShowScriptCode from "#lib/sandbox/providers/media/show/tmdb.txt";
import tvdbShowScriptCode from "#lib/sandbox/providers/media/show/tvdb.txt";
import giantBombVideoGameScriptCode from "#lib/sandbox/providers/media/video-game/giant-bomb.txt";
import igdbVideoGameScriptCode from "#lib/sandbox/providers/media/video-game/igdb.txt";
import vndbVisualNovelScriptCode from "#lib/sandbox/providers/media/visual-novel/vndb.txt";
import anilistPersonScriptCode from "#lib/sandbox/providers/person/anilist.txt";
import audiblePersonScriptCode from "#lib/sandbox/providers/person/audible.txt";
import giantBombPersonScriptCode from "#lib/sandbox/providers/person/giant-bomb.txt";
import hardcoverPersonScriptCode from "#lib/sandbox/providers/person/hardcover.txt";
import mangaUpdatesPersonScriptCode from "#lib/sandbox/providers/person/manga-updates.txt";
import metronPersonScriptCode from "#lib/sandbox/providers/person/metron.txt";
import musicbrainzPersonScriptCode from "#lib/sandbox/providers/person/musicbrainz.txt";
import openLibraryPersonScriptCode from "#lib/sandbox/providers/person/openlibrary.txt";
import spotifyPersonScriptCode from "#lib/sandbox/providers/person/spotify.txt";
import tmdbPersonScriptCode from "#lib/sandbox/providers/person/tmdb.txt";
import tvdbPersonScriptCode from "#lib/sandbox/providers/person/tvdb.txt";
import youtubeMusicPersonScriptCode from "#lib/sandbox/providers/person/youtube-music.txt";
import integrationPushHelperCode from "#lib/sandbox/shared/integration-push.txt";
import titleCaseDelimiterHelperCode from "#lib/sandbox/shared/title-case-delimiters.txt";
import titleCaseHelperCode from "#lib/sandbox/shared/title-case.txt";
import autoCompleteOnFullProgressScriptCode from "#lib/sandbox/triggers/auto-complete-on-full-progress.txt";
import integrationProgressPolicyScriptCode from "#lib/sandbox/triggers/integration-progress-policy.txt";
import jellyfinPushScriptCode from "#lib/sandbox/triggers/jellyfin-push.txt";
import radarrPushScriptCode from "#lib/sandbox/triggers/radarr-push.txt";
import sonarrPushScriptCode from "#lib/sandbox/triggers/sonarr-push.txt";

const BUILTIN_ALLOWED_HOST_FUNCTIONS: string[] = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
];

const script = (name: string, slug: string, code: string, requiredAppConfigKeys?: string[]) => ({
	name,
	slug,
	code,
	metadata: {
		requiredAppConfigKeys,
		allowedHostFunctions: BUILTIN_ALLOWED_HOST_FUNCTIONS,
	},
});

const withTitleCaseHelper = (code: string) => `${titleCaseHelperCode}\n\n${code}`;

const withDelimiterTitleCaseHelper = (code: string) => `${titleCaseDelimiterHelperCode}\n\n${code}`;

const withPushHelpers = (code: string) => `${integrationPushHelperCode}\n\n${code}`;

export const builtinSandboxScripts = () => [
	script("Free Exercise DB", "exercise.free-exercise-db", freeExerciseDbScriptCode),
	script("OpenLibrary", "book.openlibrary", withTitleCaseHelper(openLibraryBookScriptCode)),
	script("Audible", "audiobook.audible", withTitleCaseHelper(audibleAudiobookScriptCode)),
	script("iTunes", "podcast.itunes", itunesPodcastScriptCode),
	script("VNDB", "visual-novel.vndb", vndbVisualNovelScriptCode),
	script("Anilist", "anime.anilist", withDelimiterTitleCaseHelper(anilistAnimeScriptCode)),
	script("Anilist", "manga.anilist", withDelimiterTitleCaseHelper(anilistMangaScriptCode)),
	script("Anilist", "company.anilist", anilistCompanyScriptCode),
	script("GiantBomb", "company.giant-bomb", giantBombCompanyScriptCode, [
		"providers.giantBombApiKey",
	]),
	script("Hardcover", "company.hardcover", hardcoverCompanyScriptCode, [
		"providers.hardcoverApiKey",
	]),
	script("IGDB", "company.igdb", igdbCompanyScriptCode, [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	script("TMDB", "company.tmdb", tmdbCompanyScriptCode, ["providers.tmdbAccessToken"]),
	script("TVDB", "company.tvdb", tvdbCompanyScriptCode, ["providers.tvdbApiKey"]),
	script("VNDB", "company.vndb", vndbCompanyScriptCode),
	script("Anilist", "person.anilist", anilistPersonScriptCode),
	script("Audible", "person.audible", audiblePersonScriptCode),
	script("GiantBomb", "person.giant-bomb", giantBombPersonScriptCode, [
		"providers.giantBombApiKey",
	]),
	script("MangaUpdates", "person.manga-updates", mangaUpdatesPersonScriptCode),
	script("MangaUpdates", "manga.manga-updates", mangaUpdatesMangaScriptCode),
	script("MusicBrainz", "music.musicbrainz", musicbrainzMusicScriptCode),
	script("MusicBrainz", "person.musicbrainz", musicbrainzPersonScriptCode),
	script("OpenLibrary", "person.openlibrary", openLibraryPersonScriptCode),
	script("YouTube Music", "music.youtube-music", youtubeMusicScriptCode),
	script("YouTube Music", "person.youtube-music", youtubeMusicPersonScriptCode),
	script("Hardcover", "book.hardcover", withTitleCaseHelper(hardcoverBookScriptCode), [
		"providers.hardcoverApiKey",
	]),
	script("Hardcover", "person.hardcover", hardcoverPersonScriptCode, ["providers.hardcoverApiKey"]),
	script("Google Books", "book.google-book", withTitleCaseHelper(googleBooksBookScriptCode), [
		"providers.googleBooksApiKey",
	]),
	script("ListenNotes", "podcast.listennotes", listennotesPodcastScriptCode, [
		"providers.listennotesApiKey",
	]),
	script("GiantBomb", "video-game.giant-bomb", giantBombVideoGameScriptCode, [
		"providers.giantBombApiKey",
	]),
	script("TMDB", "movie.tmdb", tmdbMovieScriptCode, ["providers.tmdbAccessToken"]),
	script("TMDB", "show.tmdb", tmdbShowScriptCode, ["providers.tmdbAccessToken"]),
	script("TMDB", "person.tmdb", tmdbPersonScriptCode, ["providers.tmdbAccessToken"]),
	script("TVDB", "movie.tvdb", tvdbMovieScriptCode, ["providers.tvdbApiKey"]),
	script("TVDB", "show.tvdb", tvdbShowScriptCode, ["providers.tvdbApiKey"]),
	script("TVDB", "person.tvdb", tvdbPersonScriptCode, ["providers.tvdbApiKey"]),
	script(
		"MyAnimeList",
		"anime.myanimelist",
		withDelimiterTitleCaseHelper(myanimelistAnimeScriptCode),
		["providers.malClientId"],
	),
	script(
		"MyAnimeList",
		"manga.myanimelist",
		withDelimiterTitleCaseHelper(myanimelistMangaScriptCode),
		["providers.malClientId"],
	),
	script("Metron", "comic-book.metron", metronComicBookScriptCode, [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	script("Metron", "person.metron", metronPersonScriptCode, [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	script("Spotify", "music.spotify", spotifyMusicScriptCode, [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	script("Spotify", "person.spotify", spotifyPersonScriptCode, [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	script("IGDB", "video-game.igdb", igdbVideoGameScriptCode, [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	script("TMDB", "movie-group.tmdb", tmdbMovieGroupScriptCode, ["providers.tmdbAccessToken"]),
	script("TVDB", "movie-group.tvdb", tvdbMovieGroupScriptCode, ["providers.tvdbApiKey"]),
	script("Audible", "audiobook-group.audible", audibleAudiobookGroupScriptCode),
	script("Hardcover", "book-group.hardcover", hardcoverBookGroupScriptCode, [
		"providers.hardcoverApiKey",
	]),
	script("Metron", "comic-book-group.metron", metronComicBookGroupScriptCode, [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	script("Spotify", "music-group.spotify", spotifyMusicGroupScriptCode, [
		"providers.spotifyClientId",
		"providers.spotifyClientSecret",
	]),
	script("MusicBrainz", "music-group.musicbrainz", musicbrainzMusicGroupScriptCode),
	script("YouTube Music", "music-group.youtube-music", youtubeMusicGroupScriptCode),
	script("IGDB", "video-game-group.igdb", igdbVideoGameGroupScriptCode, [
		"providers.twitchClientId",
		"providers.twitchClientSecret",
	]),
	script("GiantBomb", "video-game-group.giant-bomb", giantBombVideoGameGroupScriptCode, [
		"providers.giantBombApiKey",
	]),
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

export const entitySchemaScriptLinks = () =>
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
		{ schemaSlug: "book", scriptSlug: "book.google-book" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.itunes" },
		{ schemaSlug: "music", scriptSlug: "music.musicbrainz" },
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

export const fitnessSchemaScriptLinks = () =>
	[{ schemaSlug: "exercise", scriptSlug: "exercise.free-exercise-db" }] as const;

export const builtinEventSchemaTriggerLinks = () => [
	{
		position: 1000,
		phase: "after_create",
		eventSchemaSlug: "progress",
		triggerName: "Auto-Complete on Full Progress",
		metadata: { inheritedProperties: ["consumedOn"] },
		scriptSlug: "trigger.auto-complete-on-full-progress",
	},
	{
		position: 100,
		metadata: {},
		phase: "before_create",
		eventSchemaSlug: "progress",
		triggerName: "Integration Progress Policy",
		scriptSlug: "trigger.integration-progress-policy",
	},
	{
		position: 1000,
		metadata: {},
		phase: "after_create",
		triggerName: "Radarr Push",
		scriptSlug: "trigger.radarr-push",
		eventSchemaSlug: "add-entity-to-collection",
	},
	{
		position: 1000,
		metadata: {},
		phase: "after_create",
		triggerName: "Sonarr Push",
		scriptSlug: "trigger.sonarr-push",
		eventSchemaSlug: "add-entity-to-collection",
	},
	{
		position: 1000,
		metadata: {},
		phase: "after_create",
		eventSchemaSlug: "complete",
		triggerName: "Jellyfin Push",
		scriptSlug: "trigger.jellyfin-push",
	},
];

export const personSchemaScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.tmdb" },
		{ schemaSlug: "person", scriptSlug: "person.tvdb" },
		{ schemaSlug: "person", scriptSlug: "person.metron" },
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.audible" },
		{ schemaSlug: "person", scriptSlug: "person.spotify" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
		{ schemaSlug: "person", scriptSlug: "person.musicbrainz" },
		{ schemaSlug: "person", scriptSlug: "person.openlibrary" },
		{ schemaSlug: "person", scriptSlug: "person.youtube-music" },
		{ schemaSlug: "person", scriptSlug: "person.giant-bomb" },
		{ schemaSlug: "person", scriptSlug: "person.manga-updates" },
	] as const;

export const companySchemaScriptLinks = () =>
	[
		{ schemaSlug: "company", scriptSlug: "company.igdb" },
		{ schemaSlug: "company", scriptSlug: "company.tmdb" },
		{ schemaSlug: "company", scriptSlug: "company.tvdb" },
		{ schemaSlug: "company", scriptSlug: "company.vndb" },
		{ schemaSlug: "company", scriptSlug: "company.anilist" },
		{ schemaSlug: "company", scriptSlug: "company.hardcover" },
		{ schemaSlug: "company", scriptSlug: "company.giant-bomb" },
	] as const;

export const groupSchemaScriptLinks = () =>
	[
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tmdb" },
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tvdb" },
		{ schemaSlug: "book-group", scriptSlug: "book-group.hardcover" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.spotify" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.musicbrainz" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.youtube-music" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.igdb" },
		{ schemaSlug: "audiobook-group", scriptSlug: "audiobook-group.audible" },
		{ schemaSlug: "comic-book-group", scriptSlug: "comic-book-group.metron" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.giant-bomb" },
	] as const;
