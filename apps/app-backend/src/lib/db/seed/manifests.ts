import anilistAnimeScriptCode from "~/lib/sandbox/scripts/media-providers/anime/anilist.txt";
import myanimelistAnimeScriptCode from "~/lib/sandbox/scripts/media-providers/anime/myanimelist.txt";
import googleBooksBookScriptCode from "~/lib/sandbox/scripts/media-providers/book/google-books.txt";
import hardcoverBookScriptCode from "~/lib/sandbox/scripts/media-providers/book/hardcover.txt";
import openLibraryBookScriptCode from "~/lib/sandbox/scripts/media-providers/book/openlibrary.txt";
import anilistMangaScriptCode from "~/lib/sandbox/scripts/media-providers/manga/anilist.txt";
import mangaUpdatesMangaScriptCode from "~/lib/sandbox/scripts/media-providers/manga/manga-updates.txt";
import myanimelistMangaScriptCode from "~/lib/sandbox/scripts/media-providers/manga/myanimelist.txt";

export const builtinSandboxScripts = () => [
	{
		name: "Hardcover",
		slug: "hardcover.book",
		code: hardcoverBookScriptCode,
	},
	{
		name: "OpenLibrary",
		slug: "openlibrary.book",
		code: openLibraryBookScriptCode,
	},
	{
		name: "Google Books",
		slug: "google-books.book",
		code: googleBooksBookScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.anime",
		code: anilistAnimeScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.manga",
		code: anilistMangaScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.anime",
		code: myanimelistAnimeScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.manga",
		code: myanimelistMangaScriptCode,
	},
	{
		name: "MangaUpdates",
		slug: "manga-updates.manga",
		code: mangaUpdatesMangaScriptCode,
	},
];

export const entitySchemaScriptLinks = () =>
	[
		{
			schemaSlug: "book",
			scriptSlug: "openlibrary.book",
		},
		{
			schemaSlug: "book",
			scriptSlug: "google-books.book",
		},
		{
			schemaSlug: "book",
			scriptSlug: "hardcover.book",
		},
		{
			schemaSlug: "anime",
			scriptSlug: "anilist.anime",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "anilist.manga",
		},
		{
			schemaSlug: "anime",
			scriptSlug: "myanimelist.anime",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "myanimelist.manga",
		},
		{
			schemaSlug: "manga",
			scriptSlug: "manga-updates.manga",
		},
	] as const;
