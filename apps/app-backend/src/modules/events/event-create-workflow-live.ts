import { Activity } from "@effect/workflow";
import { badRequest, DbError, unknownToMessage } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { DateTime, Effect, Either, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";
import { AutomationsRepository } from "#modules/automations/repository";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import {
	type CreatedEventWithContext,
	decodeBeforeTriggerResult,
	resolveEventCreateItemScopes,
} from "./event-creation";
import { EventCreateWorkflowOperations } from "./operations-workflow";
import { EventsRepository } from "./repository";

const beforeTriggerFailed = (detail: string) => badRequest(`Before trigger failed: ${detail}`);
const invalidBeforeTriggerShape = "Before trigger returned invalid shape";

const EventDraft = Schema.Struct({
	occurredAt: Schema.String,
	properties: Schema.Unknown,
	sessionEntityId: Schema.optional(EntityId),
});

type EventDraft = typeof EventDraft.Type;

const PreparedBeforeTrigger = Schema.Struct({
	id: AutomationRuleId,
	sandboxScriptId: SandboxScriptId,
});

const PreparedItem = Schema.Struct({
	entityId: EntityId,
	entityName: Schema.String,
	occurredAt: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	isGlobalEntity: Schema.Boolean,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(EntityId),
	beforeTriggers: Schema.Array(PreparedBeforeTrigger),
});

type PreparedItem = typeof PreparedItem.Type;

const CreatedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	entityName: Schema.String,
	occurrenceId: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	isGlobalReference: Schema.Boolean,
	sessionEntityId: Schema.optional(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

type CreatedEvent = typeof CreatedEvent.Type;

const prepareItem = Effect.fn("prepareEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	item: EventCreateWorkflowPayload["payload"][number],
) {
	const runWithDb = yield* DbRunner;
	const automationsRepository = yield* AutomationsRepository;

	return yield* Activity.make({
		success: PreparedItem,
		error: EventCreateWorkflowError,
		name: `prepare-item-${itemIndex}`,
		execute: Effect.gen(function* () {
			const { entityId, entityScope, eventSchemaScope, sessionEntityId, occurredAt } =
				yield* resolveEventCreateItemScopes({ item, userId: payload.userId });

			const beforeTriggers = yield* runWithDb(
				automationsRepository.listEventCreatePolicies({
					userId: payload.userId,
					eventSchemaIds: [eventSchemaScope.id],
				}),
			);

			return {
				entityId,
				sessionEntityId,
				eventSchemaId: eventSchemaScope.id,
				occurredAt: occurredAt.toISOString(),
				eventSchemaName: eventSchemaScope.name,
				eventSchemaSlug: eventSchemaScope.slug,
				entityName: entityScope.entityName ?? "",
				entitySchemaId: entityScope.entitySchemaId,
				entitySchemaSlug: entityScope.entitySchemaSlug,
				isGlobalEntity: entityScope.entityUserId === null,
				propertiesSchema: eventSchemaScope.propertiesSchema,
				beforeTriggers: beforeTriggers.map((trigger) => ({
					id: trigger.id,
					sandboxScriptId: trigger.sandboxScriptId,
				})),
			} satisfies PreparedItem;
		}),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	prepared: PreparedItem,
	raw: EventDraft,
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: CreatedEvent,
		error: EventCreateWorkflowError,
		name: `write-event-${itemIndex}`,
		execute: Effect.gen(function* () {
			const properties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: raw.properties,
				propertiesSchema: prepared.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));

			const createdEvent = yield* runWithDb(
				eventsRepository.createEvent({
					properties,
					userId: payload.userId,
					entityId: prepared.entityId,
					eventSchemaId: prepared.eventSchemaId,
					sessionEntityId: raw.sessionEntityId,
					eventSchemaName: prepared.eventSchemaName,
					eventSchemaSlug: prepared.eventSchemaSlug,
					id: EventId.make(`${payload.executionId}-event-${itemIndex}`),
					occurredAt: DateTime.toDate(DateTime.unsafeMake(raw.occurredAt)),
				}),
			);

			return {
				...createdEvent,
				entityName: prepared.entityName,
				entitySchemaId: prepared.entitySchemaId,
				isGlobalReference: prepared.isGlobalEntity,
				entitySchemaSlug: prepared.entitySchemaSlug,
				occurrenceId: `${payload.executionId}-occurrence-${itemIndex}`,
			} satisfies CreatedEvent;
		}),
	});
});

