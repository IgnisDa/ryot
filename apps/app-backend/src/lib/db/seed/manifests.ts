import type { AppConfigEnvKey } from "~/lib/config";
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
		requiredAppConfigKeys?: Array<AppConfigEnvKey>;
		allowedHostFunctions: typeof BUILTIN_ALLOWED_HOST_FUNCTIONS;
	};
};

const script = (
	name: string,
	slug: string,
	code: string,
	requiredAppConfigKeys?: Array<AppConfigEnvKey>,
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
		"BOOKS_HARDCOVER_API_KEY",
	]),
	script("Hardcover", "person.hardcover", hardcoverPersonScriptCode, [
		"BOOKS_HARDCOVER_API_KEY",
	]),
	script("Google Books", "book.google-book", googleBooksBookScriptCode, [
		"BOOKS_GOOGLE_BOOKS_API_KEY",
	]),
	script("ListenNotes", "podcast.listennotes", listennotesPodcastScriptCode, [
		"PODCASTS_LISTENNOTES_API_KEY",
	]),
	script("GiantBomb", "video-game.giant-bomb", giantBombVideoGameScriptCode, [
		"VIDEO_GAMES_GIANT_BOMB_API_KEY",
	]),
	script("TMDB", "movie.tmdb", tmdbMovieScriptCode, [
		"MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN",
	]),
	script("TMDB", "show.tmdb", tmdbShowScriptCode, [
		"MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN",
	]),
	script("TMDB", "person.tmdb", tmdbPersonScriptCode, [
		"MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN",
	]),
	script("TVDB", "movie.tvdb", tvdbMovieScriptCode, [
		"MOVIES_AND_SHOWS_TVDB_API_KEY",
	]),
	script("TVDB", "show.tvdb", tvdbShowScriptCode, [
		"MOVIES_AND_SHOWS_TVDB_API_KEY",
	]),
	script("TVDB", "person.tvdb", tvdbPersonScriptCode, [
		"MOVIES_AND_SHOWS_TVDB_API_KEY",
	]),
	script("MyAnimeList", "anime.myanimelist", myanimelistAnimeScriptCode, [
		"ANIME_AND_MANGA_MAL_CLIENT_ID",
	]),
	script("MyAnimeList", "manga.myanimelist", myanimelistMangaScriptCode, [
		"ANIME_AND_MANGA_MAL_CLIENT_ID",
	]),
	script("Metron", "comic-book.metron", metronComicBookScriptCode, [
		"COMIC_BOOK_METRON_USERNAME",
		"COMIC_BOOK_METRON_PASSWORD",
	]),
	script("Metron", "person.metron", metronPersonScriptCode, [
		"COMIC_BOOK_METRON_USERNAME",
		"COMIC_BOOK_METRON_PASSWORD",
	]),
	script("Spotify", "music.spotify", spotifyMusicScriptCode, [
		"MUSIC_SPOTIFY_CLIENT_ID",
		"MUSIC_SPOTIFY_CLIENT_SECRET",
	]),
	script("Spotify", "person.spotify", spotifyPersonScriptCode, [
		"MUSIC_SPOTIFY_CLIENT_ID",
		"MUSIC_SPOTIFY_CLIENT_SECRET",
	]),
	script("IGDB", "video-game.igdb", igdbVideoGameScriptCode, [
		"VIDEO_GAMES_TWITCH_CLIENT_ID",
		"VIDEO_GAMES_TWITCH_CLIENT_SECRET",
	]),
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
