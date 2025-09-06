import type { AppConfigPath } from "~/lib/config";
import anilistAnimeScriptCode from "~/lib/sandbox/scripts/providers/media/anime/anilist.txt";
import myanimelistAnimeScriptCode from "~/lib/sandbox/scripts/providers/media/anime/myanimelist.txt";
import audibleAudiobookScriptCode from "~/lib/sandbox/scripts/providers/media/audiobook/audible.txt";
import googleBooksBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/google-books.txt";
import hardcoverBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/hardcover.txt";
import openLibraryBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/openlibrary.txt";
import metronComicBookScriptCode from "~/lib/sandbox/scripts/providers/media/comic-book/metron.txt";
import anilistMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/anilist.txt";
import mangaUpdatesMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/manga-updates.txt";
import myanimelistMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/myanimelist.txt";
import tmdbMovieScriptCode from "~/lib/sandbox/scripts/providers/media/movie/tmdb.txt";
import tvdbMovieScriptCode from "~/lib/sandbox/scripts/providers/media/movie/tvdb.txt";
import musicbrainzMusicScriptCode from "~/lib/sandbox/scripts/providers/media/music/musicbrainz.txt";
import spotifyMusicScriptCode from "~/lib/sandbox/scripts/providers/media/music/spotify.txt";
import youtubeMusicScriptCode from "~/lib/sandbox/scripts/providers/media/music/youtube-music.txt";
import itunesPodcastScriptCode from "~/lib/sandbox/scripts/providers/media/podcast/itunes.txt";
import listennotesPodcastScriptCode from "~/lib/sandbox/scripts/providers/media/podcast/listennotes.txt";
import tmdbShowScriptCode from "~/lib/sandbox/scripts/providers/media/show/tmdb.txt";
import tvdbShowScriptCode from "~/lib/sandbox/scripts/providers/media/show/tvdb.txt";
import giantBombVideoGameScriptCode from "~/lib/sandbox/scripts/providers/media/video-game/giant-bomb.txt";
import igdbVideoGameScriptCode from "~/lib/sandbox/scripts/providers/media/video-game/igdb.txt";
import vndbVisualNovelScriptCode from "~/lib/sandbox/scripts/providers/media/visual-novel/vndb.txt";
import anilistPersonScriptCode from "~/lib/sandbox/scripts/providers/person/anilist.txt";
import audiblePersonScriptCode from "~/lib/sandbox/scripts/providers/person/audible.txt";
import hardcoverPersonScriptCode from "~/lib/sandbox/scripts/providers/person/hardcover.txt";
import metronPersonScriptCode from "~/lib/sandbox/scripts/providers/person/metron.txt";
import musicbrainzPersonScriptCode from "~/lib/sandbox/scripts/providers/person/musicbrainz.txt";
import spotifyPersonScriptCode from "~/lib/sandbox/scripts/providers/person/spotify.txt";
import tmdbPersonScriptCode from "~/lib/sandbox/scripts/providers/person/tmdb.txt";
import tvdbPersonScriptCode from "~/lib/sandbox/scripts/providers/person/tvdb.txt";
import vndbPersonScriptCode from "~/lib/sandbox/scripts/providers/person/vndb.txt";
import youtubeMusicPersonScriptCode from "~/lib/sandbox/scripts/providers/person/youtube-music.txt";
import autoCompleteOnFullProgressScriptCode from "~/lib/sandbox/scripts/triggers/auto-complete-on-full-progress.txt";
import type { SandboxScriptMetadata } from "~/lib/sandbox/types";

const BUILTIN_ALLOWED_HOST_FUNCTIONS: NonNullable<
	SandboxScriptMetadata["allowedHostFunctions"]
> = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
];

type BuiltinScriptEntry = {
	name: string;
	slug: string;
	code: string;
	metadata: {
		allowedHostFunctions: string[];
		requiredAppConfigKeys?: Array<AppConfigPath>;
	};
};

const script = (
	name: string,
	slug: string,
	code: string,
	requiredAppConfigKeys?: Array<AppConfigPath>,
): BuiltinScriptEntry => ({
	name,
	slug,
	code,
	metadata: {
		requiredAppConfigKeys,
		allowedHostFunctions: BUILTIN_ALLOWED_HOST_FUNCTIONS,
	},
});

