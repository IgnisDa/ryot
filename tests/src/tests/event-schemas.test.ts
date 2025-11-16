import { describe, expect, it } from "bun:test";

import { sortBy } from "@ryot/ts-utils/lodash";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createEventSchema,
	createTracker,
	findBuiltinSchemaBySlug,
	listBuiltinEntitySchemas,
	listEventSchemas,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("GET /event-schemas", () => {
	it("returns seeded built-in media lifecycle event schemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: mediaSchema } = await findBuiltinSchemaBySlug(client, cookies, "book");

		const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);

		expect(sortBy(eventSchemas.map((schema) => schema.slug))).toEqual([
			"backlog",
			"complete",
			"dropped",
			"on_hold",
			"progress",
			"review",
		]);
		expect(eventSchemas.some((schema) => schema.slug === "read")).toBe(false);
	});

	it("returns the seeded workout-set and review event schemas for exercise", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, cookies, "exercise");

		const eventSchemas = await listEventSchemas(client, cookies, exerciseSchema.id);

		expect(eventSchemas.map((schema) => schema.slug)).toEqual(["review", "workout-set"]);
		const workoutSetSchema = eventSchemas.find((schema) => schema.slug === "workout-set");
		assertPresent(workoutSetSchema, "Missing built-in workout-set schema for exercise");
		expect(workoutSetSchema.propertiesSchema).toMatchObject({
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
		const reviewSchema = eventSchemas.find((schema) => schema.slug === "review");
		assertPresent(reviewSchema, "Missing built-in review schema for exercise");
		expect(reviewSchema.propertiesSchema).toMatchObject({
			fields: {
				text: {
					type: "string",
					label: "Review",
					description: "Your written thoughts or notes about this media",
				},
				isSpoiler: {
					type: "boolean",
					label: "Is Spoiler?",
					description: "Whether this review contains spoilers",
				},
				rating: {
					type: "number",
					label: "Rating",
					validation: { maximum: 100, minimum: 0 },
					description: "Your personal rating from 0 (lowest) to 100 (highest)",
				},
			},
		});
	});

	it("returns the seeded review event schema for collection", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: collectionSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"collection",
		);

		const eventSchemas = await listEventSchemas(client, cookies, collectionSchema.id);

		expect(eventSchemas.map((schema) => schema.slug)).toEqual(["review"]);
		const reviewSchema = eventSchemas[0];
		assertPresent(reviewSchema, "Missing built-in review schema for collection");
		expect(reviewSchema.propertiesSchema).toMatchObject({
			fields: {
				text: {
					type: "string",
					label: "Review",
					description: "Your written thoughts or notes about this media",
				},
				isSpoiler: {
					type: "boolean",
					label: "Is Spoiler?",
					description: "Whether this review contains spoilers",
				},
				rating: {
					type: "number",
					label: "Rating",
					validation: { maximum: 100, minimum: 0 },
					description: "Your personal rating from 0 (lowest) to 100 (highest)",
				},
			},
		});
	});

	it("exposes lifecycle schemas for each supported built-in media schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client, cookies);

		for (const slug of ["book", "anime", "manga"]) {
			const mediaSchema = schemas.find((schema) => schema.slug === slug);
			assertPresent(mediaSchema, `Missing built-in ${slug} schema`);

			// oxlint-disable-next-line no-await-in-loop
			const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);
			expect(eventSchemas.some((schema) => schema.slug === "backlog")).toBe(true);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
			assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);
			expect(progressSchema.propertiesSchema).toBeDefined();
			expect(progressSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});
			const completeSchema = eventSchemas.find((schema) => schema.slug === "complete");
			assertPresent(completeSchema, `Missing built-in complete schema for ${slug}`);
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
			assertPresent(reviewSchema, `Missing built-in review schema for ${slug}`);
			expect(reviewSchema.propertiesSchema).toBeDefined();
			expect(reviewSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					text: {
						type: "string",
						label: "Review",
						description: "Your written thoughts or notes about this media",
					},
					isSpoiler: {
						type: "boolean",
						label: "Is Spoiler?",
						description: "Whether this review contains spoilers",
					},
					rating: {
						type: "number",
						label: "Rating",
						validation: { maximum: 100, minimum: 0 },
						description: "Your personal rating from 0 (lowest) to 100 (highest)",
					},
				},
			});
			const droppedSchema = eventSchemas.find((schema) => schema.slug === "dropped");
			assertPresent(droppedSchema, `Missing built-in dropped schema for ${slug}`);
			expect(droppedSchema.propertiesSchema).toBeDefined();
			expect(droppedSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});
			const onHoldSchema = eventSchemas.find((schema) => schema.slug === "on_hold");
			assertPresent(onHoldSchema, `Missing built-in on_hold schema for ${slug}`);
			expect(onHoldSchema.propertiesSchema).toBeDefined();
			expect(onHoldSchema.propertiesSchema as Record<string, unknown>).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						transform: { round: { mode: "half_up", scale: 2 } },
						validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
						description: "Percentage of the media completed so far (0 to 100)",
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
			assertPresent(mediaSchema, `Missing built-in ${slug} schema`);

			const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
			assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);

			return progressSchema.propertiesSchema as Record<string, unknown>;
		};

		const showProgressSchema = await getProgressSchema("show");
		expect(showProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
					description: "Percentage of the media completed so far (0 to 100)",
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
					description: "Percentage of the media completed so far (0 to 100)",
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
					description: "Percentage of the media completed so far (0 to 100)",
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
					description: "Percentage of the media completed so far (0 to 100)",
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
					transform: { round: { mode: "half_up", scale: 2 } },
					validation: { maximum: 100, required: true, exclusiveMinimum: 0 },
					description: "Percentage of the media completed so far (0 to 100)",
				},
			},
		});
		// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
		expect((movieProgressSchema.fields as Record<string, unknown>).showSeason).toBe(undefined);
		// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
		expect((movieProgressSchema.fields as Record<string, unknown>).showEpisode).toBe(undefined);

		for (const slug of ["book", "comic-book", "audiobook", "video-game", "music", "visual-novel"]) {
			// oxlint-disable-next-line no-await-in-loop
			const progressSchema = await getProgressSchema(slug);
			expect(progressSchema).toEqual(movieProgressSchema);
		}

		expect(showProgressSchema).not.toEqual(movieProgressSchema);
	});

	it("exposes per-entity dropped and on_hold schema variants matching progress", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client, cookies);

		const getSchemaBySlug = async (entitySlug: string, eventSlug: string) => {
			const mediaSchema = schemas.find((schema) => schema.slug === entitySlug);
			assertPresent(mediaSchema, `Missing built-in ${entitySlug} schema`);

			const eventSchemas = await listEventSchemas(client, cookies, mediaSchema.id);
			const schema = eventSchemas.find((s) => s.slug === eventSlug);
			assertPresent(schema, `Missing built-in ${eventSlug} schema for ${entitySlug}`);

			return schema.propertiesSchema as Record<string, unknown>;
		};

		for (const slug of ["show", "anime", "manga", "podcast", "movie", "book"]) {
			// oxlint-disable-next-line no-await-in-loop
			const progressSchema = await getSchemaBySlug(slug, "progress");
			// oxlint-disable-next-line no-await-in-loop
			const droppedSchema = await getSchemaBySlug(slug, "dropped");
			// oxlint-disable-next-line no-await-in-loop
			const onHoldSchema = await getSchemaBySlug(slug, "on_hold");

			expect(droppedSchema).toEqual(progressSchema);
			expect(onHoldSchema).toEqual(progressSchema);
		}
	});
});

describe("POST /event-schemas", () => {
	it("successfully creates an event schema for a custom entity schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		const { data, response } = await client.POST("/event-schemas", {
			headers: { Cookie: cookies },
			body: {
				entitySchemaId,
				name: "My Event",
				slug: "my-event",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data.name).toBe("My Event");
		expect(data?.data.slug).toBe("my-event");
		expect(data?.data.entitySchemaId).toBe(entitySchemaId);
	});

	it("returns 400 when event schema slug already exists for the same entity schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		await createEventSchema(client, cookies, {
			entitySchemaId,
			name: "First Event",
			slug: "duplicate-event-slug",
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		const { response, error } = await client.POST("/event-schemas", {
			headers: { Cookie: cookies },
			body: {
				entitySchemaId,
				name: "Second Event",
				slug: "duplicate-event-slug",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error.message).toBe("Event schema slug already exists");
	});
});
