import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import googleBooksBookDetailsScriptCode from "../sandbox/scripts/google-books-book-details-source.txt";
import googleBooksBookSearchScriptCode from "../sandbox/scripts/google-books-book-search-source.txt";
import hardcoverBookDetailsScriptCode from "../sandbox/scripts/hardcover-book-details-source.txt";
import hardcoverBookSearchScriptCode from "../sandbox/scripts/hardcover-book-search-source.txt";
import myanimelistAnimeDetailsScriptCode from "../sandbox/scripts/myanimelist-anime-details-source.txt";
import myanimelistAnimeSearchScriptCode from "../sandbox/scripts/myanimelist-anime-search-source.txt";
import myanimelistMangaDetailsScriptCode from "../sandbox/scripts/myanimelist-manga-details-source.txt";
import myanimelistMangaSearchScriptCode from "../sandbox/scripts/myanimelist-manga-search-source.txt";
import openLibraryBookDetailsScriptCode from "../sandbox/scripts/openlibrary-book-details-source.txt";
import openLibraryBookSearchScriptCode from "../sandbox/scripts/openlibrary-book-search-source.txt";
import { db } from ".";
import {
	entitySchema,
	entitySchemaSandboxScript,
	sandboxScript,
} from "./schema";
import { animePropertiesJsonSchema } from "./schema/anime";
import { bookPropertiesJsonSchema } from "./schema/book";
import { mangaPropertiesJsonSchema } from "./schema/manga";

const googleBooksImportScriptSlug = "google-books.book.details";
const googleBooksSearchScriptSlug = "google-books.book.search";
const hardcoverImportScriptSlug = "hardcover.book.details";
const hardcoverSearchScriptSlug = "hardcover.book.search";
const myanimelistAnimeImportScriptSlug = "myanimelist.anime.details";
const myanimelistAnimeSearchScriptSlug = "myanimelist.anime.search";
const myanimelistMangaImportScriptSlug = "myanimelist.manga.details";
const myanimelistMangaSearchScriptSlug = "myanimelist.manga.search";
const openLibraryImportScriptSlug = "openlibrary.book.details";
const openLibrarySearchScriptSlug = "openlibrary.book.search";

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

const ensureBuiltinEntitySchema = async (input: {
	slug: string;
	name: string;
	eventSchemas: unknown;
	propertiesSchema: unknown;
}) => {
	const [existing] = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, input.slug), isNull(entitySchema.userId)))
		.limit(1);

	const schemaId = existing?.id ?? generateId();

	const values = {
		name: input.name,
		slug: input.slug,
		isBuiltin: true,
		eventSchemas: input.eventSchemas,
		propertiesSchema: input.propertiesSchema,
	};

	if (existing)
		await db
			.update(entitySchema)
			.set(values)
			.where(eq(entitySchema.id, schemaId));
	else await db.insert(entitySchema).values({ id: schemaId, ...values });

	return schemaId;
};

const ensureBuiltinSandboxScript = async (input: {
	code: string;
	name: string;
	slug: string;
}) => {
	const [existingScript] = await db
		.select({
			id: sandboxScript.id,
			code: sandboxScript.code,
			name: sandboxScript.name,
			isBuiltin: sandboxScript.isBuiltin,
		})
		.from(sandboxScript)
		.where(
			and(eq(sandboxScript.slug, input.slug), isNull(sandboxScript.userId)),
		)
		.limit(1);

	const scriptId = existingScript?.id ?? generateId();

	const values = { code: input.code, name: input.name, isBuiltin: true };

	if (existingScript) {
		const shouldUpdateScript =
			existingScript.code !== input.code ||
			existingScript.name !== input.name ||
			!existingScript.isBuiltin;

		if (shouldUpdateScript)
			await db
				.update(sandboxScript)
				.set(values)
				.where(eq(sandboxScript.id, scriptId));
	} else
		await db
			.insert(sandboxScript)
			.values({ id: scriptId, slug: input.slug, ...values });

	return scriptId;
};

