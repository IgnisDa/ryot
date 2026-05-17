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
import { getPgClient } from "../setup";
import { assertPresent, assertTaggedError, requireObjectRecord } from "../test-support/assertions";

const getBuiltinEntitySchemaId = async (slug: string) => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from entity_schema where slug = $1 and user_id is null and is_builtin = true limit 1`,
		[slug],
	);
	const row = result.rows[0];
	assertPresent(row, `Expected builtin entity schema '${slug}'`);
	return row.id;
};

describe("GET /event-schemas", () => {
	it("returns seeded built-in media lifecycle event schemas", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: mediaSchema } = await findBuiltinSchemaBySlug(client, "book");

		const eventSchemas = await listEventSchemas(client, mediaSchema.id);

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
		const { client } = await createAuthenticatedClient();
		const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, "exercise");

		const eventSchemas = await listEventSchemas(client, exerciseSchema.id);

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
					type: "number",
					label: "Weight",
					description: "Weight used in this set in the user's preferred unit",
				},
				setOrder: {
					type: "integer",
					label: "Set Order",
					validation: { minimum: 0 },
					description: "Zero-based position of this set within the exercise",
				},
				exerciseOrder: {
					type: "integer",
					label: "Exercise Order",
					validation: { minimum: 0 },
					description: "Zero-based position of this exercise within the workout",
				},
				setLot: {
					type: "enum",
					label: "Set Lot",
					description: "Set type: normal, warm_up, drop, or failure",
					options: ["normal", "warm_up", "drop", "failure"],
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
					validation: { maximum: 10, minimum: 0 },
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
		const { client } = await createAuthenticatedClient();
		const { schema: collectionSchema } = await findBuiltinSchemaBySlug(client, "collection");

		const eventSchemas = await listEventSchemas(client, collectionSchema.id);

		expect(eventSchemas.map((schema) => schema.slug)).toEqual([
			"add-entity-to-collection",
			"remove-entity-from-collection",
			"review",
		]);
		const reviewSchema = eventSchemas.find((schema) => schema.slug === "review");
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
		const { client } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client);
		const eventSchemasBySlug = await Promise.all(
			["book", "anime", "manga"].map(async (slug) => {
				const mediaSchema = schemas.find((schema) => schema.slug === slug);
				assertPresent(mediaSchema, `Missing built-in ${slug} schema`);

				return { slug, eventSchemas: await listEventSchemas(client, mediaSchema.id) };
			}),
		);

		for (const { eventSchemas, slug } of eventSchemasBySlug) {
			expect(eventSchemas.some((schema) => schema.slug === "backlog")).toBe(true);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
			assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);
			expect(progressSchema.propertiesSchema).toBeDefined();
			expect(
				requireObjectRecord(
					progressSchema.propertiesSchema,
					`Expected progress schema properties for ${slug} to be an object`,
				),
			).toMatchObject({
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
			expect(
				requireObjectRecord(
					completeSchema.propertiesSchema,
					`Expected complete schema properties for ${slug} to be an object`,
				),
			).toMatchObject({
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
					timeSpent: {
						type: "number",
						label: "Time Spent",
						validation: { minimum: 0 },
						description: "Time spent consuming this media in minutes",
					},
					completionMode: {
						type: "string",
						label: "Completion Mode",
						validation: { required: true, pattern: "^(just_now|unknown|custom_timestamps)$" },
						description:
							"How the completion timestamps were determined: just_now, unknown, or custom_timestamps",
					},
				},
				rules: [
					{
						kind: "validation",
						path: ["completedOn"],
						validation: { required: true },
						when: { operator: "eq", path: ["completionMode"], value: "custom_timestamps" },
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
					timeSpent: {
						type: "number",
						label: "Time Spent",
						validation: { minimum: 0 },
						description: "Time spent consuming this media in minutes",
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
					timeSpent: {
						type: "number",
						label: "Time Spent",
						validation: { minimum: 0 },
						description: "Time spent consuming this media in minutes",
					},
				},
			});
		}
	});

	it("exposes per-entity progress schema variants for episodic media", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client);

		const getProgressSchema = async (slug: string) => {
			const schemaId =
				schemas.find((schema) => schema.slug === slug)?.id ??
				(await getBuiltinEntitySchemaId(slug));
			const eventSchemas = await listEventSchemas(client, schemaId);
			const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
			assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);

			return progressSchema.propertiesSchema as Record<string, unknown>;
		};

		const showEventSchemas = await listEventSchemas(client, await getBuiltinEntitySchemaId("show"));
		expect(showEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);
		const podcastEventSchemas = await listEventSchemas(
			client,
			await getBuiltinEntitySchemaId("podcast"),
		);
		expect(podcastEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);

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

		const podcastEpisodeProgressSchema = await getProgressSchema("podcast-episode");
		expect(podcastEpisodeProgressSchema).toMatchObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0 to 100)",
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

		const progressSchemas = await Promise.all(
			["book", "comic-book", "audiobook", "video-game", "music", "visual-novel"].map((slug) =>
				getProgressSchema(slug),
			),
		);

		for (const progressSchema of progressSchemas) {
			expect(progressSchema).toEqual(movieProgressSchema);
		}
		expect(podcastEpisodeProgressSchema).toEqual(movieProgressSchema);

		expect(animeProgressSchema).not.toEqual(movieProgressSchema);
	});

	it("exposes per-entity dropped and on_hold schema variants extending progress", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemas } = await listBuiltinEntitySchemas(client);
		const sessionFields = {
			startedOn: {
				type: "datetime",
				label: "Started On",
				description: "Date and time you started consuming this media",
			},
			timeSpent: {
				type: "number",
				label: "Time Spent",
				validation: { minimum: 0 },
				description: "Time spent consuming this media in minutes",
			},
		};

		const getSchemaBySlug = async (entitySlug: string, eventSlug: string) => {
			const mediaSchema = schemas.find((schema) => schema.slug === entitySlug);
			assertPresent(mediaSchema, `Missing built-in ${entitySlug} schema`);

			const eventSchemas = await listEventSchemas(client, mediaSchema.id);
			const schema = eventSchemas.find((s) => s.slug === eventSlug);
			assertPresent(schema, `Missing built-in ${eventSlug} schema for ${entitySlug}`);

			return requireObjectRecord(
				schema.propertiesSchema,
				`Expected ${eventSlug} properties schema for ${entitySlug} to be an object`,
			);
		};

		const lifecycleSchemas = await Promise.all(
			["anime", "manga", "movie", "book"].map(async (slug) => ({
				droppedSchema: await getSchemaBySlug(slug, "dropped"),
				onHoldSchema: await getSchemaBySlug(slug, "on_hold"),
				progressSchema: await getSchemaBySlug(slug, "progress"),
			})),
		);
		const showDroppedSchema = await getSchemaBySlug("show", "dropped");
		const showOnHoldSchema = await getSchemaBySlug("show", "on_hold");
		const podcastDroppedSchema = await getSchemaBySlug("podcast", "dropped");
		const podcastOnHoldSchema = await getSchemaBySlug("podcast", "on_hold");

		for (const { progressSchema, droppedSchema, onHoldSchema } of lifecycleSchemas) {
			expect(droppedSchema).toMatchObject(progressSchema);
			expect(onHoldSchema).toMatchObject(progressSchema);
			expect(droppedSchema).toMatchObject({ fields: sessionFields });
			expect(onHoldSchema).toMatchObject({ fields: sessionFields });
		}
		expect(showDroppedSchema).toMatchObject({
			fields: {
				...sessionFields,
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Percentage of the media completed so far (0 to 100)",
				},
			},
		});
		expect(showOnHoldSchema).toMatchObject(showDroppedSchema);
		expect(podcastDroppedSchema).toMatchObject(showDroppedSchema);
		expect(podcastOnHoldSchema).toMatchObject(showDroppedSchema);
	});

	it("returns 404 when accessing another user's entity schema", async () => {
		const owner = await createAuthenticatedClient();
		const intruder = await createAuthenticatedClient();
		const { trackerId } = await createTracker(owner.client, {
			name: "Owner Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(owner.client, {
			trackerId,
			name: "Owner Entity",
			slug: "owner-entity",
		});

		const error = await intruder.client.runError((c) =>
			c.eventSchemas.list({ urlParams: { entitySchemaId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity schema not found");
	});
});

describe("POST /event-schemas", () => {
	it("successfully creates an event schema for a custom entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		const data = await client.run((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "My Event",
					slug: "my-event",
					propertiesSchema: {
						fields: { note: { type: "string", label: "Note", description: "Note" } },
					},
				},
			}),
		);

		expect(data.name).toBe("My Event");
		expect(data.slug).toBe("my-event");
		expect(data.entitySchemaId).toBe(entitySchemaId);
	});

	it("returns 400 when event schema properties schema is invalid", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		const error = await client.runError((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "Invalid Event",
					slug: "invalid-event",
					propertiesSchema: {
						fields: { status: { type: "string", label: "Status", description: "Status" } },
						rules: [
							{
								path: ["missing"],
								kind: "validation",
								validation: { required: true },
								when: { operator: "eq", path: ["status"], value: "completed" },
							},
						],
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Rule path 'missing' does not exist");
	});

	it("returns 400 when event schema slug already exists for the same entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Event Schema Tracker",
		});
		const { schemaId: entitySchemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Entity",
			slug: "custom-entity",
		});

		await createEventSchema(client, {
			entitySchemaId,
			name: "First Event",
			slug: "duplicate-event-slug",
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		const error = await client.runError((c) =>
			c.eventSchemas.create({
				payload: {
					entitySchemaId,
					name: "Second Event",
					slug: "duplicate-event-slug",
					propertiesSchema: {
						fields: { note: { type: "string", label: "Note", description: "Note" } },
					},
				},
			}),
		);

		assertTaggedError(error, "Conflict");
		expect(error.message).toBe("Event schema slug already exists");
	});
});
