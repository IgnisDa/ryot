import { type Job, Worker } from "bullmq";

import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import {
	getSandboxChildRunResult,
	queueSandboxChildRun,
	waitForSandboxChildRun,
} from "~/lib/sandbox/child-run";

import {
	type BeforeTriggerState,
	createEventsJobData,
	createEventsJobName,
	type CreateEventsJobData,
	type ReplayCreatedEvent,
} from "./jobs";
import { getActiveBeforeCreateTriggersForEventSchemas } from "./repository";
import {
	createEvent,
	eventServiceDeps,
	processEventSchemaTriggers,
	resolveBeforeCreateTriggerOutput,
	resolveCreateEventScope,
	resolveOccurredAt,
	type CreatedEventData,
	type EventServiceDeps,
	type GlobalEntityEventHook,
} from "./service";

type EventWorkerDeps = {
	eventServiceDeps: EventServiceDeps;
	createEvent: typeof createEvent;
	processEventSchemaTriggers: typeof processEventSchemaTriggers;
	resolveCreateEventScope: typeof resolveCreateEventScope;
	queueSandboxChildRun: typeof queueSandboxChildRun;
	getSandboxChildRunResult: typeof getSandboxChildRunResult;
	waitForSandboxChildRun: typeof waitForSandboxChildRun;
	resolveBeforeCreateTriggerOutput: typeof resolveBeforeCreateTriggerOutput;
	getActiveBeforeCreateTriggersForEventSchemas: typeof getActiveBeforeCreateTriggersForEventSchemas;
};

const eventWorkerDeps: EventWorkerDeps = {
	eventServiceDeps,
	createEvent,
	processEventSchemaTriggers,
	resolveCreateEventScope,
	queueSandboxChildRun,
	getSandboxChildRunResult,
	waitForSandboxChildRun,
	resolveBeforeCreateTriggerOutput,
	getActiveBeforeCreateTriggersForEventSchemas,
};

const createBeforeTriggerChildJobId = (
	job: Job,
	input: { eventIndex: number; triggerIndex: number },
) => `${job.id}_before_trigger_${input.eventIndex}_${input.triggerIndex}`;

const serializeCreatedEvent = (createdEvent: CreatedEventData): ReplayCreatedEvent => ({
	...createdEvent,
	createdAt: createdEvent.createdAt.toISOString(),
	updatedAt: createdEvent.updatedAt.toISOString(),
	occurredAt: createdEvent.occurredAt.toISOString(),
});

const deserializeCreatedEvents = (
	createdEvents: ReplayCreatedEvent[] | undefined,
): CreatedEventData[] =>
	(createdEvents ?? []).map((createdEvent) => ({
		id: createdEvent.id,
		entityId: createdEvent.entityId,
		properties: createdEvent.properties,
		eventSchemaName: createdEvent.eventSchemaName,
		eventSchemaSlug: createdEvent.eventSchemaSlug,
		eventSchemaId: createdEvent.eventSchemaId,
		entitySchemaId: createdEvent.entitySchemaId,
		entitySchemaSlug: createdEvent.entitySchemaSlug,
		sessionEntityId: createdEvent.sessionEntityId,
		createdAt: new Date(createdEvent.createdAt),
		updatedAt: new Date(createdEvent.updatedAt),
		occurredAt: new Date(createdEvent.occurredAt),
	}));

const createJobData = (input: {
	body: CreateEventsJobData["body"];
	userId: string;
	createdEvents: CreatedEventData[];
	currentEventIndex: number;
	step?: "running_before_triggers";
	currentChildJobId?: string;
	currentTriggerIndex?: number;
	currentBeforeTriggers?: BeforeTriggerState[];
}): CreateEventsJobData => ({
	body: input.body,
	userId: input.userId,
	createdEvents: input.createdEvents.map(serializeCreatedEvent),
	currentEventIndex: input.currentEventIndex,
	step: input.step,
	currentChildJobId: input.currentChildJobId,
	currentTriggerIndex: input.currentTriggerIndex,
	currentBeforeTriggers: input.currentBeforeTriggers,
});

const createEventDepsWithoutBeforeTriggers = (deps: EventWorkerDeps): EventServiceDeps => ({
	...deps.eventServiceDeps,
	getActiveBeforeCreateTriggersForEventSchemas: () => Promise.resolve([]),
	runBeforeCreateTrigger: () =>
		Promise.resolve({
			outcome: "error",
			error: "Before trigger execution should be replayed by the worker",
		}),
});

