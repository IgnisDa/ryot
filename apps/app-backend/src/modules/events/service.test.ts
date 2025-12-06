import { describe, expect, it } from "bun:test";

import {
	createBuiltinAnimeProgressEventDeps,
	createBuiltinAnimeReviewEventDeps,
	createBuiltinBacklogEventDeps,
	createBuiltinCompleteEventDeps,
	createBuiltinMangaProgressEventDeps,
	createBuiltinMangaReviewEventDeps,
	createBuiltinPodcastProgressEventDeps,
	createBuiltinPodcastReviewEventDeps,
	createBuiltinProgressEventDeps,
	createBuiltinReviewEventDeps,
	createBuiltinShowProgressEventDeps,
	createBuiltinShowReviewEventDeps,
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
	createEventsBestEffortWithTriggers,
	createEventsWithTriggers,
	listEntityEvents,
	parseEventProperties,
	resolveEventCreateInput,
	resolveEventEntityId,
	resolveEventSchemaId,
	resolveOccurredAt,
	resolveSessionEntityId,
	type EventServiceDeps,
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
		expect(resolveEventSchemaId("  event_schema_123  ")).toBe("event_schema_123");
	});

	it("throws when the event schema id is blank", () => {
		expect(() => resolveEventSchemaId("   ")).toThrow("Event schema id is required");
	});
});

describe("resolveSessionEntityId", () => {
	it("trims the provided session entity id", () => {
		expect(resolveSessionEntityId("  workout_123  ")).toBe("workout_123");
	});

	it("throws when the session entity id is blank", () => {
		expect(() => resolveSessionEntityId("   ")).toThrow("Session entity id is required");
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
		).toThrow("Event payload is invalid");
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
		).toThrow("Event payload is invalid");
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
		).toThrow("Event payload is invalid");
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
			properties: { text: "Loved it", rating: 5 },
			propertiesSchema: createReviewPropertiesSchema(),
		});

		expect(input.properties).toEqual({ text: "Loved it", rating: 5 });
	});
});

