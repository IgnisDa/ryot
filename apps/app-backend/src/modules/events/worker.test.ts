import { describe, expect, it } from "bun:test";

import { WaitingChildrenError, type Job } from "bullmq";

import { createEventBody, createEventDeps, createListedEvent } from "~/lib/test-fixtures/events";

import {
	resolveBeforeCreateTriggerOutput,
	type CreatedEventData,
	type ResolvedCreateEventScope,
} from "./service";
import { processCreateEventsJob } from "./worker";

const createJob = (data: unknown): Job =>
	// oxlint-disable-next-line no-unsafe-type-assertion
	({
		id: "job_1",
		data,
		queueQualifiedName: "bull:event",
		updateData: () => Promise.resolve(),
		getChildrenValues: () => Promise.resolve({}),
		moveToWaitingChildren: () => Promise.resolve(false),
	}) as unknown as Job;

const createResolvedCreateEventScope = (): ResolvedCreateEventScope => ({
	eventScope: {
		entityId: "entity_1",
		entityUserId: "user_1",
		eventSchemaId: "event_schema_1",
		isBuiltin: false,
		eventSchemaName: "Finished",
		eventSchemaSlug: "finished",
		entitySchemaSlug: "custom",
		entitySchemaId: "schema_1",
		propertiesSchema: {
			fields: {
				rating: {
					label: "Rating",
					type: "number",
					description: "Rating score",
					validation: { required: true },
				},
			},
		},
		eventSchemaEntitySchemaId: "schema_1",
	},
});

describe("processCreateEventsJob", () => {
	it("queues the current before-trigger child and waits", async () => {
		const body = [createEventBody()];
		let queuedChild:
			| {
					childJobId: string;
					jobData: Record<string, unknown>;
					sandboxJobData: Record<string, unknown>;
			  }
			| undefined;

		try {
			await processCreateEventsJob(createJob({ body, userId: "user_1" }), "token_1", {
				eventServiceDeps: createEventDeps(),
				createEvent: () => {
					throw new Error("createEvent should not run before waiting");
				},
				processEventSchemaTriggers: () => Promise.resolve(),
				resolveBeforeCreateTriggerOutput,
				getSandboxChildRunResult: () => Promise.resolve({ success: true, error: null, logs: null }),
				queueSandboxChildRun: (input) => {
					queuedChild = input;
					return Promise.resolve();
				},
				waitForSandboxChildRun: () => Promise.reject(new WaitingChildrenError()),
				getActiveBeforeCreateTriggersForEventSchemas: () =>
					Promise.resolve([
						{
							id: "trigger_1",
							position: 0,
							eventSchemaId: "event_schema_1",
							sandboxScriptId: "script_1",
						},
					]),
				resolveCreateEventScope: () => Promise.resolve({ data: createResolvedCreateEventScope() }),
			});
			throw new Error("Expected WaitingChildrenError");
		} catch (error) {
			expect(error).toBeInstanceOf(WaitingChildrenError);
		}

		expect(queuedChild?.childJobId).toBe("job_1_before_trigger_0_0");
		expect(queuedChild?.jobData).toMatchObject({
			currentEventIndex: 0,
			currentTriggerIndex: 0,
			step: "running_before_triggers",
		});
		expect(queuedChild?.sandboxJobData).toMatchObject({
			driverName: "trigger",
			scriptId: "script_1",
			userId: "user_1",
		});
	});

	it("replays the completed child result and creates the event immediately", async () => {
		const body = [createEventBody()];
		const createdEvent = {
			...createListedEvent({ properties: body[0]?.properties ?? {} }),
			entitySchemaId: "schema_1",
			entitySchemaSlug: "custom",
		} satisfies CreatedEventData;
		let createdEventsForAfterTriggers: CreatedEventData[] | undefined;

		const result = await processCreateEventsJob(createJob({ body, userId: "user_1" }), "token_1", {
			eventServiceDeps: createEventDeps(),
			processEventSchemaTriggers: (input) => {
				createdEventsForAfterTriggers = input.createdEvents;
				return Promise.resolve();
			},
			resolveBeforeCreateTriggerOutput,
			queueSandboxChildRun: () => Promise.resolve(),
			waitForSandboxChildRun: () => Promise.resolve(),
			getSandboxChildRunResult: () =>
				Promise.resolve({
					error: null,
					logs: null,
					success: true,
					value: { action: "allow" },
				}),
			getActiveBeforeCreateTriggersForEventSchemas: () =>
				Promise.resolve([
					{
						id: "trigger_1",
						position: 0,
						eventSchemaId: "event_schema_1",
						sandboxScriptId: "script_1",
					},
				]),
			resolveCreateEventScope: () => Promise.resolve({ data: createResolvedCreateEventScope() }),
			createEvent: async (input, deps) => {
				if (!deps) {
					throw new Error("Expected event service deps");
				}

				expect(
					await deps.getActiveBeforeCreateTriggersForEventSchemas({
						eventSchemaIds: ["event_schema_1"],
						userId: input.userId,
					}),
				).toEqual([]);
				return Promise.resolve({ data: createdEvent });
			},
		});

		expect(result).toEqual({ count: 1 });
		expect(createdEventsForAfterTriggers).toEqual([createdEvent]);
	});
});
