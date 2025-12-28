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

	it("exposes lifecycle schemas for each supported built-in media schema", async () => {
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
			const progressSchema = eventSchemas.find(
				(schema) => schema.slug === "progress",
			);
			expect(progressSchema).toBeDefined();
			expect(progressSchema?.propertiesSchema).toEqual({
				fields: {
					progressPercent: {
						type: "number",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: {
							required: true,
							exclusiveMinimum: 0,
							exclusiveMaximum: 100,
						},
					},
				},
			});
			const completeSchema = eventSchemas.find(
				(schema) => schema.slug === "complete",
			);
			expect(completeSchema).toBeDefined();
			expect(completeSchema?.propertiesSchema).toEqual({
				fields: {
					startedOn: { type: "datetime" },
					completedOn: { type: "datetime" },
					completionMode: {
						type: "string",
						validation: {
							required: true,
							pattern: "^(just_now|unknown|custom_timestamps)$",
						},
					},
				},
				rules: [
					{
						kind: "validation",
						path: ["completedOn"],
						validation: { required: true },
						when: {
							operator: "eq",
							value: "custom_timestamps",
							path: ["completionMode"],
						},
					},
				],
			});
			const reviewSchema = eventSchemas.find(
				(schema) => schema.slug === "review",
			);
			expect(reviewSchema).toBeDefined();
			expect(reviewSchema?.propertiesSchema).toEqual({
				fields: {
					review: { type: "string" },
					rating: {
						type: "integer",
						validation: { required: true, maximum: 5, minimum: 1 },
					},
				},
			});
		}
	});
});