const validatePolicyReplacement = Effect.fn("validateEventPolicyReplacement")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	policyIndex: number,
	prepared: PreparedItem,
	draft: EventDraft,
) {
	return yield* Activity.make({
		success: EventDraft,
		error: EventCreateWorkflowError,
		name: `validate-policy-replacement-${itemIndex}-${policyIndex}`,
		execute: Effect.gen(function* () {
			const resolved = yield* resolveEventCreateItemScopes({
				userId: payload.userId,
				item: {
					entityId: prepared.entityId,
					properties: draft.properties,
					occurredAt: draft.occurredAt,
					eventSchemaId: prepared.eventSchemaId,
					sessionEntityId: draft.sessionEntityId,
				},
			});
			const properties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: draft.properties,
				propertiesSchema: resolved.eventSchemaScope.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));
			return {
				properties,
				sessionEntityId: resolved.sessionEntityId,
				occurredAt: resolved.occurredAt.toISOString(),
			} satisfies EventDraft;
		}),
	});
});

const toAutomationOrigin = Effect.fn("resolveEventAutomationOrigin")(function* (
	payload: EventCreateWorkflowPayload,
) {
	if (payload.origin === "sandbox") {
		return { kind: "automation" as const, executionId: payload.executionId };
	}
	if (payload.origin === "import") {
		return { kind: "import" as const, importRunId: payload.importRunId };
	}
	if (payload.origin === "integration") {
		if (!payload.integrationId) {
			return yield* badRequest("integrationId is required for integration event creation");
		}
		return {
			kind: "integration" as const,
			importRunId: payload.importRunId,
			integrationId: payload.integrationId,
		};
	}
	return { kind: payload.origin } as const;
});

const runBeforeTriggers = Effect.fn(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	item: EventCreateWorkflowPayload["payload"][number],
	prepared: PreparedItem,
) {
	const operations = yield* EventCreateWorkflowOperations;
	const { userId, origin, importRunId, integrationId } = payload;

	let skipped = false;
	let properties: unknown = item.properties;
	let occurredAt = prepared.occurredAt;
	let sessionEntityId = prepared.sessionEntityId;

	for (const [policyIndex, trigger] of prepared.beforeTriggers.entries()) {
		const context = {
			trigger: {
				userId,
				origin,
				properties,
				occurredAt,
				sessionEntityId,
				phase: "before_create",
				entityId: prepared.entityId,
				eventSchemaId: prepared.eventSchemaId,
				...(importRunId ? { importRunId } : {}),
				entitySchemaId: prepared.entitySchemaId,
				eventSchemaSlug: prepared.eventSchemaSlug,
				...(integrationId ? { integrationId } : {}),
				entitySchemaSlug: prepared.entitySchemaSlug,
			},
		};

		const sandboxResult = yield* operations
			.processSandboxExecution({
				userId,
				context,
				driverName: "trigger",
				executionKind: "policy",
				scriptId: trigger.sandboxScriptId,
				executionId: `${payload.executionId}-before-${itemIndex}-${trigger.id}`,
			})
			.pipe(Effect.mapError((error) => beforeTriggerFailed(unknownToMessage(error))));

		if (sandboxResult.error) {
			return yield* beforeTriggerFailed(sandboxResult.error);
		}

		const triggerResult = yield* decodeBeforeTriggerResult(sandboxResult.value).pipe(
			Effect.mapError(() => badRequest(invalidBeforeTriggerShape)),
		);

		if (triggerResult.action === "skip") {
			skipped = true;
			break;
		}

		if (triggerResult.action === "replace") {
			if (triggerResult.body.properties !== undefined) {
				properties = triggerResult.body.properties;
			}
			if (triggerResult.body.occurredAt !== undefined) {
				occurredAt = triggerResult.body.occurredAt;
			}
			if (triggerResult.body.sessionEntityId !== undefined) {
				sessionEntityId = triggerResult.body.sessionEntityId ?? undefined;
			}
			const validated = yield* validatePolicyReplacement(
				payload,
				itemIndex,
				policyIndex,
				prepared,
				{ properties, occurredAt, sessionEntityId },
			);
			properties = validated.properties;
			occurredAt = validated.occurredAt;
			sessionEntityId = validated.sessionEntityId;
		}
	}

	return { skipped, raw: { properties, occurredAt, sessionEntityId } };
});

