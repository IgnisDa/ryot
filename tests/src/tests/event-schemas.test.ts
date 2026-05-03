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
		const { schema: mediaSchema } = await findBuiltinSchemaBySlug(client, cookies, "book");

		const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);

		expect(eventSchemas.map((schema) => schema.slug).toSorted()).toEqual([
			"backlog",
			"complete",
			"progress",
			"review",
		]);
		expect(eventSchemas.some((schema) => schema.slug === "read")).toBe(false);
	});

	it("returns the seeded workout-set event schema for exercise", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, cookies, "exercise");

		const eventSchemas = await listEventSchemas(client, cookies, exerciseSchema.id);

		expect(eventSchemas.map((schema) => schema.slug)).toEqual(["workout-set"]);
		expect(eventSchemas[0]?.propertiesSchema).toMatchObject({
			fields: {
				reps: {
					label: "Reps",
					type: "number",
					description: "Number of repetitions performed in this set",
				},
				weight: {
					label: "Weight",
					type: "number",
					description: "Weight used in this set in the user's preferred unit",
				},
				setOrder: {
					type: "integer",
					label: "Set Order",
					description: "Zero-based position of this set within the exercise",
				},
				exerciseOrder: {
					type: "integer",
					label: "Exercise Order",
					description: "Zero-based position of this exercise within the workout",
				},
				setLot: {
					type: "enum",
					label: "Set Lot",
					description: "Set type: normal, warm_up, drop, or failure",
					options: ["normal", "warm_up", "drop", "failure"],
					validation: { required: true },
				},
				distance: {
					type: "number",
					label: "Distance",
					description: "Distance covered in this set in the user's preferred unit",
				},
				duration: {
					type: "number",
					label: "Duration",
					description: "Duration of this set in seconds",
				},
				note: {
					label: "Note",
					type: "string",
					description: "Optional note specific to this set",
				},
				rpe: {
					label: "Rpe",
					type: "integer",
					description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
				},
			},
		});
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

			// oxlint-disable-next-line no-await-in-loop
			const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);
			expect(eventSchemas.some((schema) => schema.slug === "backlog")).toBe(true);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
			expect(progressSchema).toBeDefined();
			if (!progressSchema) {
				throw new Error(`Missing built-in progress schema for ${slug}`);
			}
			expect(progressSchema.propertiesSchema).toBeDefined();
			expect(progressSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						description: "Percentage of the media completed so far (0–100)",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
					},
				},
			});
			const completeSchema = eventSchemas.find((schema) => schema.slug === "complete");
			expect(completeSchema).toBeDefined();
			if (!completeSchema) {
				throw new Error(`Missing built-in complete schema for ${slug}`);
			}
			expect(completeSchema.propertiesSchema).toBeDefined();
			expect(completeSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					startedOn: {
						type: "datetime",
						label: "Started On",
						description: "Date and time you started consuming this media",
					},
					completedOn: {
						type: "datetime",
						label: "Completed On",
						description: "Date and time you finished consuming this media",
					},
					completionMode: {
						type: "string",
						label: "Completion Mode",
						description:
							"How the completion timestamps were determined: just_now, unknown, or custom_timestamps",
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
			const reviewSchema = eventSchemas.find((schema) => schema.slug === "review");
			expect(reviewSchema).toBeDefined();
			if (!reviewSchema) {
				throw new Error(`Missing built-in review schema for ${slug}`);
			}
			expect(reviewSchema.propertiesSchema).toBeDefined();
			expect(reviewSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					review: {
						type: "string",
						label: "Review",
						description: "Your written thoughts or notes about this media",
					},
					rating: {
						type: "integer",
						label: "Rating",
						description: "Your personal rating from 1 (lowest) to 5 (highest)",
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

			const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
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
					description: "Percentage of the media completed so far (0–100)",
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
				},
				showSeason: {
					type: "integer",
					label: "Show Season",
					description: "Season number being tracked",
				},
				showEpisode: {
					type: "integer",
					label: "Show Episode",
					description: "Episode number within the current season",
				},
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
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0–100)",
				},
				animeEpisode: {
					type: "integer",
					label: "Anime Episode",
					description: "Episode number of the anime being tracked",
				},
			},
		});

		const mangaProgressSchema = await getProgressSchema("manga");
		expect(mangaProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0–100)",
				},
				mangaChapter: {
					type: "number",
					label: "Manga Chapter",
					description: "Chapter number of the manga being tracked",
				},
				mangaVolume: {
					type: "integer",
					label: "Manga Volume",
					description: "Volume number of the manga being tracked",
				},
			},
		});

		const podcastProgressSchema = await getProgressSchema("podcast");
		expect(podcastProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0–100)",
				},
				podcastEpisode: {
					type: "integer",
					label: "Podcast Episode",
					description: "Episode number of the podcast being tracked",
				},
			},
		});

		const movieProgressSchema = await getProgressSchema("movie");
		expect(movieProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0–100)",
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
				},
			},
		});
		expect((movieProgressSchema.fields as Record<string, unknown>).showSeason).toBe(undefined);
		expect((movieProgressSchema.fields as Record<string, unknown>).showEpisode).toBe(undefined);

		for (const slug of ["book", "comic-book", "audiobook", "video-game", "music", "visual-novel"]) {
			// oxlint-disable-next-line no-await-in-loop
			const progressSchema = await getProgressSchema(slug);
			expect(progressSchema).toEqual(movieProgressSchema);
		}

		expect(showProgressSchema).not.toEqual(movieProgressSchema);
	});
});