export const builtinSandboxScripts = (): BuiltinScriptEntry[] => [
	script("OpenLibrary", "book.openlibrary", openLibraryBookScriptCode),
	script("Audible", "audiobook.audible", audibleAudiobookScriptCode),
	script("iTunes", "podcast.itunes", itunesPodcastScriptCode),
	script("VNDB", "visual-novel.vndb", vndbVisualNovelScriptCode),
	script("Anilist", "anime.anilist", anilistAnimeScriptCode),
	script("Anilist", "manga.anilist", anilistMangaScriptCode),
	script("Anilist", "person.anilist", anilistPersonScriptCode),
	script("Audible", "person.audible", audiblePersonScriptCode),
	script("VNDB", "person.vndb", vndbPersonScriptCode),
	script("MangaUpdates", "manga.manga-updates", mangaUpdatesMangaScriptCode),
	script("MusicBrainz", "music.musicbrainz", musicbrainzMusicScriptCode),
	script("MusicBrainz", "person.musicbrainz", musicbrainzPersonScriptCode),
	script("YouTube Music", "music.youtube-music", youtubeMusicScriptCode),
	script("YouTube Music", "person.youtube-music", youtubeMusicPersonScriptCode),
	script("Hardcover", "book.hardcover", hardcoverBookScriptCode, [
		"books.hardcover.apiKey",
	]),
	script("Hardcover", "person.hardcover", hardcoverPersonScriptCode, [
		"books.hardcover.apiKey",
	]),
	script("Google Books", "book.google-book", googleBooksBookScriptCode, [
		"books.googleBooks.apiKey",
	]),
	script("ListenNotes", "podcast.listennotes", listennotesPodcastScriptCode, [
		"podcasts.listenNotes.apiKey",
	]),
	script("GiantBomb", "video-game.giant-bomb", giantBombVideoGameScriptCode, [
		"videoGames.giantBomb.apiKey",
	]),
	script("TMDB", "movie.tmdb", tmdbMovieScriptCode, [
		"moviesAndShows.tmdb.accessToken",
	]),
	script("TMDB", "show.tmdb", tmdbShowScriptCode, [
		"moviesAndShows.tmdb.accessToken",
	]),
	script("TMDB", "person.tmdb", tmdbPersonScriptCode, [
		"moviesAndShows.tmdb.accessToken",
	]),
	script("TVDB", "movie.tvdb", tvdbMovieScriptCode, [
		"moviesAndShows.tvdb.apiKey",
	]),
	script("TVDB", "show.tvdb", tvdbShowScriptCode, [
		"moviesAndShows.tvdb.apiKey",
	]),
	script("TVDB", "person.tvdb", tvdbPersonScriptCode, [
		"moviesAndShows.tvdb.apiKey",
	]),
	script("MyAnimeList", "anime.myanimelist", myanimelistAnimeScriptCode, [
		"animeAndManga.mal.clientId",
	]),
	script("MyAnimeList", "manga.myanimelist", myanimelistMangaScriptCode, [
		"animeAndManga.mal.clientId",
	]),
	script("Metron", "comic-book.metron", metronComicBookScriptCode, [
		"comicBooks.metron.username",
		"comicBooks.metron.password",
	]),
	script("Metron", "person.metron", metronPersonScriptCode, [
		"comicBooks.metron.username",
		"comicBooks.metron.password",
	]),
	script("Spotify", "music.spotify", spotifyMusicScriptCode, [
		"music.spotify.clientId",
		"music.spotify.clientSecret",
	]),
	script("Spotify", "person.spotify", spotifyPersonScriptCode, [
		"music.spotify.clientId",
		"music.spotify.clientSecret",
	]),
	script("IGDB", "video-game.igdb", igdbVideoGameScriptCode, [
		"videoGames.twitch.clientId",
		"videoGames.twitch.clientSecret",
	]),
	{
		name: "Auto-Complete on Full Progress",
		code: autoCompleteOnFullProgressScriptCode,
		slug: "trigger.auto-complete-on-full-progress",
		metadata: { allowedHostFunctions: ["appApiCall"] },
	},
];

export const entitySchemaScriptLinks = () =>
	[
		{
			schemaSlug: "book",
			scriptSlug: "book.openlibrary",
		},
		{
			schemaSlug: "book",
			scriptSlug: "book.google-book",
		},
		{
			schemaSlug: "book",
			scriptSlug: "book.hardcover",
		},
		{
			schemaSlug: "comic-book",
			scriptSlug: "comic-book.metron",
		},
		{
			schemaSlug: "anime",
			scriptSlug: "anime.anilist",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "manga.anilist",
		},
		{
			schemaSlug: "anime",
			scriptSlug: "anime.myanimelist",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "manga.myanimelist",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "manga.manga-updates",
		},
		{
			schemaSlug: "audiobook",
			scriptSlug: "audiobook.audible",
		},
		{
			schemaSlug: "podcast",
			scriptSlug: "podcast.itunes",
		},
		{
			schemaSlug: "podcast",
			scriptSlug: "podcast.listennotes",
		},
		{
			schemaSlug: "movie",
			scriptSlug: "movie.tmdb",
		},
		{
			schemaSlug: "movie",
			scriptSlug: "movie.tvdb",
		},
		{
			schemaSlug: "show",
			scriptSlug: "show.tmdb",
		},
		{
			schemaSlug: "show",
			scriptSlug: "show.tvdb",
		},
		{
			schemaSlug: "video-game",
			scriptSlug: "video-game.giant-bomb",
		},
		{
			schemaSlug: "video-game",
			scriptSlug: "video-game.igdb",
		},
		{
			schemaSlug: "visual-novel",
			scriptSlug: "visual-novel.vndb",
		},
		{
			schemaSlug: "music",
			scriptSlug: "music.musicbrainz",
		},
		{
			schemaSlug: "music",
			scriptSlug: "music.spotify",
		},
		{
			schemaSlug: "music",
			scriptSlug: "music.youtube-music",
		},
	] as const;

export const builtinEventSchemaTriggerLinks = () =>
	[
		{
			eventSchemaSlug: "progress",
			triggerName: "Auto-Complete on Full Progress",
			scriptSlug: "trigger.auto-complete-on-full-progress",
		},
	] as const;

export const personSchemaScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.audible" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
		{ schemaSlug: "person", scriptSlug: "person.metron" },
		{ schemaSlug: "person", scriptSlug: "person.musicbrainz" },
		{ schemaSlug: "person", scriptSlug: "person.spotify" },
		{ schemaSlug: "person", scriptSlug: "person.tmdb" },
		{ schemaSlug: "person", scriptSlug: "person.tvdb" },
		{ schemaSlug: "person", scriptSlug: "person.youtube-music" },
		{ schemaSlug: "person", scriptSlug: "person.vndb" },
	] as const;
