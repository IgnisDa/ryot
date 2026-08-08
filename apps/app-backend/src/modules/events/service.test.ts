import { assert, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	EntityId,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-utils/effect";

import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({
		...overrides,
	});

const makeServiceLayer = (input: {
	workflowEngine?: WorkflowEngine["Service"];
	eventsRepository?: ReturnType<typeof makeEventsRepository>;
}) =>
	Layer.mergeAll(
		databaseLayer,
		Layer.succeed(WorkflowEngine, input.workflowEngine ?? makeWorkflowEngine()),
		input.eventsRepository ?? makeEventsRepository(),
	);

const makeEventsServiceLayer = (input: Parameters<typeof makeServiceLayer>[0]) =>
	EventsService.layer.pipe(Layer.provideMerge(makeServiceLayer(input)));

it.effect("routes per-event deletes and reference moves through the repository", () => {
	const calls: string[] = [];
	const layer = makeEventsServiceLayer({
		eventsRepository: makeEventsRepository({
			deleteEvent: (input) =>
				Effect.sync(() => {
					calls.push(`delete:${input.eventId}`);
					return input.eventId;
				}),
			updateEventEntityReferences: (input) =>
				Effect.sync(() => {
					calls.push(`${input.eventId}:${input.mergeFrom}->${input.mergeInto}`);
					return input.eventId;
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const eventId = EventId.make("event-1");

		const updated = yield* service.update({
			eventId,
			userId: user.id,
			mergeFrom: EntityId.make("from"),
			mergeInto: EntityId.make("into"),
		});
		const deleted = yield* service.delete({ eventId, userId: user.id });

		expect(updated).toBe(eventId);
		expect(deleted).toBe(eventId);
		expect(calls).toEqual(["event-1:from->into", "delete:event-1"]);
	}).pipe(Effect.provide(layer));
});

it.effect("awaits API event creation and returns the workflow outcomes", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;

	const layer = makeEventsServiceLayer({
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed({
					count: 1,
					failure: null,
					outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.create({
			source: "api",
			userId: user.id,
			payload: [
				{
					properties: { rating: 5 },
					occurredAt: "2026-01-01T00:00:00.000Z",
					entityId: EntityId.make("entity-1"),
					eventSchemaSlug: EventSchemaSlug.make("event-schema-1"),
				},
			],
		});

		expect(result).toEqual({
			count: 1,
			failure: null,
			outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
		});
		expect(capturedOptions).toMatchObject({
			payload: {
				origin: "api",
				userId: user.id,
				payload: [
					{
						properties: { rating: 5 },
						occurredAt: "2026-01-01T00:00:00.000Z",
						entityId: EntityId.make("entity-1"),
						eventSchemaSlug: EventSchemaSlug.make("event-schema-1"),
					},
				],
			},
		});
		assert(
			typeof capturedOptions?.payload === "object" &&
				capturedOptions.payload !== null &&
				"executionId" in capturedOptions.payload,
		);
		expect(typeof capturedOptions.payload.executionId).toBe("string");
	}).pipe(Effect.provide(layer));
});

it.effect("marks sandbox-created events with the creating automation execution", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const layer = makeEventsServiceLayer({
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed({ count: 0, failure: null, outcomes: [] });
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		yield* service.create({
			userId: user.id,
			source: "sandbox",
			executionId: "subscription-run-sandbox",
			payload: [
				{
					properties: {},
					entityId: EntityId.make("entity-1"),
					eventSchemaSlug: EventSchemaSlug.make("event-schema-1"),
				},
			],
		});

		expect(capturedOptions).toMatchObject({
			payload: {
				origin: "sandbox",
				lifecycleOrigin: { kind: "automation", executionId: "subscription-run-sandbox" },
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("awaits the durable import event-create path with its deterministic execution id", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;

	const layer = makeEventsServiceLayer({
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed({
					count: 1,
					failure: null,
					outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.create({
			userId: user.id,
			source: "import",
			executionId: "run-1-event-0-0",
			metadata: { importRunId: ImportRunId.make("run-1") },
			payload: [
				{
					properties: { rating: 5 },
					entityId: EntityId.make("entity-1"),
					eventSchemaSlug: EventSchemaSlug.make("event-schema-1"),
				},
			],
		});

		expect(result.count).toBe(1);
		expect(capturedOptions).toMatchObject({
			payload: {
				userId: user.id,
				origin: "import",
				importRunId: "run-1",
				executionId: "run-1-event-0-0",
			},
		});
		expect(capturedOptions?.discard).toBeUndefined();
	}).pipe(Effect.provide(layer));
});