const createEventFromResolvedBody = async (input: {
	body: CreateEventsJobData["body"][number];
	userId: string;
	deps: EventWorkerDeps;
}) => {
	const result = await input.deps.createEvent(
		{ body: input.body, userId: input.userId },
		createEventDepsWithoutBeforeTriggers(input.deps),
	);
	if ("error" in result) {
		throw new Error(result.message);
	}
	if ("skipped" in result) {
		throw new Error(`Event skipped by before-trigger: ${result.reason}`);
	}

	return result.data;
};

const resolveCurrentEventScope = async (input: {
	userId: string;
	deps: EventWorkerDeps;
	runGlobalEntityHook?: boolean;
	body: CreateEventsJobData["body"][number];
}) => {
	const result = await input.deps.resolveCreateEventScope(
		{ body: input.body, userId: input.userId },
		{ runGlobalEntityHook: input.runGlobalEntityHook },
		input.deps.eventServiceDeps,
	);
	if ("error" in result) {
		throw new Error(result.message);
	}

	return result.data;
};

const queueNextBeforeTrigger = async (input: {
	job: Job;
	userId: string;
	eventIndex: number;
	triggerIndex: number;
	deps: EventWorkerDeps;
	runGlobalEntityHook?: boolean;
	body: CreateEventsJobData["body"];
	createdEvents: CreatedEventData[];
	beforeTriggers: BeforeTriggerState[];
}) => {
	const currentBody = input.body[input.eventIndex];
	const currentTrigger = input.beforeTriggers[input.triggerIndex];
	if (!currentBody || !currentTrigger) {
		throw new Error("Before trigger event state is missing");
	}

	const resolvedScope = await resolveCurrentEventScope({
		deps: input.deps,
		body: currentBody,
		userId: input.userId,
		runGlobalEntityHook: input.runGlobalEntityHook,
	});
	const childJobId = createBeforeTriggerChildJobId(input.job, {
		eventIndex: input.eventIndex,
		triggerIndex: input.triggerIndex,
	});

	await input.deps.queueSandboxChildRun({
		job: input.job,
		childJobId,
		sandboxJobData: {
			userId: input.userId,
			driverName: "trigger",
			scriptId: currentTrigger.scriptId,
			context: {
				trigger: {
					userId: input.userId,
					phase: "before_create",
					origin: "api",
					entityId: resolvedScope.eventScope.entityId,
					properties: currentBody.properties,
					occurredAt: resolveOccurredAt({ occurredAt: currentBody.occurredAt }).toISOString(),
					eventSchemaId: resolvedScope.eventScope.eventSchemaId,
					entitySchemaId: resolvedScope.eventScope.entitySchemaId,
					eventSchemaSlug: resolvedScope.eventScope.eventSchemaSlug,
					entitySchemaSlug: resolvedScope.eventScope.entitySchemaSlug,
					integrationId: undefined,
					importRunId: undefined,
					sessionEntityId: currentBody.sessionEntityId,
				},
			},
		},
		jobData: createJobData({
			body: input.body,
			userId: input.userId,
			step: "running_before_triggers",
			createdEvents: input.createdEvents,
			currentEventIndex: input.eventIndex,
			currentChildJobId: childJobId,
			currentTriggerIndex: input.triggerIndex,
			currentBeforeTriggers: input.beforeTriggers,
		}),
	});
};