const linkScriptPairToEntitySchema = async (input: {
	entitySchemaId: string;
	searchScriptId: string;
	detailsScriptId: string;
}) => {
	const [existing] = await db
		.select({ id: entitySchemaSandboxScript.id })
		.from(entitySchemaSandboxScript)
		.where(
			and(
				eq(entitySchemaSandboxScript.entitySchemaId, input.entitySchemaId),
				eq(
					entitySchemaSandboxScript.searchSandboxScriptId,
					input.searchScriptId,
				),
				eq(
					entitySchemaSandboxScript.detailsSandboxScriptId,
					input.detailsScriptId,
				),
			),
		)
		.limit(1);

	if (existing) return;

	await db.insert(entitySchemaSandboxScript).values({
		entitySchemaId: input.entitySchemaId,
		searchSandboxScriptId: input.searchScriptId,
		detailsSandboxScriptId: input.detailsScriptId,
	});
};

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const bookSchemaId = await ensureBuiltinEntitySchema({
		slug: "book",
		name: "Book",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: bookPropertiesJsonSchema,
	});

	const animeSchemaId = await ensureBuiltinEntitySchema({
		slug: "anime",
		name: "Anime",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: animePropertiesJsonSchema,
	});

	const mangaSchemaId = await ensureBuiltinEntitySchema({
		slug: "manga",
		name: "Manga",
		eventSchemas: mediaEventSchemas,
		propertiesSchema: mangaPropertiesJsonSchema,
	});

	const openLibrarySearchScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Search",
		slug: openLibrarySearchScriptSlug,
		code: openLibraryBookSearchScriptCode,
	});

	const googleBooksSearchScriptId = await ensureBuiltinSandboxScript({
		name: "Google Books Book Search",
		slug: googleBooksSearchScriptSlug,
		code: googleBooksBookSearchScriptCode,
	});

	const hardcoverSearchScriptId = await ensureBuiltinSandboxScript({
		name: "Hardcover Book Search",
		slug: hardcoverSearchScriptSlug,
		code: hardcoverBookSearchScriptCode,
	});

	const myanimelistAnimeSearchScriptId = await ensureBuiltinSandboxScript({
		name: "MyAnimeList Anime Search",
		slug: myanimelistAnimeSearchScriptSlug,
		code: myanimelistAnimeSearchScriptCode,
	});

	const myanimelistMangaSearchScriptId = await ensureBuiltinSandboxScript({
		name: "MyAnimeList Manga Search",
		slug: myanimelistMangaSearchScriptSlug,
		code: myanimelistMangaSearchScriptCode,
	});

	const openLibraryDetailsScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Import",
		slug: openLibraryImportScriptSlug,
		code: openLibraryBookDetailsScriptCode,
	});

	const googleBooksDetailsScriptId = await ensureBuiltinSandboxScript({
		name: "Google Books Book Import",
		slug: googleBooksImportScriptSlug,
		code: googleBooksBookDetailsScriptCode,
	});

	const hardcoverDetailsScriptId = await ensureBuiltinSandboxScript({
		name: "Hardcover Book Import",
		slug: hardcoverImportScriptSlug,
		code: hardcoverBookDetailsScriptCode,
	});

	const myanimelistAnimeDetailsScriptId = await ensureBuiltinSandboxScript({
		name: "MyAnimeList Anime Import",
		slug: myanimelistAnimeImportScriptSlug,
		code: myanimelistAnimeDetailsScriptCode,
	});

	const myanimelistMangaDetailsScriptId = await ensureBuiltinSandboxScript({
		name: "MyAnimeList Manga Import",
		slug: myanimelistMangaImportScriptSlug,
		code: myanimelistMangaDetailsScriptCode,
	});

	await linkScriptPairToEntitySchema({
		entitySchemaId: bookSchemaId,
		searchScriptId: openLibrarySearchScriptId,
		detailsScriptId: openLibraryDetailsScriptId,
	});

	await linkScriptPairToEntitySchema({
		entitySchemaId: bookSchemaId,
		searchScriptId: googleBooksSearchScriptId,
		detailsScriptId: googleBooksDetailsScriptId,
	});

	await linkScriptPairToEntitySchema({
		entitySchemaId: bookSchemaId,
		searchScriptId: hardcoverSearchScriptId,
		detailsScriptId: hardcoverDetailsScriptId,
	});

	await linkScriptPairToEntitySchema({
		entitySchemaId: animeSchemaId,
		searchScriptId: myanimelistAnimeSearchScriptId,
		detailsScriptId: myanimelistAnimeDetailsScriptId,
	});

	await linkScriptPairToEntitySchema({
		entitySchemaId: mangaSchemaId,
		searchScriptId: myanimelistMangaSearchScriptId,
		detailsScriptId: myanimelistMangaDetailsScriptId,
	});

	console.info("Entity schemas seeded successfully");
};