describe("listEntityEvents", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await listEntityEvents(
			{ entityId: "entity_1", userId: "user_1" },
			createEventDeps({ getEntityScopeForUser: () => Promise.resolve(undefined) }),
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
				listEventsByEntityForUser: (input) => {
					expect(input).toEqual({
						userId: "user_1",
						sessionEntityId: "workout_1",
					});
					return Promise.resolve([listedEvent]);
				},
			}),
		);

		expect(result).toEqual({ data: [listedEvent] });
	});

	it("returns not found when the session entity does not exist", async () => {
		const result = await listEntityEvents(
			{ sessionEntityId: "workout_1", userId: "user_1" },
			createEventDeps({
				getSessionEntityScopeForUser: () => Promise.resolve(undefined),
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
			createEventForUser: (input) => {
				createdEventSchemaId = input.eventSchemaId;
				return Promise.resolve(
					createListedEvent({
						properties: input.properties,
					}),
				);
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
				createEventForUser: (input) => {
					capturedSessionEntityId = input.sessionEntityId;
					return Promise.resolve(
						createListedEvent({
							entityId: input.entityId,
							properties: input.properties,
							eventSchemaId: input.eventSchemaId,
							eventSchemaName: input.eventSchemaName,
							eventSchemaSlug: input.eventSchemaSlug,
							sessionEntityId: input.sessionEntityId ?? null,
						}),
					);
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
				createEventForUser: (input) => {
					capturedSessionEntityId = input.sessionEntityId ?? "undefined";
					return Promise.resolve(
						createListedEvent({
							entityId: input.entityId,
							properties: input.properties,
							eventSchemaId: input.eventSchemaId,
							eventSchemaName: input.eventSchemaName,
							eventSchemaSlug: input.eventSchemaSlug,
							sessionEntityId: input.sessionEntityId ?? null,
						}),
					);
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
				getSessionEntityScopeForUser: () => Promise.resolve(undefined),
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
				getSessionEntityScopeForUser: () => Promise.resolve(undefined),
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Session entity not found",
		});
	});

	it("ensures in-library before creating an event for a global entity", async () => {
		const calls: Array<{ userId: string; entityId: string }> = [];

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
						createEventCreateScope({
							entityUserId: null,
							entityId: input.entityId,
							eventSchemaId: input.eventSchemaId,
						}),
					),
				ensureEntityInLibrary: (input) => {
					calls.push(input);
					return Promise.resolve({ data: undefined });
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(calls).toEqual([{ userId: "user_1", entityId: "entity_1" }]);
	});

	it("still succeeds for a global entity when in-library already exists", async () => {
		let ensureCalls = 0;

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
						createEventCreateScope({
							entityUserId: null,
							entityId: input.entityId,
							eventSchemaId: input.eventSchemaId,
						}),
					),
				ensureEntityInLibrary: () => {
					ensureCalls++;
					return Promise.resolve({ data: undefined });
				},
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(ensureCalls).toBe(1);
	});

	it("does not ensure in-library for a user-owned entity", async () => {
		let ensureCalls = 0;

		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				ensureEntityInLibrary: () => {
					ensureCalls++;
					return Promise.resolve({ data: undefined });
				},
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
						createEventCreateScope({
							entityUserId: "user_1",
							entityId: input.entityId,
							eventSchemaId: input.eventSchemaId,
						}),
					),
			}),
		);

		expect(result).toEqual({ data: expect.anything() });
		expect(ensureCalls).toBe(0);
	});

	it("fails clearly when a global entity event is created without a library entity", async () => {
		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
						createEventCreateScope({
							entityUserId: null,
							entityId: input.entityId,
							eventSchemaId: input.eventSchemaId,
						}),
					),
				ensureEntityInLibrary: () =>
					Promise.resolve({ error: "validation", message: "User library entity not found" }),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "User library entity not found",
		});
	});

	it("ensures in-library before validation for a global entity (before-trigger requires library membership)", async () => {
		let ensureCalls = 0;

		const result = await createEvent(
			{ userId: "user_1", body: createEventBody({ properties: { note: "Missing rating" } }) },
			createEventDeps({
				ensureEntityInLibrary: () => {
					ensureCalls++;
					return Promise.resolve({ data: undefined });
				},
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
						createEventCreateScope({
							entityUserId: null,
							entityId: input.entityId,
							eventSchemaId: input.eventSchemaId,
						}),
					),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
		expect(ensureCalls).toBe(1);
	});

	it("returns validation when the event schema belongs to another entity schema", async () => {
		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createEventDeps({
				getEventCreateScopeForUser: (input) =>
					Promise.resolve(
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
					),
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

	it("creates a built-in show progress event with episode only", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { showEpisode: 5, progressPercent: 100 } }),
				},
				createBuiltinShowProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ showEpisode: 5, progressPercent: 100 });
	});

	it("creates a built-in show progress event with season only", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { showSeason: 2, progressPercent: 100 } }),
				},
				createBuiltinShowProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ showSeason: 2, progressPercent: 100 });
	});

	it("rejects show progress events with invalid episode values", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { showEpisode: 5.5, progressPercent: 100 } }),
			},
			createBuiltinShowProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects show progress events with invalid season values", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { showSeason: 2.5, progressPercent: 100 } }),
			},
			createBuiltinShowProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in anime progress event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { animeEpisode: 7, progressPercent: 100 } }),
				},
				createBuiltinAnimeProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ animeEpisode: 7, progressPercent: 100 });
	});

	it("rejects anime progress events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { animeEpisode: 7.5, progressPercent: 100 } }),
			},
			createBuiltinAnimeProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in manga progress event with decimal chapter and volume", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { mangaVolume: 8, mangaChapter: 42.5, progressPercent: 100 },
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
					properties: { mangaVolume: 8.5, mangaChapter: 42.5, progressPercent: 100 },
				}),
			},
			createBuiltinMangaProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in podcast progress event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { podcastEpisode: 14, progressPercent: 100 } }),
				},
				createBuiltinPodcastProgressEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ podcastEpisode: 14, progressPercent: 100 });
	});

	it("rejects podcast progress events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { podcastEpisode: 14.2, progressPercent: 100 } }),
			},
			createBuiltinPodcastProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects show-only fields on non-episodic media progress events", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { showSeason: 1, showEpisode: 1, progressPercent: 100 },
				}),
			},
			createBuiltinProgressEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in complete event with a just_now payload", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { completionMode: "just_now" } }),
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
				body: createEventBody({ properties: { completionMode: "custom_timestamps" } }),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects built-in complete events with date-only custom timestamps", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { completedOn: "2026-03-27", completionMode: "custom_timestamps" },
				}),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects built-in complete events with an invalid completion mode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { completionMode: "later" } }),
			},
			createBuiltinCompleteEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("accepts 100 progress percent values", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { progressPercent: 100 } }),
				},
				createBuiltinProgressEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("progress");
		expect(createdEvent.properties).toEqual({ progressPercent: 100 });
	});

	it("creates repeated built-in progress events in bulk", async () => {
		const result = expectDataResult(
			await createEvents(
				{
					userId: "user_1",
					body: [
						createEventBody({ properties: { progressPercent: 12.341 } }),
						createEventBody({ properties: { progressPercent: 65.678 } }),
					],
				},
				createBuiltinProgressEventDeps(),
			),
		);

		expect(result.count).toBe(2);
	});

	it("creates repeated built-in complete events in bulk", async () => {
		const result = expectDataResult(
			await createEvents(
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
			),
		);

		expect(result.count).toBe(2);
	});

	it("creates a builtin review event before completion exists", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { text: "Loved it", rating: 5 } }),
				},
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("review");
		expect(createdEvent.properties).toEqual({ text: "Loved it", rating: 5 });
	});

	it("rejects built-in review ratings outside the accepted range", async () => {
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody({ properties: { rating: 101 } }) },
			createBuiltinReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates repeated built-in review events in bulk", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [
					createEventBody({ properties: { rating: 4 } }),
					createEventBody({ properties: { text: "Better on re-watch", rating: 5 } }),
				],
			},
			createBuiltinReviewEventDeps(),
		);

		expect(result).not.toHaveProperty("error");
		if ("data" in result) {
			expect(result.data.count).toBe(2);
		}
	});

	it("rejects built-in review ratings below the accepted range", async () => {
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody({ properties: { rating: -1 } }) },
			createBuiltinReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("accepts decimal ratings for built-in reviews", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { rating: 50.5 } }) },
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ rating: 50.5 });
	});

	it("accepts rating at the minimum boundary", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { rating: 0 } }) },
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ rating: 0 });
	});

	it("accepts rating at the maximum boundary", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { rating: 100 } }) },
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ rating: 100 });
	});

	it("creates a builtin review event without a rating", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { text: "No rating needed" } }) },
				createBuiltinReviewEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("review");
		expect(createdEvent.properties).toEqual({ text: "No rating needed" });
	});

	it("creates a built-in show review event with season and episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { showSeason: 1, showEpisode: 3, rating: 80 } }),
				},
				createBuiltinShowReviewEventDeps(),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("review");
		expect(createdEvent.properties).toEqual({ showSeason: 1, showEpisode: 3, rating: 80 });
	});

	it("creates a built-in show review event with episode only", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { showEpisode: 3, rating: 80 } }) },
				createBuiltinShowReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ showEpisode: 3, rating: 80 });
	});

	it("creates a built-in show review event with season only", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{ userId: "user_1", body: createEventBody({ properties: { showSeason: 1, rating: 80 } }) },
				createBuiltinShowReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ showSeason: 1, rating: 80 });
	});

	it("rejects show review events with invalid episode values", async () => {
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody({ properties: { showEpisode: 3.5, rating: 80 } }) },
			createBuiltinShowReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects show review events with invalid season values", async () => {
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody({ properties: { showSeason: 1.5, rating: 80 } }) },
			createBuiltinShowReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in anime review event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { animeEpisode: 12, rating: 90 } }),
				},
				createBuiltinAnimeReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ animeEpisode: 12, rating: 90 });
	});

	it("rejects anime review events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { animeEpisode: 12.5, rating: 90 } }),
			},
			createBuiltinAnimeReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in manga review event with decimal chapter and volume", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { mangaVolume: 3, mangaChapter: 18.5, rating: 75 } }),
				},
				createBuiltinMangaReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ mangaVolume: 3, mangaChapter: 18.5, rating: 75 });
	});

	it("rejects manga review events with a non-integer volume", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { mangaVolume: 3.5, mangaChapter: 18, rating: 75 } }),
			},
			createBuiltinMangaReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("creates a built-in podcast review event with an episode", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({ properties: { podcastEpisode: 42, rating: 85 } }),
				},
				createBuiltinPodcastReviewEventDeps(),
			),
		);

		expect(createdEvent.properties).toEqual({ podcastEpisode: 42, rating: 85 });
	});

	it("rejects podcast review events with a non-integer episode", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { podcastEpisode: 42.2, rating: 85 } }),
			},
			createBuiltinPodcastReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});

	it("rejects show-only fields on non-episodic media review events", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { showSeason: 1, showEpisode: 1, rating: 80 } }),
			},
			createBuiltinReviewEventDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event payload is invalid"),
		});
	});
});