export const processCreateEventsJob = async (
	job: Job,
	token: string | undefined,
	deps: EventWorkerDeps = eventWorkerDeps,
) => {
	const parsed = createEventsJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Create events payload is invalid");
	}

	const body = [...parsed.data.body];
	const userId = parsed.data.userId;
	const createdEvents = deserializeCreatedEvents(parsed.data.createdEvents);
	let currentBeforeTriggers = parsed.data.currentBeforeTriggers ?? [];
	let currentTriggerIndex = parsed.data.currentTriggerIndex ?? 0;
	let currentEventIndex = parsed.data.currentEventIndex ?? 0;
	let currentChildJobId = parsed.data.currentChildJobId;
	let step = parsed.data.step;

	// oxlint-disable no-await-in-loop
	while (currentEventIndex < body.length) {
		const currentBody = body[currentEventIndex];
		if (!currentBody) {
			throw new Error("Event body is missing");
		}

		if (step === "running_before_triggers") {
			if (!currentChildJobId) {
				throw new Error("Before trigger child job id is missing");
			}

			const triggerOutput = deps.resolveBeforeCreateTriggerOutput(
				await deps.getSandboxChildRunResult(job, currentChildJobId),
			);
			if (triggerOutput.outcome === "error") {
				throw new Error(`Before trigger failed: ${triggerOutput.error}`);
			}

			if (triggerOutput.result.action === "skip") {
				throw new Error(`Event skipped by before-trigger: ${triggerOutput.result.reason}`);
			}

			if (triggerOutput.result.action === "replace") {
				body[currentEventIndex] = {
					...currentBody,
					properties: triggerOutput.result.body.properties ?? currentBody.properties,
					occurredAt: triggerOutput.result.body.occurredAt ?? currentBody.occurredAt,
					sessionEntityId:
						triggerOutput.result.body.sessionEntityId === undefined
							? currentBody.sessionEntityId
							: (triggerOutput.result.body.sessionEntityId ?? undefined),
				};
			}

			currentTriggerIndex += 1;
			currentChildJobId = undefined;
			if (currentTriggerIndex < currentBeforeTriggers.length) {
				await queueNextBeforeTrigger({
					job,
					deps,
					body,
					userId,
					createdEvents,
					runGlobalEntityHook: false,
					eventIndex: currentEventIndex,
					triggerIndex: currentTriggerIndex,
					beforeTriggers: currentBeforeTriggers,
				});
				await deps.waitForSandboxChildRun(job, token);
				currentChildJobId = createBeforeTriggerChildJobId(job, {
					eventIndex: currentEventIndex,
					triggerIndex: currentTriggerIndex,
				});
				continue;
			}
			const finalBody = body[currentEventIndex];
			if (!finalBody) {
				throw new Error("Event body is missing");
			}

			createdEvents.push(await createEventFromResolvedBody({ body: finalBody, userId, deps }));
			currentEventIndex += 1;
			currentTriggerIndex = 0;
			currentBeforeTriggers = [];
			step = undefined;
			await job.updateData(
				createJobData({
					body,
					userId,
					createdEvents,
					currentEventIndex,
				}),
			);
			continue;
		}

		const resolvedScope = await resolveCurrentEventScope({
			deps,
			userId,
			body: currentBody,
			runGlobalEntityHook: true,
		});
		const beforeTriggers = await deps.getActiveBeforeCreateTriggersForEventSchemas({
			userId,
			eventSchemaIds: [resolvedScope.eventScope.eventSchemaId],
		});
		currentBeforeTriggers = beforeTriggers.map((trigger) => ({
			eventSchemaId: trigger.eventSchemaId,
			triggerId: trigger.id,
			scriptId: trigger.sandboxScriptId,
		}));

		if (currentBeforeTriggers.length === 0) {
			createdEvents.push(await createEventFromResolvedBody({ body: currentBody, userId, deps }));
			currentEventIndex += 1;
			await job.updateData(
				createJobData({
					body,
					userId,
					createdEvents,
					currentEventIndex,
				}),
			);
			continue;
		}

		currentTriggerIndex = 0;
		step = "running_before_triggers";
		await queueNextBeforeTrigger({
			job,
			deps,
			body,
			userId,
			createdEvents,
			runGlobalEntityHook: false,
			eventIndex: currentEventIndex,
			triggerIndex: currentTriggerIndex,
			beforeTriggers: currentBeforeTriggers,
		});
		currentChildJobId = createBeforeTriggerChildJobId(job, {
			eventIndex: currentEventIndex,
			triggerIndex: currentTriggerIndex,
		});
		await deps.waitForSandboxChildRun(job, token);
	}
	// oxlint-enable no-await-in-loop

	await deps.processEventSchemaTriggers({ createdEvents, userId }, deps.eventServiceDeps);
	return { count: createdEvents.length };
};

const processEventsJob = async (
	job: Job,
	token: string | undefined,
	deps: EventWorkerDeps = eventWorkerDeps,
) => {
	if (job.name === createEventsJobName) {
		return processCreateEventsJob(job, token, deps);
	}

	throw new Error(`Unsupported events job: ${job.name}`);
};

export const createEventsWorker = (
	options: { onGlobalEntityScope?: GlobalEntityEventHook } = {},
) => {
	const deps: EventWorkerDeps = {
		...eventWorkerDeps,
		eventServiceDeps: { ...eventServiceDeps, onGlobalEntityScope: options.onGlobalEntityScope },
	};
	const worker = new Worker("event", (job, token) => processEventsJob(job, token, deps), {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("event"));
	return worker;
};
