import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

import { createEventBulkBody } from "./schemas";

export const createEventsJobName = "create-events";

const beforeTriggerStateSchema = z.object({
	scriptId: nonEmptyStringSchema,
	triggerId: nonEmptyStringSchema,
	eventSchemaId: nonEmptyStringSchema,
});

const replayCreatedEventSchema = z.object({
	id: nonEmptyStringSchema,
	entityId: nonEmptyStringSchema,
	createdAt: nonEmptyStringSchema,
	updatedAt: nonEmptyStringSchema,
	occurredAt: nonEmptyStringSchema,
	properties: z.record(z.string(), z.unknown()),
	eventSchemaName: nonEmptyStringSchema,
	eventSchemaSlug: nonEmptyStringSchema,
	eventSchemaId: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
	entitySchemaSlug: nonEmptyStringSchema,
	sessionEntityId: z.string().nullable(),
});

export const createEventsJobData = z.object({
	body: createEventBulkBody,
	userId: nonEmptyStringSchema,
	step: z.literal("running_before_triggers").optional(),
	createdEvents: z.array(replayCreatedEventSchema).optional(),
	currentChildJobId: nonEmptyStringSchema.optional(),
	currentEventIndex: z.number().int().nonnegative().optional(),
	currentTriggerIndex: z.number().int().nonnegative().optional(),
	currentBeforeTriggers: z.array(beforeTriggerStateSchema).optional(),
});

export type CreateEventsJobData = z.infer<typeof createEventsJobData>;
export type ReplayCreatedEvent = z.infer<typeof replayCreatedEventSchema>;
export type BeforeTriggerState = z.infer<typeof beforeTriggerStateSchema>;