describe("createEvents", () => {
	it("returns count equal to the number of items on success", async () => {
		const result = expectDataResult(
			await createEvents(
				{ userId: "user_1", body: [createEventBody(), createEventBody(), createEventBody()] },
				createEventDeps(),
			),
		);

		expect(result.count).toBe(3);
		expect(result.createdEvents).toHaveLength(3);
	});

	it("returns count of zero and empty createdEvents for an empty array", async () => {
		const result = expectDataResult(
			await createEvents({ userId: "user_1", body: [] }, createEventDeps()),
		);

		expect(result.count).toBe(0);
		expect(result.createdEvents).toHaveLength(0);
	});

	it("fails fast and returns the error when any item fails validation", async () => {
		const result = await createEvents(
			{
				userId: "user_1",
				body: [createEventBody(), { ...createEventBody(), entityId: "   " }, createEventBody()],
			},
			createEventDeps(),
		);

		expect(result).toEqual({ error: "validation", message: "Entity id is required" });
	});

	it("processes large arrays and counts all committed events", async () => {
		const items = Array.from({ length: 2500 }, () => createEventBody());
		const result = expectDataResult(
			await createEvents({ userId: "user_1", body: items }, createEventDeps()),
		);

		expect(result.count).toBe(2500);
	});
});

describe("createEventsWithTriggers", () => {
	it("creates events and enqueues matching triggers", async () => {
		let nextEventNumber = 0;
		const queuedJobIds: string[] = [];
		const result = expectDataResult(
			await createEventsWithTriggers(
				{ userId: "user_1", body: [createEventBody(), createEventBody()] },
				createEventDeps({
					getActiveEventSchemaTriggersForEventSchemas: () =>
						Promise.resolve([
							{
								metadata: {},
								id: "trigger_1",
								sandboxScriptId: "script_1",
								eventSchemaId: "event_schema_1",
							},
						]),
					createEventForUser: (input) => {
						nextEventNumber++;
						return Promise.resolve(
							createListedEvent({
								entityId: input.entityId,
								occurredAt: input.occurredAt,
								properties: input.properties,
								id: `event_${nextEventNumber}`,
								eventSchemaId: input.eventSchemaId,
								eventSchemaName: input.eventSchemaName,
								eventSchemaSlug: input.eventSchemaSlug,
								sessionEntityId: input.sessionEntityId ?? null,
							}),
						);
					},
					enqueueEventSchemaTriggerJob: (input) => {
						queuedJobIds.push(input.jobId);
						return Promise.resolve();
					},
				}),
			),
		);

		expect(result.count).toBe(2);
		expect(queuedJobIds).toEqual([
			"event-schema-trigger-trigger_1-event_1",
			"event-schema-trigger-trigger_1-event_2",
		]);
	});
});

