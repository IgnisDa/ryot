import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import googleBooksBookDetailsScriptCode from "../sandbox/scripts/google-books-book-details-source.txt";
import googleBooksBookSearchScriptCode from "../sandbox/scripts/google-books-book-search-source.txt";
import openLibraryBookDetailsScriptCode from "../sandbox/scripts/openlibrary-book-details-source.txt";
import openLibraryBookSearchScriptCode from "../sandbox/scripts/openlibrary-book-search-source.txt";
import { db } from ".";
import {
	entitySchema,
	entitySchemaSandboxScript,
	sandboxScript,
} from "./schema";
import { bookPropertiesJsonSchema } from "./schema/book";

const googleBooksImportScriptSlug = "google-books.book.details";
const googleBooksSearchScriptSlug = "google-books.book.search";
const openLibraryImportScriptSlug = "openlibrary.book.details";
const openLibrarySearchScriptSlug = "openlibrary.book.search";

const bookEventSchemas = [
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
		.select({ id: sandboxScript.id })
		.from(sandboxScript)
		.where(
			and(eq(sandboxScript.slug, input.slug), isNull(sandboxScript.userId)),
		)
		.limit(1);

	const scriptId = existingScript?.id ?? generateId();

	const values = { isBuiltin: true, code: input.code, name: input.name };

	if (existingScript)
		await db
			.update(sandboxScript)
			.set(values)
			.where(eq(sandboxScript.id, scriptId));
	else
		await db
			.insert(sandboxScript)
			.values({ id: scriptId, slug: input.slug, ...values });

	return scriptId;
};

const linkScriptToEntitySchema = async (input: {
	scriptId: string;
	entitySchemaId: string;
	scriptType: "search" | "details";
}) => {
	const [existing] = await db
		.select({ id: entitySchemaSandboxScript.id })
		.from(entitySchemaSandboxScript)
		.where(
			and(
				eq(entitySchemaSandboxScript.scriptType, input.scriptType),
				eq(entitySchemaSandboxScript.sandboxScriptId, input.scriptId),
				eq(entitySchemaSandboxScript.entitySchemaId, input.entitySchemaId),
			),
		)
		.limit(1);

	if (existing) return;

	await db.insert(entitySchemaSandboxScript).values({
		scriptType: input.scriptType,
		sandboxScriptId: input.scriptId,
		entitySchemaId: input.entitySchemaId,
	});
};

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const bookSchemaId = await ensureBuiltinEntitySchema({
		slug: "book",
		name: "Book",
		eventSchemas: bookEventSchemas,
		propertiesSchema: bookPropertiesJsonSchema,
	});

	const openLibrarySearchScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Search",
		slug: openLibrarySearchScriptSlug,
		code: openLibraryBookSearchScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "search",
		entitySchemaId: bookSchemaId,
		scriptId: openLibrarySearchScriptId,
	});

	const googleBooksSearchScriptId = await ensureBuiltinSandboxScript({
		name: "Google Books Book Search",
		slug: googleBooksSearchScriptSlug,
		code: googleBooksBookSearchScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "search",
		entitySchemaId: bookSchemaId,
		scriptId: googleBooksSearchScriptId,
	});

	const openLibraryImportScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Import",
		slug: openLibraryImportScriptSlug,
		code: openLibraryBookDetailsScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "details",
		entitySchemaId: bookSchemaId,
		scriptId: openLibraryImportScriptId,
	});

	const googleBooksImportScriptId = await ensureBuiltinSandboxScript({
		name: "Google Books Book Import",
		slug: googleBooksImportScriptSlug,
		code: googleBooksBookDetailsScriptCode,
	});

	await linkScriptToEntitySchema({
		scriptType: "details",
		entitySchemaId: bookSchemaId,
		scriptId: googleBooksImportScriptId,
	});

	console.info("Entity schemas seeded successfully");
};
