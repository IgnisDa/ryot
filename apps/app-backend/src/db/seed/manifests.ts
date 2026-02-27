import { animePropertiesJsonSchema } from "~/lib/zod/anime";
import { bookPropertiesJsonSchema } from "~/lib/zod/book";
import { mangaPropertiesJsonSchema } from "~/lib/zod/manga";
import googleBooksBookDetailsScriptCode from "~/sandbox/scripts/google-books-book-details-source.txt";
import googleBooksBookSearchScriptCode from "~/sandbox/scripts/google-books-book-search-source.txt";
import hardcoverBookDetailsScriptCode from "~/sandbox/scripts/hardcover-book-details-source.txt";
import hardcoverBookSearchScriptCode from "~/sandbox/scripts/hardcover-book-search-source.txt";
import mangaUpdatesMangaDetailsScriptCode from "~/sandbox/scripts/manga-updates-manga-details-source.txt";
import mangaUpdatesMangaSearchScriptCode from "~/sandbox/scripts/manga-updates-manga-search-source.txt";
import myanimelistAnimeDetailsScriptCode from "~/sandbox/scripts/myanimelist-anime-details-source.txt";
import myanimelistAnimeSearchScriptCode from "~/sandbox/scripts/myanimelist-anime-search-source.txt";
import myanimelistMangaDetailsScriptCode from "~/sandbox/scripts/myanimelist-manga-details-source.txt";
import myanimelistMangaSearchScriptCode from "~/sandbox/scripts/myanimelist-manga-search-source.txt";
import openLibraryBookDetailsScriptCode from "~/sandbox/scripts/openlibrary-book-details-source.txt";
import openLibraryBookSearchScriptCode from "~/sandbox/scripts/openlibrary-book-search-source.txt";

const mediaEventSchemas = [
	{
		name: "Seen",
		slug: "media.seen",
		properties_schema: {
			type: "object",
			properties: {
				platform: { type: "string" },
				finished_at: { type: "string", format: "date-time" },
			},
		},
	},
	{
		name: "Progress",
		slug: "media.progress",
		properties_schema: {
			type: "object",
			required: ["progress_percent"],
			properties: {
				status: { type: "string", enum: ["in_progress", "completed"] },
				progress_percent: { minimum: 0, maximum: 100, type: "number" },
			},
		},
	},
];

export const builtinEntitySchemas = [
	{
		slug: "book",
		name: "Book",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: bookPropertiesJsonSchema,
	},
	{
		slug: "anime",
		name: "Anime",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: animePropertiesJsonSchema,
	},
	{
		slug: "manga",
		name: "Manga",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: mangaPropertiesJsonSchema,
	},
];

export const builtinSandboxScripts = [
	{
		name: "Hardcover Book Search",
		slug: "hardcover.book.search",
		code: hardcoverBookSearchScriptCode,
	},
	{
		name: "Hardcover Book Import",
		slug: "hardcover.book.details",
		code: hardcoverBookDetailsScriptCode,
	},
	{
		name: "OpenLibrary Book Search",
		slug: "openlibrary.book.search",
		code: openLibraryBookSearchScriptCode,
	},
	{
		name: "OpenLibrary Book Import",
		slug: "openlibrary.book.details",
		code: openLibraryBookDetailsScriptCode,
	},
	{
		name: "Google Books Book Search",
		slug: "google-books.book.search",
		code: googleBooksBookSearchScriptCode,
	},
	{
		name: "Google Books Book Import",
		slug: "google-books.book.details",
		code: googleBooksBookDetailsScriptCode,
	},
	{
		name: "MyAnimeList Manga Search",
		slug: "myanimelist.manga.search",
		code: myanimelistMangaSearchScriptCode,
	},
	{
		name: "MyAnimeList Anime Search",
		slug: "myanimelist.anime.search",
		code: myanimelistAnimeSearchScriptCode,
	},
	{
		name: "MyAnimeList Anime Import",
		slug: "myanimelist.anime.details",
		code: myanimelistAnimeDetailsScriptCode,
	},
	{
		name: "MyAnimeList Manga Import",
		slug: "myanimelist.manga.details",
		code: myanimelistMangaDetailsScriptCode,
	},
	{
		name: "MangaUpdates Manga Search",
		slug: "manga-updates.manga.search",
		code: mangaUpdatesMangaSearchScriptCode,
	},
	{
		name: "MangaUpdates Manga Import",
		slug: "manga-updates.manga.details",
		code: mangaUpdatesMangaDetailsScriptCode,
	},
];

export const entitySchemaScriptLinks = [
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
];
