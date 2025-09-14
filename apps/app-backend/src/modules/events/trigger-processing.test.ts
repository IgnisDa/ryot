import { describe, expect, it } from "bun:test";

import type { CreatedEventData } from "~/modules/events";

import { processEventSchemaTriggers } from "./service";

const createProgressEvent = (overrides: Partial<CreatedEventData> = {}): CreatedEventData => ({
	id: "event_1",
	entityId: "entity_1",
	sessionEntityId: null,
	entitySchemaSlug: "book",
	entitySchemaId: "schema_1",
	eventSchemaSlug: "progress",
	eventSchemaName: "Progress",
	eventSchemaId: "event_schema_1",
	properties: { progressPercent: 100 },
	createdAt: new Date("2024-01-01"),
	updatedAt: new Date("2024-01-01"),
	occurredAt: new Date("2024-01-01"),
	...overrides,
});

const createDeps = (
	overrides: Partial<Parameters<typeof processEventSchemaTriggers>[1]> = {},
): NonNullable<Parameters<typeof processEventSchemaTriggers>[1]> => ({
	enqueueEventSchemaTriggerJob: () => Promise.resolve(),
	listEventsByEntityForUser: () => Promise.resolve([]),
	getEntityScopeForUser: () => Promise.resolve(undefined),
	getEventCreateScopeForUser: () => Promise.resolve(undefined),
	getSessionEntityScopeForUser: () => Promise.resolve(undefined),
	getEventSchemaForEntityBySlug: () => Promise.resolve(undefined),
	getActiveBeforeCreateTriggersForEventSchemas: () => Promise.resolve([]),
	runBeforeCreateTrigger: () => Promise.resolve({ outcome: "result", result: { action: "allow" } }),
	createEventForUser: () => {
		throw new Error("not used");
	},
	getActiveEventSchemaTriggersForEventSchemas: (input) =>
		Promise.resolve(
			input.eventSchemaIds.length > 0
				? [
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: input.eventSchemaIds[0] ?? "event_schema_1",
						},
					]
				: [],
		),
	...overrides,
});

