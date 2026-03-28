import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
} from "../fixtures";

describe("GET /event-schemas", () => {
	it("returns seeded built-in media lifecycle event schemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const mediaSchema = schemas.find((schema) => schema.slug === "book");

		expect(mediaSchema).toBeDefined();
		if (!mediaSchema) {
			throw new Error("Missing built-in book schema");
		}

		const eventSchemas = await listEventSchemas(
			client,
			cookies,
			mediaSchema.id,
		);

		expect(eventSchemas.map((schema) => schema.slug).sort()).toEqual([
			"backlog",
			"complete",
			"progress",
			"review",
		]);
		expect(eventSchemas.some((schema) => schema.slug === "read")).toBe(false);
	});

	it("exposes backlog for each supported built-in media schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});

		for (const slug of ["book", "anime", "manga"]) {
			const mediaSchema = schemas.find((schema) => schema.slug === slug);
			expect(mediaSchema).toBeDefined();
			if (!mediaSchema) {
				throw new Error(`Missing built-in ${slug} schema`);
			}

			const eventSchemas = await listEventSchemas(
				client,
				cookies,
				mediaSchema.id,
			);
			expect(eventSchemas.some((schema) => schema.slug === "backlog")).toBe(
				true,
			);
		}
	});
});
