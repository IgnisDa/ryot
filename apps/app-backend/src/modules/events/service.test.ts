import { describe, expect, it } from "bun:test";
import {
	createCompletePropertiesSchema,
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
					fields: { rating: { label: "Rating", type: "number" as const } },
				},
			}),
		).toThrow("Event properties must be a JSON object");
	});

	it("rejects array properties", () => {
		expect(() =>
			parseEventProperties({
				properties: [],
				propertiesSchema: {
					fields: { rating: { label: "Rating", type: "number" as const } },
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
				createEventDeps({
					getEventCreateScopeForUser: async (input) =>
						createEventCreateScope({
							isBuiltin: true,
							entityId: input.entityId,
							entitySchemaSlug: "book",
							eventSchemaSlug: "backlog",
							eventSchemaName: "Backlog",
							propertiesSchema: { fields: {} },
							eventSchemaId: input.eventSchemaId,
						}),
				}),
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
				createEventDeps({
					getEventCreateScopeForUser: async (input) =>
						createEventCreateScope({
							isBuiltin: true,
							entityId: input.entityId,
							entitySchemaSlug: "book",
							eventSchemaName: "Progress",
							eventSchemaSlug: "progress",
							eventSchemaId: input.eventSchemaId,
							propertiesSchema: createProgressPercentPropertiesSchema(),
						}),
				}),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("progress");
		expect(createdEvent.properties).toEqual({ progressPercent: 25.56 });
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
				createEventDeps({
					getEventCreateScopeForUser: async (input) =>
						createEventCreateScope({
							isBuiltin: true,
							entityId: input.entityId,
							entitySchemaSlug: "book",
							eventSchemaName: "Complete",
							eventSchemaSlug: "complete",
							eventSchemaId: input.eventSchemaId,
							propertiesSchema: createCompletePropertiesSchema(),
						}),
				}),
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
							completionMode: "custom_timestamps",
							startedOn: "2026-03-20T12:00:00Z",
							completedOn: "2026-03-27T18:30:00Z",
						},
					}),
				},
				createEventDeps({
					getEventCreateScopeForUser: async (input) =>
						createEventCreateScope({
							isBuiltin: true,
							entityId: input.entityId,
							entitySchemaSlug: "book",
							eventSchemaName: "Complete",
							eventSchemaSlug: "complete",
							eventSchemaId: input.eventSchemaId,
							propertiesSchema: createCompletePropertiesSchema(),
						}),
				}),
			),
		);

		expect(createdEvent.eventSchemaSlug).toBe("complete");
		expect(createdEvent.properties).toEqual({
			completionMode: "custom_timestamps",
			startedOn: "2026-03-20T12:00:00Z",
			completedOn: "2026-03-27T18:30:00Z",
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Complete",
						eventSchemaSlug: "complete",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createCompletePropertiesSchema(),
					}),
			}),
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Complete",
						eventSchemaSlug: "complete",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createCompletePropertiesSchema(),
					}),
			}),
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Complete",
						eventSchemaSlug: "complete",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createCompletePropertiesSchema(),
					}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
	});

	it("rejects out-of-range progress percent values", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: createEventBody({ properties: { progressPercent: 100 } }),
			},
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Progress",
						eventSchemaSlug: "progress",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createProgressPercentPropertiesSchema(),
					}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining("Event properties validation failed"),
		});
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Progress",
						eventSchemaSlug: "progress",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createProgressPercentPropertiesSchema(),
					}),
			}),
		);

		expect(result).toEqual({ data: { count: 2 } });
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Complete",
						eventSchemaSlug: "complete",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createCompletePropertiesSchema(),
					}),
			}),
		);

		expect(result).toEqual({ data: { count: 2 } });
	});

	it("creates a built-in review event before completion exists", async () => {
		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: createEventBody({
						properties: { review: "Loved it", rating: 5 },
					}),
				},
				createEventDeps({
					getEventCreateScopeForUser: async (input) =>
						createEventCreateScope({
							isBuiltin: true,
							entityId: input.entityId,
							entitySchemaSlug: "book",
							eventSchemaName: "Review",
							eventSchemaSlug: "review",
							eventSchemaId: input.eventSchemaId,
							propertiesSchema: createReviewPropertiesSchema(),
						}),
				}),
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Review",
						eventSchemaSlug: "review",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createReviewPropertiesSchema(),
					}),
			}),
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
			createEventDeps({
				getEventCreateScopeForUser: async (input) =>
					createEventCreateScope({
						isBuiltin: true,
						entityId: input.entityId,
						entitySchemaSlug: "book",
						eventSchemaName: "Review",
						eventSchemaSlug: "review",
						eventSchemaId: input.eventSchemaId,
						propertiesSchema: createReviewPropertiesSchema(),
					}),
			}),
		);

		expect(result).toEqual({ data: { count: 2 } });
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

		expect(result).toEqual({ data: { count: 3 } });
	});

	it("returns count of zero for an empty array", async () => {
		const result = await createEvents(
			{ userId: "user_1", body: [] },
			createEventDeps(),
		);

		expect(result).toEqual({ data: { count: 0 } });
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

		expect(result).toEqual({ data: { count: 2500 } });
	});
});