describe("createEventsBestEffortWithTriggers", () => {
	it("records item failures and enqueues triggers for created events", async () => {
		let nextEventNumber = 0;
		const queuedJobIds: string[] = [];
		const result = expectDataResult(
			await createEventsBestEffortWithTriggers(
				{
					userId: "user_1",
					body: [createEventBody(), { ...createEventBody(), entityId: "   " }, createEventBody()],
				},
				createEventDeps({
					getActiveEventSchemaTriggersForEventSchemas: () =>
						Promise.resolve([
							{
								metadata: {},
								id: "trigger_1",
								sandboxScriptId: "script_1",
								eventSchemaId: "event_schema_1",
							},
						]),
					createEventForUser: (input) => {
						nextEventNumber++;
						return Promise.resolve(
							createListedEvent({
								entityId: input.entityId,
								id: `event_${nextEventNumber}`,
								occurredAt: input.occurredAt,
								properties: input.properties,
								eventSchemaId: input.eventSchemaId,
								eventSchemaName: input.eventSchemaName,
								eventSchemaSlug: input.eventSchemaSlug,
								sessionEntityId: input.sessionEntityId ?? null,
							}),
						);
					},
					enqueueEventSchemaTriggerJob: (input) => {
						queuedJobIds.push(input.jobId);
						return Promise.resolve();
					},
				}),
			),
		);

		expect(result.count).toBe(2);
		expect(result.skipped).toEqual([]);
		expect(result.failures).toEqual([
			{ error: "validation", itemIndex: 1, message: "Entity id is required" },
		]);
		expect(queuedJobIds).toEqual([
			"event-schema-trigger-trigger_1-event_1",
			"event-schema-trigger-trigger_1-event_2",
		]);
	});

	it("puts before-trigger skips into skipped and not failures", async () => {
		const result = expectDataResult(
			await createEventsBestEffortWithTriggers(
				{
					userId: "user_1",
					body: [createEventBody(), createEventBody(), createEventBody()],
				},
				createEventDeps({
					getActiveBeforeCreateTriggersForEventSchemas: () =>
						Promise.resolve([
							{
								position: 100,
								id: "trigger_1",
								sandboxScriptId: "script_1",
								eventSchemaId: "event_schema_1",
							},
						]),
					runBeforeCreateTrigger: (input) => {
						const props = input.context.trigger.properties;
						if ((props as { rating?: number }).rating === 4) {
							return Promise.resolve({
								outcome: "result",
								result: { action: "skip", reason: "duplicate_progress" },
							});
						}
						return Promise.resolve({ outcome: "result", result: { action: "allow" } });
					},
				}),
			),
		);

		expect(result.skipped).toHaveLength(3);
		expect(result.failures).toHaveLength(0);
		expect(result.count).toBe(0);
		expect(result.skipped[0]).toMatchObject({ itemIndex: 0, reason: "duplicate_progress" });
	});

	it("before-trigger failure is recorded as a failure (fail closed)", async () => {
		const result = expectDataResult(
			await createEventsBestEffortWithTriggers(
				{ userId: "user_1", body: [createEventBody()] },
				createEventDeps({
					getActiveBeforeCreateTriggersForEventSchemas: () =>
						Promise.resolve([
							{
								position: 100,
								id: "trigger_1",
								sandboxScriptId: "script_1",
								eventSchemaId: "event_schema_1",
							},
						]),
					runBeforeCreateTrigger: () =>
						Promise.resolve({ outcome: "error", error: "Script timed out" }),
				}),
			),
		);

		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			error: "validation",
			message: expect.stringContaining("Before trigger failed: Script timed out"),
		});
		expect(result.skipped).toHaveLength(0);
		expect(result.count).toBe(0);
	});
});

