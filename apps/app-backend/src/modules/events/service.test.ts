import { describe, expect, it } from "bun:test";
import {
	createBuiltinAnimeProgressEventDeps,
	createBuiltinBacklogEventDeps,
	createBuiltinCompleteEventDeps,
	createBuiltinMangaProgressEventDeps,
	createBuiltinPodcastProgressEventDeps,
	createBuiltinProgressEventDeps,
	createBuiltinReviewEventDeps,
	createBuiltinShowProgressEventDeps,
	createBuiltinWorkoutSetEventDeps,
	createEventBody,
	createEventCreateScope,
	createEventDeps,
	createListedEvent,
	createNoteAndRatingPropertiesSchema,
	createProgressPercentPropertiesSchema,
	createReviewPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import {
	createEvent,
	createEvents,
	listEntityEvents,
	parseEventProperties,
	resolveEventCreateInput,
	resolveEventEntityId,
	resolveEventSchemaId,
	resolveSessionEntityId,
} from "./service";

describe("resolveEventEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEventEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEventEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("resolveEventSchemaId", () => {
	it("trims the provided event schema id", () => {
		expect(resolveEventSchemaId("  event_schema_123  ")).toBe(
			"event_schema_123",
		);
	});

	it("throws when the event schema id is blank", () => {
		expect(() => resolveEventSchemaId("   ")).toThrow(
			"Event schema id is required",
		);
	});
});

describe("resolveSessionEntityId", () => {
	it("trims the provided session entity id", () => {
		expect(resolveSessionEntityId("  workout_123  ")).toBe("workout_123");
	});

	it("throws when the session entity id is blank", () => {
		expect(() => resolveSessionEntityId("   ")).toThrow(
			"Session entity id is required",
		);
	});
});

describe("parseEventProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		expect(
			parseEventProperties({
				propertiesSchema,
				properties: { note: "Great tasting", rating: 4.5 },
			}),
		).toEqual({ note: "Great tasting", rating: 4.5 });
	});

	it("accepts optional fields missing", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		expect(
			parseEventProperties({
				propertiesSchema,
				properties: { rating: 5 },
			}),
		).toEqual({ rating: 5 });
	});

	it("rejects missing required fields", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		expect(() =>
			parseEventProperties({
				propertiesSchema,
				properties: { note: "Missing rating" },
			}),
		).toThrow("Event properties validation failed");
	});

	it("rejects wrong property types", () => {
		const propertiesSchema = {
			fields: {
				rating: {
					label: "Rating",
					type: "number" as const,
					description: "Rating score",
					validation: { required: true as const },
				},
			},
		};

		expect(() =>
			parseEventProperties({
				propertiesSchema,
				properties: { rating: "bad" },
			}),
		).toThrow("Event properties validation failed");
	});

	it("rejects non-object properties", () => {
		expect(() =>
			parseEventProperties({
				properties: "bad",
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							type: "number" as const,
							description: "Rating score",
						},
					},
				},
			}),
		).toThrow("Event properties must be a JSON object");
	});

	it("rejects array properties", () => {
		expect(() =>
			parseEventProperties({
				properties: [],
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							type: "number" as const,
							description: "Rating score",
						},
					},
				},
			}),
		).toThrow("Event properties must be a JSON object, not an array");
	});

	it("rejects properties not declared in the schema", () => {
		expect(() =>
			parseEventProperties({
				properties: { extra: true },
				propertiesSchema: { fields: {} },
			}),
		).toThrow("Event properties validation failed");
	});
});

