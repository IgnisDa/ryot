import anilistAnimeDetailsScriptCode from "~/lib/sandbox/scripts/anilist-anime-details-source.txt";
import anilistAnimeSearchScriptCode from "~/lib/sandbox/scripts/anilist-anime-search-source.txt";
import anilistMangaDetailsScriptCode from "~/lib/sandbox/scripts/anilist-manga-details-source.txt";
import anilistMangaSearchScriptCode from "~/lib/sandbox/scripts/anilist-manga-search-source.txt";
import googleBooksBookDetailsScriptCode from "~/lib/sandbox/scripts/google-books-book-details-source.txt";
import googleBooksBookSearchScriptCode from "~/lib/sandbox/scripts/google-books-book-search-source.txt";
import hardcoverBookDetailsScriptCode from "~/lib/sandbox/scripts/hardcover-book-details-source.txt";
import hardcoverBookSearchScriptCode from "~/lib/sandbox/scripts/hardcover-book-search-source.txt";
import mangaUpdatesMangaDetailsScriptCode from "~/lib/sandbox/scripts/manga-updates-manga-details-source.txt";
import mangaUpdatesMangaSearchScriptCode from "~/lib/sandbox/scripts/manga-updates-manga-search-source.txt";
import myanimelistAnimeDetailsScriptCode from "~/lib/sandbox/scripts/myanimelist-anime-details-source.txt";
import myanimelistAnimeSearchScriptCode from "~/lib/sandbox/scripts/myanimelist-anime-search-source.txt";
import myanimelistMangaDetailsScriptCode from "~/lib/sandbox/scripts/myanimelist-manga-details-source.txt";
import myanimelistMangaSearchScriptCode from "~/lib/sandbox/scripts/myanimelist-manga-search-source.txt";
import openLibraryBookDetailsScriptCode from "~/lib/sandbox/scripts/openlibrary-book-details-source.txt";
import openLibraryBookSearchScriptCode from "~/lib/sandbox/scripts/openlibrary-book-search-source.txt";

export const builtinSandboxScripts = () => [
	{
		name: "Hardcover",
		slug: "hardcover.book.search",
		code: hardcoverBookSearchScriptCode,
	},
	{
		name: "Hardcover",
		slug: "hardcover.book.details",
		code: hardcoverBookDetailsScriptCode,
	},
	{
		name: "OpenLibrary",
		slug: "openlibrary.book.search",
		code: openLibraryBookSearchScriptCode,
	},
	{
		name: "OpenLibrary",
		slug: "openlibrary.book.details",
		code: openLibraryBookDetailsScriptCode,
	},
	{
		name: "Google Books",
		slug: "google-books.book.search",
		code: googleBooksBookSearchScriptCode,
	},
	{
		name: "Google Books",
		slug: "google-books.book.details",
		code: googleBooksBookDetailsScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.anime.search",
		code: anilistAnimeSearchScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.anime.details",
		code: anilistAnimeDetailsScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.manga.search",
		code: anilistMangaSearchScriptCode,
	},
	{
		name: "Anilist",
		slug: "anilist.manga.details",
		code: anilistMangaDetailsScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.manga.search",
		code: myanimelistMangaSearchScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.anime.search",
		code: myanimelistAnimeSearchScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.anime.details",
		code: myanimelistAnimeDetailsScriptCode,
	},
	{
		name: "MyAnimeList",
		slug: "myanimelist.manga.details",
		code: myanimelistMangaDetailsScriptCode,
	},
	{
		name: "MangaUpdates",
		slug: "manga-updates.manga.search",
		code: mangaUpdatesMangaSearchScriptCode,
	},
	{
		name: "MangaUpdates",
		slug: "manga-updates.manga.details",
		code: mangaUpdatesMangaDetailsScriptCode,
	},
];

export const entitySchemaScriptLinks = () =>
	[
		{
			schemaSlug: "book",
			searchScriptSlug: "openlibrary.book.search",
			detailsScriptSlug: "openlibrary.book.details",
		},
		{
			schemaSlug: "book",
			searchScriptSlug: "google-books.book.search",
			detailsScriptSlug: "google-books.book.details",
		},
		{
			schemaSlug: "book",
			searchScriptSlug: "hardcover.book.search",
			detailsScriptSlug: "hardcover.book.details",
		},
		{
			schemaSlug: "anime",
			searchScriptSlug: "anilist.anime.search",
			detailsScriptSlug: "anilist.anime.details",
		},
		{
			schemaSlug: "manga",
			searchScriptSlug: "anilist.manga.search",
			detailsScriptSlug: "anilist.manga.details",
		},
		{
			schemaSlug: "anime",
			searchScriptSlug: "myanimelist.anime.search",
			detailsScriptSlug: "myanimelist.anime.details",
		},
		{
			schemaSlug: "manga",
			searchScriptSlug: "myanimelist.manga.search",
			detailsScriptSlug: "myanimelist.manga.details",
		},
		{
			schemaSlug: "manga",
			searchScriptSlug: "manga-updates.manga.search",
			detailsScriptSlug: "manga-updates.manga.details",
		},
	] as const;
