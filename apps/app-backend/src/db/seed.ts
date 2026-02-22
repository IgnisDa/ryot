import { generateId } from "better-auth";
import { db } from ".";
import { entitySchema } from "./schema";

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const bookSchemaId = generateId();

	await db
		.insert(entitySchema)
		.values({
			slug: "book",
			name: "Book",
			isBuiltin: true,
			id: bookSchemaId,
			propertiesSchema: {
				type: "object",
				properties: {
					pages: { type: "number" },
					isCompilation: { type: "boolean" },
				},
			},
			eventSchemas: [
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
			],
		})
		.onConflictDoNothing({ target: [entitySchema.userId, entitySchema.slug] });

	console.info("Entity schemas seeded successfully");
};