describe("resolveEventCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = createNoteAndRatingPropertiesSchema();

		const input = resolveEventCreateInput({
			propertiesSchema,
			entityId: "  entity_123  ",
			eventSchemaId: "  event_schema_123  ",
			properties: { note: "Nice", rating: 4 },
		});

		expect(input.entityId).toBe("entity_123");
		expect(input.eventSchemaId).toBe("event_schema_123");
		expect(input.properties).toEqual({ note: "Nice", rating: 4 });
	});

	it("applies schema transforms before returning properties", () => {
		const input = resolveEventCreateInput({
			entityId: "entity_123",
			eventSchemaId: "event_schema_123",
			properties: { progressPercent: 25.555 },
			propertiesSchema: createProgressPercentPropertiesSchema(),
		});

		expect(input.properties).toEqual({ progressPercent: 25.56 });
	});

	it("keeps properties untouched when the schema has no transform", () => {
		const input = resolveEventCreateInput({
			entityId: "entity_123",
			eventSchemaId: "event_schema_123",
			properties: { progressPercent: 100 },
			propertiesSchema: {
				fields: {
					progressPercent: {
						type: "number" as const,
						label: "Progress Percent",
						description: "Progress percentage",
						validation: { required: true as const },
					},
				},
			},
		});

		expect(input.properties).toEqual({ progressPercent: 100 });
	});

	it("validates schema ranges while keeping optional text", () => {
		const input = resolveEventCreateInput({
			entityId: "entity_123",
			eventSchemaId: "event_schema_123",
			properties: { review: "Loved it", rating: 5 },
			propertiesSchema: createReviewPropertiesSchema(),
		});

		expect(input.properties).toEqual({ review: "Loved it", rating: 5 });
	});
});

