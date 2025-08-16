import anilistAnimeScriptCode from "~/lib/sandbox/scripts/providers/media/anime/anilist.txt";
import myanimelistAnimeScriptCode from "~/lib/sandbox/scripts/providers/media/anime/myanimelist.txt";
import googleBooksBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/google-books.txt";
import hardcoverBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/hardcover.txt";
import openLibraryBookScriptCode from "~/lib/sandbox/scripts/providers/media/book/openlibrary.txt";
import anilistMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/anilist.txt";
import mangaUpdatesMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/manga-updates.txt";
import myanimelistMangaScriptCode from "~/lib/sandbox/scripts/providers/media/manga/myanimelist.txt";
import anilistPersonScriptCode from "~/lib/sandbox/scripts/providers/person/anilist.txt";
import hardcoverPersonScriptCode from "~/lib/sandbox/scripts/providers/person/hardcover.txt";

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
		name: "Anilist",
		slug: "person.anilist",
		code: anilistPersonScriptCode,
	},
	{
		name: "Hardcover",
		slug: "person.hardcover",
		code: hardcoverPersonScriptCode,
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
	] as const;

export const personSchemaScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
	] as const;