describe("processEventSchemaTriggers", () => {
	it("does nothing when the created events list is empty", async () => {
		const queued: unknown[] = [];

		await processEventSchemaTriggers(
			{ userId: "user_1", createdEvents: [] },
			createDeps({
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual([]);
	});

	it("does nothing when no triggers match any event schema", async () => {
		const queued: unknown[] = [];

		await processEventSchemaTriggers(
			{ userId: "user_1", createdEvents: [createProgressEvent()] },
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () => Promise.resolve([]),
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual([]);
	});

	it("queues one sandbox job per matching (trigger, event) pair", async () => {
		const queued: Array<{ jobId: string; scriptId: string }> = [];

		await processEventSchemaTriggers(
			{ userId: "user_1", createdEvents: [createProgressEvent()] },
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push({ jobId: input.jobId, scriptId: input.scriptId });
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual([
			{
				scriptId: "script_1",
				jobId: "event-schema-trigger-trigger_1-event_1",
			},
		]);
	});

	it("uses deterministic job ID in the form event-schema-trigger-{triggerId}-{eventId}", async () => {
		let capturedJobId: string | undefined;

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [createProgressEvent({ id: "event_abc" })],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_xyz",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					capturedJobId = input.jobId;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedJobId).toBe("event-schema-trigger-trigger_xyz-event_abc");
	});

	it("only fires triggers whose eventSchemaId matches the created event", async () => {
		const queued: string[] = [];

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [createProgressEvent({ eventSchemaId: "schema_progress" })],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "schema_progress",
						},
						{
							metadata: {},
							id: "trigger_2",
							sandboxScriptId: "script_2",
							eventSchemaId: "schema_complete",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push(input.jobId);
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual(["event-schema-trigger-trigger_1-event_1"]);
	});

	it("passes enriched context including entitySchemaId, entitySchemaSlug, eventSchemaSlug, and properties", async () => {
		let capturedContext: unknown;

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [
					createProgressEvent({
						entitySchemaSlug: "book",
						eventSchemaSlug: "progress",
						entitySchemaId: "schema_book",
						properties: { progressPercent: 100 },
					}),
				],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					capturedContext = input.context;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedContext).toEqual({
			trigger: {
				eventId: "event_1",
				entityId: "entity_1",
				inheritedProperties: {},
				entitySchemaSlug: "book",
				eventSchemaSlug: "progress",
				entitySchemaId: "schema_book",
				eventSchemaId: "event_schema_1",
				properties: { progressPercent: 100 },
				createdAt: "2024-01-01T00:00:00.000Z",
				updatedAt: "2024-01-01T00:00:00.000Z",
				occurredAt: "2024-01-01T00:00:00.000Z",
			},
		});
	});

	it("populates inheritedProperties from trigger metadata when keys exist on the event", async () => {
		let capturedContext: unknown;

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [
					createProgressEvent({ properties: { progressPercent: 100, consumedOn: "Netflix" } }),
				],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
							metadata: { inheritedProperties: ["consumedOn"] },
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					capturedContext = input.context;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedContext).toMatchObject({
			trigger: { inheritedProperties: { consumedOn: "Netflix" } },
		});
	});

	it("omits keys from inheritedProperties that are absent on the event", async () => {
		let capturedContext: unknown;

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [createProgressEvent({ properties: { progressPercent: 100 } })],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
							metadata: { inheritedProperties: ["consumedOn"] },
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					capturedContext = input.context;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedContext).toMatchObject({ trigger: { inheritedProperties: {} } });
	});

	it("produces empty inheritedProperties when trigger metadata has no inheritedProperties key", async () => {
		let capturedContext: unknown;

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [
					createProgressEvent({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
				],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					capturedContext = input.context;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedContext).toMatchObject({ trigger: { inheritedProperties: {} } });
	});

	it("a builtin trigger fires for the user whose event is created", async () => {
		let capturedUserId: string | undefined;

		await processEventSchemaTriggers(
			{ userId: "user_2", createdEvents: [createProgressEvent()] },
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: (input) => {
					expect(input.userId).toBe("user_2");
					return Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							sandboxScriptId: "script_1",
							eventSchemaId: "event_schema_1",
						},
					]);
				},
				enqueueEventSchemaTriggerJob: (input) => {
					capturedUserId = input.userId;
					return Promise.resolve();
				},
			}),
		);

		expect(capturedUserId).toBe("user_2");
	});

	it("swallows queueing errors without throwing", () => {
		return expect(
			processEventSchemaTriggers(
				{ userId: "user_1", createdEvents: [createProgressEvent()] },
				createDeps({
					getActiveEventSchemaTriggersForEventSchemas: () =>
						Promise.resolve([
							{
								metadata: {},
								id: "trigger_1",
								sandboxScriptId: "script_1",
								eventSchemaId: "event_schema_1",
							},
						]),
					enqueueEventSchemaTriggerJob: () => {
						throw new Error("Redis connection failed");
					},
				}),
			),
		).resolves.toBeUndefined();
	});

	it("swallows DB errors when querying triggers without throwing", () => {
		return expect(
			processEventSchemaTriggers(
				{ userId: "user_1", createdEvents: [createProgressEvent()] },
				createDeps({
					getActiveEventSchemaTriggersForEventSchemas: () => {
						throw new Error("DB connection failed");
					},
				}),
			),
		).resolves.toBeUndefined();
	});

	it("queues one job per event when multiple events share the same trigger", async () => {
		const queued: string[] = [];

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [
					createProgressEvent({ id: "event_1" }),
					createProgressEvent({ id: "event_2" }),
				],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_1",
							eventSchemaId: "event_schema_1",
							sandboxScriptId: "script_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push(input.jobId);
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual([
			"event-schema-trigger-trigger_1-event_1",
			"event-schema-trigger-trigger_1-event_2",
		]);
	});

	it("fans out correctly when multiple triggers match a single event", async () => {
		const queued: string[] = [];

		await processEventSchemaTriggers(
			{
				userId: "user_1",
				createdEvents: [createProgressEvent({ id: "event_1" })],
			},
			createDeps({
				getActiveEventSchemaTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							metadata: {},
							id: "trigger_a",
							sandboxScriptId: "script_a",
							eventSchemaId: "event_schema_1",
						},
						{
							metadata: {},
							id: "trigger_b",
							sandboxScriptId: "script_b",
							eventSchemaId: "event_schema_1",
						},
					]),
				enqueueEventSchemaTriggerJob: (input) => {
					queued.push(input.jobId);
					return Promise.resolve();
				},
			}),
		);

		expect(queued).toEqual([
			"event-schema-trigger-trigger_a-event_1",
			"event-schema-trigger-trigger_b-event_1",
		]);
	});
});
