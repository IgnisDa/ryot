import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	listEntitySchemas,
	listEventSchemas,
} from "~/fixtures/kernel";
import { findFitnessEntitySchema } from "~/fixtures/plugins/fitness";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { assertPresent, requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("GET /event-schemas", () => {
	it.live("returns seeded built-in media lifecycle event schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: mediaSchema } = yield* findMediaEntitySchema(client, "book");

			const eventSchemas = yield* listEventSchemas(client, mediaSchema.reference);

			expect(sortBy(eventSchemas.map((schema) => schema.slug))).toEqual([
				"add-to-media-library",
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
			const { schema: exerciseSchema } = yield* findFitnessEntitySchema(client, "exercise");

			const eventSchemas = yield* listEventSchemas(client, exerciseSchema.reference);

			expect(eventSchemas.map((schema) => schema.slug)).toEqual(["review", "workout-set"]);
			const workoutSetSchema = eventSchemas.find((schema) => schema.slug === "workout-set");
			assertPresent(workoutSetSchema, "Missing built-in workout-set schema for exercise");
			expect(workoutSetSchema.propertiesSchema).toMatchObject({
				fields: {
					note: {
						label: "Note",
						type: "string",
						description: "Optional note specific to this set",
					},
					duration: {
						type: "number",
						label: "Duration",
						description: "Duration of this set in seconds",
					},
					weight: {
						type: "number",
						label: "Weight",
						description: "Weight used in this set in kilograms (kg)",
					},
					distance: {
						type: "number",
						label: "Distance",
						description: "Distance covered in this set in kilometers (km)",
					},
					reps: {
						label: "Reps",
						type: "integer",
						description: "Nonnegative whole number of repetitions performed in this set",
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
					rpe: {
						label: "Rpe",
						type: "integer",
						validation: { minimum: 0, maximum: 10 },
						description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
					},
					setLot: {
						type: "enum",
						label: "Set Lot",
						description: "Set type: normal, warm_up, drop, or failure",
						choices: {
							kind: "static",
							values: [
								{ value: "normal" },
								{ value: "warm_up" },
								{ value: "drop" },
								{ value: "failure" },
							],
						},
					},
				},
			});
			const reviewSchema = eventSchemas.find((schema) => schema.slug === "review");
			assertPresent(reviewSchema, "Missing built-in review schema for exercise");
			expect(reviewSchema.propertiesSchema).toMatchObject({
				unknownKeys: "strict",
				fields: {
					text: {
						label: "Note",
						type: "string",
						description: "Your private note about this exercise",
					},
					rating: {
						type: "number",
						label: "Rating",
						validation: { minimum: 0, maximum: 100 },
						description: "Your personal rating from 0 (lowest) to 100 (highest)",
					},
				},
			});
			expect(Object.keys(reviewSchema.propertiesSchema.fields)).toHaveLength(2);
			expect(reviewSchema.propertiesSchema.fields.text).not.toHaveProperty("validation");
		}),
	);

	it.live("returns the seeded review event schema for collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: collectionSchema } = yield* findBuiltinSchemaBySlug(client, "collection", {
				kind: "kernel",
			});

			const eventSchemas = yield* listEventSchemas(client, collectionSchema.reference);

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
						description: "Your written thoughts or notes about this entity",
					},
					isSpoiler: {
						type: "boolean",
						label: "Contains spoilers",
						description: "Whether this review contains spoilers",
					},
					rating: {
						type: "number",
						label: "Rating",
						validation: { minimum: 0, maximum: 100 },
						description: "Your personal rating from 0 (lowest) to 100 (highest)",
					},
				},
			});
		}),
	);

	it.live("exposes lifecycle schemas for each supported built-in media schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { builtinPlugin } = yield* findMediaEntitySchema(client, "book");
			assertPresent(builtinPlugin, "System media fixture installation missing");
			const schemas = yield* listEntitySchemas(client, { pluginId: builtinPlugin.pluginId });
			const eventSchemasBySlug = yield* Effect.forEach(["book", "anime", "manga"], (slug) =>
				Effect.gen(function* () {
					const mediaSchema = schemas.find((schema) => schema.slug === slug);
					assertPresent(mediaSchema, `Missing built-in ${slug} schema`);

					return { slug, eventSchemas: yield* listEventSchemas(client, mediaSchema.reference) };
				}),
			);

			for (const { slug, eventSchemas } of eventSchemasBySlug) {
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
							label: "Progress percent",
							normalize: { round: { scale: 2 } },
							validation: { maximum: 100, exclusiveMinimum: 0 },
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
						dateUnknown: { type: "boolean", label: "Date unknown" },
						startedOn: {
							type: "datetime",
							label: "Started on",
							description: "Date and time you started consuming this media",
						},
						timeSpent: {
							type: "number",
							label: "Time spent",
							validation: { minimum: 0 },
							description: "Time spent consuming this media in minutes",
						},
					},
				});
				const completeProperties = requireObjectRecord(
					completeSchema.propertiesSchema,
					`Expected complete schema properties for ${slug} to be an object`,
				);
				expect(completeProperties["rules"]).toBeUndefined();
				const completeFields = requireObjectRecord(completeProperties["fields"], "Expected fields");
				expect(completeFields).not.toHaveProperty("completedOn");
				expect(completeFields).not.toHaveProperty("completionMode");
				const reviewSchema = eventSchemas.find((schema) => schema.slug === "review");
				assertPresent(reviewSchema, `Missing built-in review schema for ${slug}`);
				expect(reviewSchema.propertiesSchema).toBeDefined();
				expect(
					requireObjectRecord(
						reviewSchema.propertiesSchema,
						`Expected review schema properties for ${slug} to be an object`,
					),
				).toMatchObject({
					fields: {
						text: {
							type: "string",
							label: "Review",
							description: "Your written thoughts or notes about this media",
						},
						isSpoiler: {
							type: "boolean",
							label: "Contains spoilers",
							description: "Whether this review contains spoilers",
						},
						rating: {
							type: "number",
							label: "Rating",
							validation: { minimum: 0, maximum: 100 },
							description: "Your personal rating from 0 (lowest) to 100 (highest)",
						},
					},
				});
				const droppedSchema = eventSchemas.find((schema) => schema.slug === "dropped");
				assertPresent(droppedSchema, `Missing built-in dropped schema for ${slug}`);
				expect(droppedSchema.propertiesSchema).toBeDefined();
				expect(
					requireObjectRecord(
						droppedSchema.propertiesSchema,
						`Expected dropped schema properties for ${slug} to be an object`,
					),
				).toMatchObject({
					fields: {
						timeSpent: {
							type: "number",
							label: "Time spent",
							validation: { minimum: 0 },
							description: "Time spent consuming this media in minutes",
						},
						progressPercent: {
							type: "number",
							label: "Progress percent",
							normalize: { round: { scale: 2 } },
							validation: { maximum: 100, exclusiveMinimum: 0 },
							description: "Percentage of the media completed so far (0 to 100)",
						},
					},
				});
				const onHoldSchema = eventSchemas.find((schema) => schema.slug === "on_hold");
				assertPresent(onHoldSchema, `Missing built-in on_hold schema for ${slug}`);
				expect(onHoldSchema.propertiesSchema).toBeDefined();
				expect(
					requireObjectRecord(
						onHoldSchema.propertiesSchema,
						`Expected on_hold schema properties for ${slug} to be an object`,
					),
				).toMatchObject({
					fields: {
						timeSpent: {
							type: "number",
							label: "Time spent",
							validation: { minimum: 0 },
							description: "Time spent consuming this media in minutes",
						},
						progressPercent: {
							type: "number",
							label: "Progress percent",
							normalize: { round: { scale: 2 } },
							validation: { maximum: 100, exclusiveMinimum: 0 },
							description: "Percentage of the media completed so far (0 to 100)",
						},
					},
				});
			}
		}),
	);

	it.live("exposes per-entity progress schema variants for episodic media", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { builtinPlugin, schema: mediaFixtureSchema } = yield* findMediaEntitySchema(
				client,
				"book",
			);
			assertPresent(builtinPlugin, "System media fixture installation missing");
			const mediaOwner = mediaFixtureSchema.reference.owner;
			const schemas = yield* listEntitySchemas(client, { pluginId: builtinPlugin.pluginId });

			const getProgressSchema = (slug: string) =>
				Effect.gen(function* () {
					const schemaId =
						schemas.find((schema) => schema.slug === slug)?.id ??
						(yield* getBuiltinEntitySchemaSlug(client, slug, mediaOwner));
					const eventSchemas = yield* listEventSchemas(client, {
						slug: schemaId,
						owner: mediaOwner,
					});
					const progressSchema = eventSchemas.find((schema) => schema.slug === "progress");
					assertPresent(progressSchema, `Missing built-in progress schema for ${slug}`);

					return progressSchema.propertiesSchema;
				});

			const showSchema = schemas.find((schema) => schema.slug === "show");
			assertPresent(showSchema, "Missing built-in show schema");
			const showEventSchemas = yield* listEventSchemas(client, showSchema.reference);
			expect(showEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);
			const podcastSchema = schemas.find((schema) => schema.slug === "podcast");
			assertPresent(podcastSchema, "Missing built-in podcast schema");
			const podcastEventSchemas = yield* listEventSchemas(client, podcastSchema.reference);
			expect(podcastEventSchemas.some((schema) => schema.slug === "progress")).toBe(false);

			const animeProgressSchema = yield* getProgressSchema("anime");
			expect(animeProgressSchema).toMatchObject({
				fields: {
					animeEpisode: {
						type: "integer",
						label: "Anime Episode",
						description: "Episode number of the anime being tracked",
					},
					progressPercent: {
						type: "number",
						label: "Progress percent",
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});

			const mangaProgressSchema = yield* getProgressSchema("manga");
			expect(mangaProgressSchema).toMatchObject({
				fields: {
					mangaVolume: {
						type: "integer",
						label: "Manga Volume",
						description: "Volume number of the manga being tracked",
					},
					mangaChapter: {
						type: "number",
						label: "Manga Chapter",
						description: "Chapter number of the manga being tracked",
					},
					progressPercent: {
						type: "number",
						label: "Progress percent",
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});

			const podcastEpisodeProgressSchema = yield* getProgressSchema("podcast-episode");
			expect(podcastEpisodeProgressSchema).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress percent",
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});

			const movieProgressSchema = yield* getProgressSchema("movie");
			expect(movieProgressSchema).toMatchObject({
				fields: {
					progressPercent: {
						type: "number",
						label: "Progress percent",
						normalize: { round: { scale: 2 } },
						validation: { maximum: 100, exclusiveMinimum: 0 },
						description: "Percentage of the media completed so far (0 to 100)",
					},
				},
			});

			expect(
				requireObjectRecord(
					requireObjectRecord(movieProgressSchema, "Expected movie progress schema")["fields"],
					"Expected fields",
				)["progressPercent"],
			).not.toHaveProperty("validation.required");

			const progressSchemas = yield* Effect.forEach(
				["book", "comic-book", "audiobook", "video-game", "music", "visual-novel"],
				(slug) => getProgressSchema(slug),
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
			const { builtinPlugin } = yield* findMediaEntitySchema(client, "book");
			assertPresent(builtinPlugin, "System media fixture installation missing");
			const schemas = yield* listEntitySchemas(client, { pluginId: builtinPlugin.pluginId });
			const sessionFields = {
				startedOn: {
					type: "datetime",
					label: "Started on",
					description: "Date and time you started consuming this media",
				},
				timeSpent: {
					type: "number",
					label: "Time spent",
					validation: { minimum: 0 },
					description: "Time spent consuming this media in minutes",
				},
			};

			const getSchemaBySlug = (entitySlug: string, eventSlug: string) =>
				Effect.gen(function* () {
					const mediaSchema = schemas.find((schema) => schema.slug === entitySlug);
					assertPresent(mediaSchema, `Missing built-in ${entitySlug} schema`);

					const eventSchemas = yield* listEventSchemas(client, mediaSchema.reference);
					const schema = eventSchemas.find((s) => s.slug === eventSlug);
					assertPresent(schema, `Missing built-in ${eventSlug} schema for ${entitySlug}`);

					return requireObjectRecord(
						schema.propertiesSchema,
						`Expected ${eventSlug} properties schema for ${entitySlug} to be an object`,
					);
				});

			const lifecycleSchemas = yield* Effect.forEach(["anime", "manga", "movie", "book"], (slug) =>
				Effect.gen(function* () {
					return {
						onHoldSchema: yield* getSchemaBySlug(slug, "on_hold"),
						droppedSchema: yield* getSchemaBySlug(slug, "dropped"),
						progressSchema: yield* getSchemaBySlug(slug, "progress"),
					};
				}),
			);
			const showDroppedSchema = yield* getSchemaBySlug("show", "dropped");
			const showOnHoldSchema = yield* getSchemaBySlug("show", "on_hold");
			const podcastDroppedSchema = yield* getSchemaBySlug("podcast", "dropped");
			const podcastOnHoldSchema = yield* getSchemaBySlug("podcast", "on_hold");

			for (const { onHoldSchema, droppedSchema, progressSchema } of lifecycleSchemas) {
				expect(droppedSchema).toMatchObject(progressSchema);
				expect(onHoldSchema).toMatchObject(progressSchema);
				expect(droppedSchema).toMatchObject({ fields: sessionFields });
				expect(onHoldSchema).toMatchObject({ fields: sessionFields });
			}
			expect(showDroppedSchema).toMatchObject({ fields: sessionFields });
			for (const parentSchema of [
				showDroppedSchema,
				showOnHoldSchema,
				podcastDroppedSchema,
				podcastOnHoldSchema,
			]) {
				const parentFields = requireObjectRecord(parentSchema["fields"], "Expected fields");
				expect(Object.keys(parentFields)).not.toContain("progressPercent");
				expect(Object.keys(parentFields)).not.toContain("animeEpisode");
				expect(Object.keys(parentFields)).not.toContain("mangaChapter");
			}
			expect(showOnHoldSchema).toMatchObject(showDroppedSchema);
			expect(podcastDroppedSchema).toMatchObject(showDroppedSchema);
			expect(podcastOnHoldSchema).toMatchObject(showDroppedSchema);
		}),
	);
});
