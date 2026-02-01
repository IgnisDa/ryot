import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createTracker,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaId,
	listBuiltinEntitySchemas,
	listEventSchemas,
} from "~/fixtures";
import { assertPresent, assertTaggedError, requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("GET /event-schemas", () => {
	it.live("returns seeded built-in media lifecycle event schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: mediaSchema } = yield* findBuiltinSchemaBySlug(client, "book");

			const eventSchemas = yield* listEventSchemas(client, mediaSchema.id);

			expect(sortBy(eventSchemas.map((schema) => schema.slug))).toEqual([
				"backlog",
				"complete",
				"dropped",
				"on_hold",
				"progress",
				"review",
			]);
			expect(eventSchemas.some((schema) => schema.slug === "read")).toBe(false);
		}),
	);

	it.live("returns the seeded workout-set and review event schemas for exercise", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: exerciseSchema } = yield* findBuiltinSchemaBySlug(client, "exercise");

			const eventSchemas = yield* listEventSchemas(client, exerciseSchema.id);

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
		}),
	);

	it.live("returns the seeded review event schema for collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: collectionSchema } = yield* findBuiltinSchemaBySlug(client, "collection");

			const eventSchemas = yield* listEventSchemas(client, collectionSchema.id);

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
		}),
	);

	it.live("exposes lifecycle schemas for each supported built-in media schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemas } = yield* listBuiltinEntitySchemas(client);
			const eventSchemasBySlug = yield* Effect.all(
				["book", "anime", "manga"].map((slug) =>
					Effect.gen(function* () {
						const mediaSchema = schemas.find((schema) => schema.slug === slug);
						assertPresent(mediaSchema, `Missing built-in ${slug} schema`);

						return { slug, eventSchemas: yield* listEventSchemas(client, mediaSchema.id) };
					}),
				),
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
		}),
	);

	it.live("exposes per-entity progress schema variants for episodic media", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemas } = yield* listBuiltinEntitySchemas(client);

			const getProgressSchema = (slug: string) =>
				Effect.gen(function* () {
					const schemaId =
						schemas.find((schema) => schema.slug === slug)?.id ??
						(yield* getBuiltinEntitySchemaId(slug));
					const eventSchemas = yield* listEventSchemas(client, schemaId);
					const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
					assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);

					return progressSchema.propertiesSchema as Record<string, unknown>;
				});

			const showSchema = schemas.find((schema) => schema.slug === "show");
			assertPresent(showSchema, "Missing built-in show schema");
			const showEventSchemas = yield* listEventSchemas(client, showSchema.id);
			expect(showEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);
			const podcastSchema = schemas.find((schema) => schema.slug === "podcast");
			assertPresent(podcastSchema, "Missing built-in podcast schema");
			const podcastEventSchemas = yield* listEventSchemas(client, podcastSchema.id);
			expect(podcastEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);

			const animeProgressSchema = yield* getProgressSchema("anime");
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

			const mangaProgressSchema = yield* getProgressSchema("manga");
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

			const podcastEpisodeProgressSchema = yield* getProgressSchema("podcast-episode");
			expect(podcastEpisodeProgressSchema).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress Percent",
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});

			const movieProgressSchema = yield* getProgressSchema("movie");
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

			const progressSchemas = yield* Effect.all(
				["book", "comic-book", "audiobook", "video-game", "music", "visual-novel"].map((slug) =>
					getProgressSchema(slug),
				),
			);

			for (const progressSchema of progressSchemas) {
				expect(progressSchema).toEqual(movieProgressSchema);
			}
			expect(podcastEpisodeProgressSchema).toEqual(movieProgressSchema);

			expect(animeProgressSchema).not.toEqual(movieProgressSchema);
		}),
	);

	it.live("exposes per-entity dropped and on_hold schema variants extending progress", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemas } = yield* listBuiltinEntitySchemas(client);
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

			const getSchemaBySlug = (entitySlug: string, eventSlug: string) =>
				Effect.gen(function* () {
					const mediaSchema = schemas.find((schema) => schema.slug === entitySlug);
					assertPresent(mediaSchema, `Missing built-in ${entitySlug} schema`);

					const eventSchemas = yield* listEventSchemas(client, mediaSchema.id);
					const schema = eventSchemas.find((s) => s.slug === eventSlug);
					assertPresent(schema, `Missing built-in ${eventSlug} schema for ${entitySlug}`);

					return requireObjectRecord(
						schema.propertiesSchema,
						`Expected ${eventSlug} properties schema for ${entitySlug} to be an object`,
					);
				});

			const lifecycleSchemas = yield* Effect.all(
				["anime", "manga", "movie", "book"].map((slug) =>
					Effect.gen(function* () {
						return {
							droppedSchema: yield* getSchemaBySlug(slug, "dropped"),
							onHoldSchema: yield* getSchemaBySlug(slug, "on_hold"),
							progressSchema: yield* getSchemaBySlug(slug, "progress"),
						};
					}),
				),
			);
			const showDroppedSchema = yield* getSchemaBySlug("show", "dropped");
			const showOnHoldSchema = yield* getSchemaBySlug("show", "on_hold");
			const podcastDroppedSchema = yield* getSchemaBySlug("podcast", "dropped");
			const podcastOnHoldSchema = yield* getSchemaBySlug("podcast", "on_hold");

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
		}),
	);

	it.live("returns 404 when accessing another user's entity schema", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const intruder = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(owner.client, {
				name: "Owner Event Schema Tracker",
			});
			const { schemaId: entitySchemaId } = yield* createEntitySchema(owner.client, {
				trackerId,
				name: "Owner Entity",
				slug: "owner-entity",
			});

			const error = yield* Effect.flip(
				intruder.client.call((c) => c.eventSchemas.list({ urlParams: { entitySchemaId } })),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity schema not found");
		}),
	);
});
