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
import musicbrainzMusicScriptCode from "~/lib/sandbox/scripts/providers/media/music/musicbrainz.txt";
import spotifyMusicScriptCode from "~/lib/sandbox/scripts/providers/media/music/spotify.txt";
import itunesPodcastScriptCode from "~/lib/sandbox/scripts/providers/media/podcast/itunes.txt";
import listennotesPodcastScriptCode from "~/lib/sandbox/scripts/providers/media/podcast/listennotes.txt";
import giantBombVideoGameScriptCode from "~/lib/sandbox/scripts/providers/media/video-game/giant-bomb.txt";
import igdbVideoGameScriptCode from "~/lib/sandbox/scripts/providers/media/video-game/igdb.txt";
import anilistPersonScriptCode from "~/lib/sandbox/scripts/providers/person/anilist.txt";
import audiblePersonScriptCode from "~/lib/sandbox/scripts/providers/person/audible.txt";
import hardcoverPersonScriptCode from "~/lib/sandbox/scripts/providers/person/hardcover.txt";
import metronPersonScriptCode from "~/lib/sandbox/scripts/providers/person/metron.txt";
import musicbrainzPersonScriptCode from "~/lib/sandbox/scripts/providers/person/musicbrainz.txt";
import spotifyPersonScriptCode from "~/lib/sandbox/scripts/providers/person/spotify.txt";

export const builtinSandboxScripts = () => [
	{
		name: "Hardcover",
		slug: "book.hardcover",
		code: hardcoverBookScriptCode,
	},
	{
		name: "OpenLibrary",
		slug: "book.openlibrary",
		code: openLibraryBookScriptCode,
	},
	{
		name: "Google Books",
		slug: "book.google-book",
		code: googleBooksBookScriptCode,
	},
	{
		name: "Metron",
		slug: "comic-book.metron",
		code: metronComicBookScriptCode,
	},
	{
		name: "Anilist",
		slug: "anime.anilist",
		code: anilistAnimeScriptCode,
	},
	{
		name: "Anilist",
		slug: "manga.anilist",
		code: anilistMangaScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "anime.myanimelist",
		code: myanimelistAnimeScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "manga.myanimelist",
		code: myanimelistMangaScriptCode,
	},
	{
		name: "MangaUpdates",
		slug: "manga.manga-updates",
		code: mangaUpdatesMangaScriptCode,
	},
	{
		name: "Audible",
		slug: "audiobook.audible",
		code: audibleAudiobookScriptCode,
	},
	{
		name: "iTunes",
		slug: "podcast.itunes",
		code: itunesPodcastScriptCode,
	},
	{
		name: "ListenNotes",
		slug: "podcast.listennotes",
		code: listennotesPodcastScriptCode,
	},
	{
		name: "GiantBomb",
		slug: "video-game.giant-bomb",
		code: giantBombVideoGameScriptCode,
	},
	{
		name: "IGDB",
		slug: "video-game.igdb",
		code: igdbVideoGameScriptCode,
	},
	{
		name: "MusicBrainz",
		slug: "music.musicbrainz",
		code: musicbrainzMusicScriptCode,
	},
	{
		name: "Spotify",
		slug: "music.spotify",
		code: spotifyMusicScriptCode,
	},
	{
		name: "Anilist",
		slug: "person.anilist",
		code: anilistPersonScriptCode,
	},
	{
		name: "Hardcover",
		slug: "person.hardcover",
		code: hardcoverPersonScriptCode,
	},
	{
		name: "Audible",
		slug: "person.audible",
		code: audiblePersonScriptCode,
	},
	{
		name: "Metron",
		slug: "person.metron",
		code: metronPersonScriptCode,
	},
	{
		name: "MusicBrainz",
		slug: "person.musicbrainz",
		code: musicbrainzPersonScriptCode,
	},
	{
		name: "Spotify",
		slug: "person.spotify",
		code: spotifyPersonScriptCode,
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
			schemaSlug: "video-game",
			scriptSlug: "video-game.giant-bomb",
		},
		{
			schemaSlug: "video-game",
			scriptSlug: "video-game.igdb",
		},
		{
			schemaSlug: "music",
			scriptSlug: "music.musicbrainz",
		},
		{
			schemaSlug: "music",
			scriptSlug: "music.spotify",
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
	] as const;