const dispatchAfterTriggers = Effect.fn(function* (
	payload: EventCreateWorkflowPayload,
	event: CreatedEventWithContext,
) {
	const origin = yield* toAutomationOrigin(payload);
	yield* dispatchLifecycleSubscriptions({
		userId: payload.userId,
		target: { kind: "event", schemaId: event.eventSchemaId },
		correlationId: payload.correlationId ?? payload.executionId,
		automation: {
			origin,
			operation: "create",
			occurrenceId: event.occurrenceId,
			automationDepth: (payload.automationDepth ?? 0) + 1,
			committedAt: DateTime.unsafeMake(event.createdAt),
			source: {
				kind: "event",
				after: {
					id: event.id,
					entityId: event.entityId,
					entityName: event.entityName,
					properties: event.properties,
					eventSchemaId: event.eventSchemaId,
					entitySchemaId: event.entitySchemaId,
					eventSchemaSlug: event.eventSchemaSlug,
					entitySchemaSlug: event.entitySchemaSlug,
					sessionEntityId: event.sessionEntityId ?? null,
					occurredAt: DateTime.unsafeMake(event.occurredAt),
				},
			},
		},
	}).pipe(Effect.mapError(() => new DbError({ message: "Event subscription dispatch failed" })));
});

const toCreatedEventWithContext = (event: CreatedEvent): CreatedEventWithContext => ({
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	entityName: event.entityName,
	occurredAt: event.occurredAt,
	properties: event.properties,
	occurrenceId: event.occurrenceId,
	eventSchemaId: event.eventSchemaId,
	entitySchemaId: event.entitySchemaId,
	sessionEntityId: event.sessionEntityId,
	eventSchemaName: event.eventSchemaName,
	eventSchemaSlug: event.eventSchemaSlug,
	entitySchemaSlug: event.entitySchemaSlug,
	isGlobalReference: event.isGlobalReference,
});

export const runEventCreateWorkflow = Effect.fn("runEventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
) {
	const operations = yield* EventCreateWorkflowOperations;
	let skipped = 0;
	const createdEvents: CreatedEventWithContext[] = [];

	for (const [itemIndex, item] of payload.payload.entries()) {
		const itemResult = yield* Effect.either(
			Effect.gen(function* () {
				const prepared = yield* prepareItem(payload, itemIndex, item);
				const policyResult = yield* runBeforeTriggers(payload, itemIndex, item, prepared);
				if (policyResult.skipped) {
					return null;
				}

				const createdEvent = yield* writeEvent(payload, itemIndex, prepared, policyResult.raw);
				const createdEventWithContext = toCreatedEventWithContext(createdEvent);
				return createdEventWithContext;
			}),
		);
		if (Either.isLeft(itemResult)) {
			if (createdEvents.length === 0) {
				return yield* itemResult.left;
			}
			const reason =
				itemResult.left._tag === "DbError"
					? new DbError({ message: "Event creation failed" })
					: itemResult.left;
			return {
				skipped,
				count: createdEvents.length,
				failure: { reason, index: itemIndex },
			};
		}
		if (itemResult.right === null) {
			skipped += 1;
			continue;
		}

		const createdEvent = itemResult.right;
		yield* dispatchAfterTriggers(payload, createdEvent);
		if (createdEvent.isGlobalReference) {
			yield* operations.ensureLibraryMembership({
				userId: payload.userId,
				entityId: createdEvent.entityId,
				executionId: `${payload.executionId}-libref-${createdEvent.entityId}`,
			});
		}
		createdEvents.push(createdEvent);
	}

	return { skipped, count: createdEvents.length };
});

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	runEventCreateWorkflow(payload),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
