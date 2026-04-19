import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	listBuiltinEntitySchemas,
	listEventSchemas,
} from "../fixtures";

describe("GET /event-schemas", () => {
	it("returns seeded built-in media lifecycle event schemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: mediaSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"book",
		);

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
		const { schemas } = await listBuiltinEntitySchemas(client, cookies);

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
			if (!progressSchema) {
				throw new Error(`Missing built-in progress schema for ${slug}`);
			}
			expect(progressSchema.propertiesSchema).toBeDefined();
			expect(
				progressSchema.propertiesSchema as Record<string, unknown>,
			).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: {
							required: true,
							exclusiveMinimum: 0,
							maximum: 100,
						},
					},
				},
			});
			const completeSchema = eventSchemas.find(
				(schema) => schema.slug === "complete",
			);
			expect(completeSchema).toBeDefined();
			if (!completeSchema) {
				throw new Error(`Missing built-in complete schema for ${slug}`);
			}
			expect(completeSchema.propertiesSchema).toBeDefined();
			expect(
				completeSchema.propertiesSchema as Record<string, unknown>,
			).toMatchObject({
				fields: {
					startedOn: { type: "datetime", label: "Started On" },
					completedOn: { type: "datetime", label: "Completed On" },
					completionMode: {
						type: "string",
						label: "Completion Mode",
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
							path: ["completionMode"],
							value: "custom_timestamps",
						},
					},
				],
			});
			const reviewSchema = eventSchemas.find(
				(schema) => schema.slug === "review",
			);
			expect(reviewSchema).toBeDefined();
			if (!reviewSchema) {
				throw new Error(`Missing built-in review schema for ${slug}`);
			}
			expect(reviewSchema.propertiesSchema).toBeDefined();
			expect(
				reviewSchema.propertiesSchema as Record<string, unknown>,
			).toMatchObject({
				fields: {
					review: { type: "string", label: "Review" },
					rating: {
						type: "integer",
						label: "Rating",
						validation: { required: true, maximum: 5, minimum: 1 },
					},
				},
			});
		}
	});

	it("exposes per-entity progress schema variants for episodic media", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client, cookies);

		const getProgressSchema = async (slug: string) => {
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
			const progressSchema = eventSchemas.find(
				(schema) => schema.slug === "progress",
			);
			expect(progressSchema).toBeDefined();
			if (!progressSchema) {
				throw new Error(`Missing built-in progress schema for ${slug}`);
			}

			return progressSchema.propertiesSchema as Record<string, unknown>;
		};

		const showProgressSchema = await getProgressSchema("show");
		expect(showProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: {
						required: true,
						exclusiveMinimum: 0,
						maximum: 100,
					},
				},
				showSeason: { type: "integer", label: "Show Season" },
				showEpisode: { type: "integer", label: "Show Episode" },
			},
			rules: [
				{
					kind: "validation",
					path: ["showSeason"],
					validation: { required: true },
					when: { operator: "exists", path: ["showEpisode"] },
				},
				{
					kind: "validation",
					path: ["showEpisode"],
					validation: { required: true },
					when: { operator: "exists", path: ["showSeason"] },
				},
			],
		});

		const animeProgressSchema = await getProgressSchema("anime");
		expect(animeProgressSchema).toMatchObject({
			fields: {
				progressPercent: { type: "number", label: "Progress Percent" },
				animeEpisode: { type: "integer", label: "Anime Episode" },
			},
		});

		const mangaProgressSchema = await getProgressSchema("manga");
		expect(mangaProgressSchema).toMatchObject({
			fields: {
				progressPercent: { type: "number", label: "Progress Percent" },
				mangaChapter: { type: "number", label: "Manga Chapter" },
				mangaVolume: { type: "integer", label: "Manga Volume" },
			},
		});

		const podcastProgressSchema = await getProgressSchema("podcast");
		expect(podcastProgressSchema).toMatchObject({
			fields: {
				progressPercent: { type: "number", label: "Progress Percent" },
				podcastEpisode: { type: "integer", label: "Podcast Episode" },
			},
		});

		const movieProgressSchema = await getProgressSchema("movie");
		expect(movieProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: {
						required: true,
						exclusiveMinimum: 0,
						maximum: 100,
					},
				},
			},
		});
		expect(
			(movieProgressSchema.fields as Record<string, unknown>).showSeason,
		).toBe(undefined);
		expect(
			(movieProgressSchema.fields as Record<string, unknown>).showEpisode,
		).toBe(undefined);

		for (const slug of [
			"book",
			"comic-book",
			"audiobook",
			"video-game",
			"music",
			"visual-novel",
		]) {
			const progressSchema = await getProgressSchema(slug);
			expect(progressSchema).toEqual(movieProgressSchema);
		}

		expect(showProgressSchema).not.toEqual(movieProgressSchema);
	});
});
