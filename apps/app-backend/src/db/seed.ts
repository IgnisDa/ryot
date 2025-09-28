import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { bookPropertiesJsonSchema } from "../entity-schema-import";
import openLibraryBookDetailsScriptCode from "../sandbox/openlibrary-book-details-source.txt";
import openLibraryBookSearchScriptCode from "../sandbox/openlibrary-book-search-source.txt";
import { db } from ".";
import { entitySchema, sandboxScript } from "./schema";

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

const ensureBuiltinSandboxScript = async (input: {
	slug: string;
	name: string;
	code: string;
}) => {
	const [existingScript] = await db
		.select({ id: sandboxScript.id })
		.from(sandboxScript)
		.where(
			and(eq(sandboxScript.slug, input.slug), isNull(sandboxScript.userId)),
		)
		.limit(1);

	const scriptId = existingScript?.id ?? generateId();

	if (existingScript)
		await db
			.update(sandboxScript)
			.set({ isBuiltin: true, code: input.code, name: input.name })
			.where(eq(sandboxScript.id, scriptId));
	else
		await db.insert(sandboxScript).values({
			id: scriptId,
			isBuiltin: true,
			code: input.code,
			name: input.name,
			slug: input.slug,
		});

	return scriptId;
};

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const openLibrarySearchScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Search",
		slug: openLibrarySearchScriptSlug,
		code: openLibraryBookSearchScriptCode,
	});

	const openLibraryImportScriptId = await ensureBuiltinSandboxScript({
		name: "OpenLibrary Book Import",
		slug: openLibraryImportScriptSlug,
		code: openLibraryBookDetailsScriptCode,
	});

	const [existingBookSchema] = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, "book"), isNull(entitySchema.userId)))
		.limit(1);

	const bookSchemaValues = {
		slug: "book",
		name: "Book",
		isBuiltin: true,
		eventSchemas: bookEventSchemas,
		propertiesSchema: bookPropertiesJsonSchema,
		searchSandboxScriptId: openLibrarySearchScriptId,
		detailsSandboxScriptId: openLibraryImportScriptId,
	};

	if (existingBookSchema)
		await db
			.update(entitySchema)
			.set(bookSchemaValues)
			.where(eq(entitySchema.id, existingBookSchema.id));
	else
		await db
			.insert(entitySchema)
			.values({ ...bookSchemaValues, id: generateId() });

	console.info("Entity schemas seeded successfully");
};