describe("listEntityEvents", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await listEntityEvents(
			{ entityId: "entity_1", userId: "user_1" },
			createEventDeps({ getEntityScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});

	it("returns events when filtering by sessionEntityId", async () => {
		const listedEvent = createListedEvent({
			sessionEntityId: "workout_1",
			eventSchemaSlug: "workout-set",
		});

		const result = await listEntityEvents(
			{ sessionEntityId: "workout_1", userId: "user_1" },
			createEventDeps({
				listEventsByEntityForUser: async (input) => {
					expect(input).toEqual({
						userId: "user_1",
						sessionEntityId: "workout_1",
					});
					return [listedEvent];
				},
			}),
		);

		expect(result).toEqual({ data: [listedEvent] });
	});

	it("returns not found when the session entity does not exist", async () => {
		const result = await listEntityEvents(
			{ sessionEntityId: "workout_1", userId: "user_1" },
			createEventDeps({
				getSessionEntityScopeForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Session entity not found",
		});
	});
});

describe("createEvent", () => {
	it("normalizes event payload before persisting", async () => {
		let createdEventSchemaId: string | undefined;
		const deps = createEventDeps({
			createEventForUser: async (input) => {
				createdEventSchemaId = input.eventSchemaId;
				return createListedEvent({
					properties: input.properties,
				});
			},
		});

		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: {
						...createEventBody({ eventSchemaId: "  event_schema_123  " }),
					},
				},
				deps,
			),
		);

		expect(createdEventSchemaId).toBe("event_schema_123");
		expect(createdEvent.properties).toEqual({ rating: 4 });
	});

	it("passes sessionEntityId through when creating a workout-set event", async () => {
		let capturedSessionEntityId: string | undefined;

		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					sessionEntityId: "workout_1",
					eventSchemaId: "event_schema_workout_set",
					properties: {
						reps: 10,
						setOrder: 0,
						setLot: "normal",
						exerciseOrder: 0,
					},
				}),
			},
			createBuiltinWorkoutSetEventDeps({
				createEventForUser: async (input) => {
					capturedSessionEntityId = input.sessionEntityId;
					return createListedEvent({
						entityId: input.entityId,
						properties: input.properties,
						eventSchemaId: input.eventSchemaId,
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId ?? null,
					});
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(capturedSessionEntityId).toBe("workout_1");
	});

	it("does not set sessionEntityId when not supplied", async () => {
		let capturedSessionEntityId = "unexpected";

		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					eventSchemaId: "event_schema_workout_set",
					properties: {
						reps: 10,
						setOrder: 0,
						setLot: "normal",
						exerciseOrder: 0,
					},
				}),
			},
			createBuiltinWorkoutSetEventDeps({
				createEventForUser: async (input) => {
					capturedSessionEntityId = input.sessionEntityId ?? "undefined";
					return createListedEvent({
						entityId: input.entityId,
						properties: input.properties,
						eventSchemaId: input.eventSchemaId,
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId ?? null,
					});
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(capturedSessionEntityId).toBe("undefined");
	});

	it("returns not found when the session entity does not exist", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					sessionEntityId: "missing_workout",
					eventSchemaId: "event_schema_workout_set",
					properties: {
						reps: 10,
						setOrder: 0,
						setLot: "normal",
						exerciseOrder: 0,
					},
				}),
			},
			createBuiltinWorkoutSetEventDeps({
				getSessionEntityScopeForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Session entity not found",
		});
	});

	it("returns not found when the session entity is inaccessible", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					sessionEntityId: "hidden_workout",
					eventSchemaId: "event_schema_workout_set",
					properties: {
						reps: 10,
						setOrder: 0,
						setLot: "normal",
						exerciseOrder: 0,
					},
				}),
			},
			createBuiltinWorkoutSetEventDeps({
				getSessionEntityScopeForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Session entity not found",
		});
	});

	it("upserts in-library before creating an event for a global entity", async () => {
		const calls: Array<{
			userId: string;
			mediaEntityId: string;
			libraryEntityId: string;
		}> = [];

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityUserId: null,
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
					}),
				getUserLibraryEntityId: async () => "library_123",
				upsertInLibraryRelationship: async (input) => {
					calls.push(input);
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(calls).toEqual([
			{
				userId: "user_1",
				mediaEntityId: "entity_1",
				libraryEntityId: "library_123",
			},
		]);
	});

	it("still succeeds for a global entity when in-library already exists", async () => {
		let upsertCalls = 0;

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityUserId: null,
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
					}),
				upsertInLibraryRelationship: async () => {
					upsertCalls++;
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(upsertCalls).toBe(1);
	});

	it("does not upsert in-library for a user-owned entity", async () => {
		let upsertCalls = 0;

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				upsertInLibraryRelationship: async () => {
					upsertCalls++;
				},
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityUserId: "user_1",
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
					}),
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(upsertCalls).toBe(0);
	});

	it("fails clearly when a global entity event is created without a library entity", async () => {
		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityUserId: null,
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
					}),
				getUserLibraryEntityId: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "User library entity not found",
		});
	});

	it("does not upsert in-library when payload validation fails for a global entity", async () => {
		let upsertCalls = 0;

		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { note: "Missing rating" } }),
			},
			createEventDeps({
				upsertInLibraryRelationship: async () => {
					upsertCalls++;
				},
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityUserId: null,
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
					}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
		expect(upsertCalls).toBe(0);
	});

	it("returns validation when the event schema belongs to another entity schema", async () => {
		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						entityId: input.entityId,
						eventSchemaId: input.eventSchemaId,
						eventSchemaEntitySchemaId: "schema_2",
						propertiesSchema: {
							fields: {
								rating: {
									label: "Rating",
									type: "number" as const,
									description: "Rating score",
									validation: { required: true as const },
								},
							},
						},
					}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Event schema does not belong to the entity schema",
		});
	});

	it("returns validation for a blank entity id", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: { ...createEventBody(), entityId: "   " },
			},
			createEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity id is required",
		});
	});

	it("creates a built-in backlog event when the schema matches", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: {} }) },
				createBuiltinBacklogEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("backlog");
		expect(createdEvent.properties).toEqual({});
	});

	it("creates a built-in progress event with rounded progress percent", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { progressPercent: 25.555 } }),
				},
				createBuiltinProgressEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("progress");
		expect(createdEvent.properties).toEqual({ progressPercent: 25.56 });
	});

	it("creates a built-in show progress event with season and episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: {
							showSeason: 2,
							showEpisode: 5,
							progressPercent: 25.555,
						},
					}),
				},
				createBuiltinShowProgressEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("progress");
		expect(createdEvent.properties).toEqual({
			showSeason: 2,
			showEpisode: 5,
			progressPercent: 25.56,
		});
	});

	it("rejects show progress events with episode but without season", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { showEpisode: 5, progressPercent: 100 },
				}),
			},
			createBuiltinShowProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("showSeason is required"),
		});
	});

	it("rejects show progress events with season but without episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { showSeason: 2, progressPercent: 100 },
				}),
			},
			createBuiltinShowProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("showEpisode is required"),
		});
	});

	it("creates a built-in anime progress event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { animeEpisode: 7, progressPercent: 100 },
					}),
				},
				createBuiltinAnimeProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({
			animeEpisode: 7,
			progressPercent: 100,
		});
	});

	it("rejects anime progress events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { animeEpisode: 7.5, progressPercent: 100 },
				}),
			},
			createBuiltinAnimeProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("creates a built-in manga progress event with decimal chapter and volume", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: {
							mangaVolume: 8,
							mangaChapter: 42.5,
							progressPercent: 100,
						},
					}),
				},
				createBuiltinMangaProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({
			mangaVolume: 8,
			mangaChapter: 42.5,
			progressPercent: 100,
		});
	});

	it("rejects manga progress events with a non-integer volume", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: {
						mangaVolume: 8.5,
						mangaChapter: 42.5,
						progressPercent: 100,
					},
				}),
			},
			createBuiltinMangaProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("creates a built-in podcast progress event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { podcastEpisode: 14, progressPercent: 100 },
					}),
				},
				createBuiltinPodcastProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({
			podcastEpisode: 14,
			progressPercent: 100,
		});
	});

	it("rejects podcast progress events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { podcastEpisode: 14.2, progressPercent: 100 },
				}),
			},
			createBuiltinPodcastProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("rejects show-only fields on non-episodic media progress events", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: {
						showSeason: 1,
						showEpisode: 1,
						progressPercent: 100,
					},
				}),
			},
			createBuiltinProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("creates a built-in complete event with a just_now payload", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { completionMode: "just_now" },
					}),
				},
				createBuiltinCompleteEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("complete");
		expect(createdEvent.properties).toEqual({ completionMode: "just_now" });
	});

	it("creates a built-in complete event with custom timestamps", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: {
							startedOn: "2026-03-20T12:00:00Z",
							completedOn: "2026-03-27T18:30:00Z",
							completionMode: "custom_timestamps",
						},
					}),
				},
				createBuiltinCompleteEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("complete");
		expect(createdEvent.properties).toEqual({
			startedOn: "2026-03-20T12:00:00Z",
			completedOn: "2026-03-27T18:30:00Z",
			completionMode: "custom_timestamps",
		});
	});

	it("rejects built-in complete events missing completedOn for custom_timestamps", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { completionMode: "custom_timestamps" },
				}),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("rejects built-in complete events with date-only custom timestamps", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: {
						completedOn: "2026-03-27",
						completionMode: "custom_timestamps",
					},
				}),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("rejects built-in complete events with an invalid completion mode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { completionMode: "later" },
				}),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("accepts 100 progress percent values", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { progressPercent: 100 } }),
			},
			createBuiltinProgressEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.eventSchemaSlug).toBe("progress");
			expect(result.data.properties).toEqual({ progressPercent: 100 });
		}
	});

	it("creates repeated built-in progress events in bulk", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [
					createEventBody({ properties: { progressPercent: 12.341 } }),
					createEventBody({ properties: { progressPercent: 65.678 } }),
				],
			},
			createBuiltinProgressEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(2);
		}
	});

	it("creates repeated built-in complete events in bulk", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [
					createEventBody({ properties: { completionMode: "just_now" } }),
					createEventBody({
						properties: {
							completedOn: "2026-03-27T18:30:00Z",
							completionMode: "custom_timestamps",
						},
					}),
				],
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(2);
		}
	});

	it("creates a builtin review event before completion exists", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { review: "Loved it", rating: 5 },
					}),
				},
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("review");
		expect(createdEvent.properties).toEqual({ review: "Loved it", rating: 5 });
	});

	it("rejects built-in review ratings outside the accepted range", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { rating: 6 } }),
			},
			createBuiltinReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("creates repeated built-in review events in bulk", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [
					createEventBody({ properties: { rating: 4 } }),
					createEventBody({
						properties: { review: "Better on re-watch", rating: 5 },
					}),
				],
			},
			createBuiltinReviewEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(2);
		}
	});
});

describe("createEvents", () => {
	it("returns count equal to the number of items on success", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [createEventBody(), createEventBody(), createEventBody()],
			},
			createEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(3);
			expect(result.data.createdEvents).toHaveLength(3);
		}
	});

	it("returns count of zero and empty createdEvents for an empty array", async () => {
		const result = await createEvents(
			{ userId: "user_1", body: [] },
			createEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(0);
			expect(result.data.createdEvents).toHaveLength(0);
		}
	});

	it("fails fast and returns the error when any item fails validation", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [
					createEventBody(),
					{ ...createEventBody(), entityId: "   " },
					createEventBody(),
				],
			},
			createEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity id is required",
		});
	});

	it("chunks large arrays and counts all committed events", async () => {
		const items = Array.from({ length: 2500 }, () => createEventBody());
		const result = await createEvents(
			{ userId: "user_1", body: items },
			createEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(2500);
		}
	});
});
