import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import openLibraryBookSearchScriptCode from "../sandbox/openlibrary-book-search-source.txt";
import { db } from ".";
import { entitySchema, sandboxScript } from "./schema";

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

const bookPropertiesSchema = {
	type: "object",
	properties: {
		pages: { type: "number" },
		isCompilation: { type: "boolean" },
	},
};

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const [existingOpenLibraryScript] = await db
		.select({ id: sandboxScript.id })
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.slug, openLibrarySearchScriptSlug),
				isNull(sandboxScript.userId),
			),
		)
		.limit(1);

	const openLibraryScriptId = existingOpenLibraryScript?.id ?? generateId();

	if (existingOpenLibraryScript)
		await db
			.update(sandboxScript)
			.set({
				isBuiltin: true,
				name: "OpenLibrary Book Search",
				code: openLibraryBookSearchScriptCode,
			})
			.where(eq(sandboxScript.id, openLibraryScriptId));
	else
		await db.insert(sandboxScript).values({
			isBuiltin: true,
			id: openLibraryScriptId,
			name: "OpenLibrary Book Search",
			slug: openLibrarySearchScriptSlug,
			code: openLibraryBookSearchScriptCode,
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
		propertiesSchema: bookPropertiesSchema,
		searchSandboxScriptId: openLibraryScriptId,
	};

	if (existingBookSchema)
		await db
			.update(entitySchema)
			.set(bookSchemaValues)
			.where(eq(entitySchema.id, existingBookSchema.id));
	else
		await db.insert(entitySchema).values({
			...bookSchemaValues,
			id: generateId(),
		});

	console.info("Entity schemas seeded successfully");
};