describe("createEvent before-trigger flow", () => {
	it("allow: passes through and creates the event normally", async () => {
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 100,
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({ outcome: "result", result: { action: "allow" } }),
			}),
		);

		expect("data" in result).toBe(true);
	});

	it("skip: returns skip result without inserting event", async () => {
		let createCalled = false;
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 100,
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({
						outcome: "result",
						result: { action: "skip", reason: "below_minimum_progress" },
					}),
				createEventForUser: () => {
					createCalled = true;
					throw new Error("should not be called");
				},
			}),
		);

		expect("skipped" in result).toBe(true);
		if ("skipped" in result) {
			expect(result.skipped).toBe(true);
			expect(result.reason).toBe("below_minimum_progress");
			expect(result.eventSchemaSlug).toBe("finished");
		}
		expect(createCalled).toBe(false);
	});

	it("replace: merges properties into the event before validation and insert", async () => {
		let capturedProperties: Record<string, unknown> | undefined;
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({
					properties: { rating: 3 },
					eventSchemaId: "event_schema_1",
				}),
			},
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 100,
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({
						outcome: "result",
						result: { action: "replace", body: { properties: { rating: 5 } } },
					}),
				createEventForUser: (input) => {
					capturedProperties = input.properties;
					return Promise.resolve(
						createListedEvent({
							entityId: input.entityId,
							occurredAt: input.occurredAt,
							properties: input.properties,
							eventSchemaId: input.eventSchemaId,
							eventSchemaName: input.eventSchemaName,
							eventSchemaSlug: input.eventSchemaSlug,
							sessionEntityId: input.sessionEntityId ?? null,
						}),
					);
				},
			}),
		);

		expect("data" in result).toBe(true);
		expect(capturedProperties).toEqual({ rating: 5 });
	});

	it("replace: merges occurredAt into the event", async () => {
		const newOccurredAt = "2025-01-15T08:00:00.000Z";
		let capturedOccurredAt: Date | undefined;
		await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 100,
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({
						outcome: "result",
						result: { action: "replace", body: { occurredAt: newOccurredAt } },
					}),
				createEventForUser: (input) => {
					capturedOccurredAt = input.occurredAt;
					return Promise.resolve(
						createListedEvent({
							entityId: input.entityId,
							occurredAt: input.occurredAt,
							properties: input.properties,
							eventSchemaId: input.eventSchemaId,
							eventSchemaName: input.eventSchemaName,
							eventSchemaSlug: input.eventSchemaSlug,
							sessionEntityId: input.sessionEntityId ?? null,
						}),
					);
				},
			}),
		);

		expect(capturedOccurredAt?.toISOString()).toBe(newOccurredAt);
	});

	it("before-trigger failure: fails closed with validation error", async () => {
		let createCalled = false;
		const result = await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 100,
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({ outcome: "error", error: "Sandbox timed out" }),
				createEventForUser: () => {
					createCalled = true;
					throw new Error("should not be called");
				},
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Before trigger failed: Sandbox timed out",
		});
		expect(createCalled).toBe(false);
	});

	it("runs triggers in the order returned by the dep (repository orders by position ascending)", async () => {
		const executionOrder: string[] = [];

		await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							position: 50,
							id: "trigger_low",
							sandboxScriptId: "script_50",
							eventSchemaId: "event_schema_1",
						},
						{
							position: 100,
							id: "trigger_mid",
							sandboxScriptId: "script_100",
							eventSchemaId: "event_schema_1",
						},
						{
							position: 200,
							id: "trigger_high",
							sandboxScriptId: "script_200",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: (input) => {
					executionOrder.push(input.scriptId);
					return Promise.resolve({ outcome: "result", result: { action: "allow" } });
				},
			}),
		);

		expect(executionOrder).toEqual(["script_50", "script_100", "script_200"]);
	});

	it("stops at first skip without running subsequent triggers", async () => {
		const runScriptIds: string[] = [];

		const result = await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "t1",
							position: 50,
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
						{
							id: "t2",
							position: 100,
							sandboxScriptId: "script_2",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: (input) => {
					runScriptIds.push(input.scriptId);
					if (input.scriptId === "script_1") {
						return Promise.resolve({
							outcome: "result",
							result: { action: "skip", reason: "dedup" },
						});
					}
					return Promise.resolve({ outcome: "result", result: { action: "allow" } });
				},
			}),
		);

		expect("skipped" in result).toBe(true);
		expect(runScriptIds).toEqual(["script_1"]);
	});

	it("passes EventWriteContext (origin, integrationId, importRunId) to before-trigger context", async () => {
		let capturedContext:
			| Parameters<EventServiceDeps["runBeforeCreateTrigger"]>[0]["context"]["trigger"]
			| undefined;

		await createEvent(
			{
				userId: "user_1",
				body: createEventBody(),
				writeContext: { origin: "integration", importRunId: "run_xyz", integrationId: "int_abc" },
			},
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "t1",
							position: 100,
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: (input) => {
					capturedContext = input.context.trigger;
					return Promise.resolve({ outcome: "result", result: { action: "allow" } });
				},
			}),
		);

		expect(capturedContext?.phase).toBe("before_create");
		expect(capturedContext?.origin).toBe("integration");
		expect(capturedContext?.integrationId).toBe("int_abc");
		expect(capturedContext?.importRunId).toBe("run_xyz");
	});

	it("defaults writeContext to origin: api when not provided", async () => {
		let capturedOrigin: string | undefined;

		await createEvent(
			{ userId: "user_1", body: createEventBody() },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "t1",
							position: 100,
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: (input) => {
					capturedOrigin = input.context.trigger.origin;
					return Promise.resolve({ outcome: "result", result: { action: "allow" } });
				},
			}),
		);

		expect(capturedOrigin).toBe("api");
	});

	it("does not run after-triggers when event is skipped by before-trigger", async () => {
		const queuedJobIds: string[] = [];
		await createEventsBestEffortWithTriggers(
			{ userId: "user_1", body: [createEventBody()] },
			createEventDeps({
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "t1",
							position: 100,
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				runBeforeCreateTrigger: () =>
					Promise.resolve({
						outcome: "result",
						result: { action: "skip", reason: "test_skip" },
					}),
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "after_t",
							eventSchemaId: "event_schema_1",
							sandboxScriptId: "script_after",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					queuedJobIds.push(input.jobId);
					return Promise.resolve();
				},
			}),
		);

		expect(queuedJobIds).toHaveLength(0);
	});
});

describe("resolveOccurredAt", () => {
	it("returns parsed explicit occurredAt when provided", () => {
		const iso = "2025-06-15T10:00:00.000Z";
		const result = resolveOccurredAt({ occurredAt: iso });

		expect(result.toISOString()).toBe(iso);
	});

	it("defaults to now when occurredAt is omitted", () => {
		const before = Date.now();
		const result = resolveOccurredAt({});
		const after = Date.now();

		expect(result.getTime()).toBeGreaterThanOrEqual(before);
		expect(result.getTime()).toBeLessThanOrEqual(after);
	});
});
