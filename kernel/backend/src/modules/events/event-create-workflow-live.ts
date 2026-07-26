import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventDraft,
	AutomationEventSnapshot,
	AutomationRun,
	AutomationTrigger,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventCreateItemError,
	type EventCreateFailureReason,
	type EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { AutomationRunId, EventId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import {
	LifecycleDispatchPlan,
	LifecyclePlanner,
	type LifecyclePlan,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";
import { runEventCreatePolicies, type PolicyIdentity } from "./event-policy-engine";
import { EventsRepository } from "./repository";

const Plan = Schema.Struct({
	wasCreated: Schema.Boolean,
	trigger: AutomationTrigger,
	runs: Schema.Array(AutomationRun),
	policies: Schema.Array(
		Schema.Struct({
			runId: AutomationRunId,
			position: Schema.Finite,
			batchFrequency: Schema.optional(Schema.Literals(["item", "once-per-subject"])),
		}),
	),
});
const PreparedItem = Schema.Struct({
	plan: Plan,
	propertiesSchema: AppSchema,
	eventSchemaName: Schema.String,
	eventSchemaPluginId: Schema.NullOr(Schema.String),
	eventSchemaFingerprint: CatalogDefinitionFingerprint,
});

const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const database = yield* Database;
		return yield* retryOnDeadlock(
			mapDatabaseErrors(
				database.transaction((tx) => effect.pipe(Effect.provideService(Database, tx))),
			),
		);
	});

const itemCommand = (payload: EventCreateWorkflowPayload, index: number): LifecycleCommand => ({
	...payload.command,
	itemIdentity: `${payload.command.itemIdentity}:event:${index}`,
});

const prepareItem = Effect.fn("prepareEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	excluded: ReadonlyArray<PolicyIdentity>,
) {
	const planner = yield* LifecyclePlanner;
	const item = payload.payload[index];
	if (!item) {
		return yield* Effect.die("Missing event batch item");
	}
	return yield* makeActivity({
		name: `prepare-item-${index}`,
		success: PreparedItem satisfies DurableSchema,
		error: EventCreateWorkflowError satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const scope = yield* resolveEventCreateItemScopes({
				userId: payload.userId,
				item: {
					...item,
					occurredAt:
						item.occurredAt === undefined || item.occurredAt === ""
							? payload.command.occurredAt
							: item.occurredAt,
				},
			});
			const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
				entityId: scope.entityId,
				properties: item.properties,
				occurredAt: scope.occurredAt.toISOString(),
				eventSchemaSlug: scope.eventSchemaScope.id,
				sessionEntityId: scope.sessionEntityId ?? null,
				entitySchemaSlug: scope.entityScope.entitySchemaSlug,
			}).pipe(
				Effect.mapError(() => new EventCreateItemError({ reason: { code: "invalid-properties" } })),
			);
			const plan = yield* transaction(
				planner.plan({
					excludedOncePerSubjectPolicies: excluded,
					trigger: lifecycleTrigger(itemCommand(payload, index), payload.userId, {
						draft,
						resource: "event",
						category: "request",
						operation: "create",
					}),
				}),
			);
			return {
				eventSchemaName: scope.eventSchemaScope.name,
				propertiesSchema: scope.eventSchemaScope.propertiesSchema,
				eventSchemaPluginId: scope.eventSchemaScope.pluginId ?? null,
				eventSchemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
				plan: {
					...plan,
					policies: plan.policies.map((policy) => ({
						runId: policy.runId,
						position: policy.position,
						batchFrequency: policy.batchFrequency,
					})),
				},
			};
		}),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	prepared: typeof PreparedItem.Type,
	draft: AutomationEventDraft,
) {
	const repository = yield* EventsRepository;
	const entities = yield* EntitiesRepository;
	const eventSchemas = yield* EventSchemasRepository;
	const planner = yield* LifecyclePlanner;
	const command = itemCommand(payload, index);
	return yield* makeActivity({
		name: `write-event-${index}`,
		error: EventCreateWorkflowError satisfies DurableSchema,
		success: Schema.Struct({
			eventId: EventId,
			dispatch: Schema.Array(LifecycleDispatchPlan),
		}) satisfies DurableSchema,
		execute: transaction(
			Effect.gen(function* () {
				const eventId = EventId.make(
					`event_${sha256Base64Url(stableStringify([command.causation.executionId, command.itemIdentity]))}`,
				);
				const replay = yield* repository.getEventCreateReplay({ eventId, userId: payload.userId });
				if (replay) {
					const expected = yield* Schema.decodeEffect(AutomationEventSnapshot)({
						...draft,
						id: eventId,
						createdAt: replay.event.createdAt,
						updatedAt: replay.event.updatedAt,
					}).pipe(Effect.mapError(() => new DbError({ message: "Invalid event replay snapshot" })));
					if (
						replay.eventSchemaPluginId !== prepared.eventSchemaPluginId ||
						stableStringify(replay.event) !== stableStringify(expected)
					) {
						return yield* new DbError({ message: "Conflicting event command identity" });
					}
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(
							{
								...command,
								causation: { ...command.causation, parentTriggerId: prepared.plan.trigger.id },
							},
							payload.userId,
							{ resource: "event", category: "change", after: replay.event, operation: "create" },
						),
					});
					if (plan.wasCreated) {
						return yield* new DbError({ message: "Committed event is missing its lifecycle plan" });
					}
					return { eventId, dispatch: [toLifecycleDispatchPlan(plan)] };
				}
				yield* eventSchemas.lockCatalog();
				yield* entities.lockEntityReferencesByIds([
					draft.entityId,
					...(draft.sessionEntityId === null ? [] : [draft.sessionEntityId]),
				]);
				const currentScope = yield* resolveEventCreateItemScopes({
					userId: payload.userId,
					item: { ...draft, sessionEntityId: draft.sessionEntityId ?? undefined },
				});
				if (
					stableStringify(catalogDefinitionFingerprint(currentScope.eventSchemaScope)) !==
					stableStringify(prepared.eventSchemaFingerprint)
				) {
					return yield* new EventCreateItemError({
						reason: { code: "event-schema-not-found", eventSchemaSlug: draft.eventSchemaSlug },
					});
				}
				const event = yield* repository.createEvent({
					...draft,
					id: eventId,
					userId: payload.userId,
					properties: { ...draft.properties },
					eventSchemaName: prepared.eventSchemaName,
					eventSchemaPluginId: prepared.eventSchemaPluginId,
					sessionEntityId: draft.sessionEntityId ?? undefined,
					occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
				});
				const after = yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
					...draft,
					id: event.id,
					entityId: event.entityId,
					createdAt: event.createdAt,
					updatedAt: event.updatedAt,
					properties: event.properties,
					occurredAt: event.occurredAt,
					eventSchemaSlug: event.eventSchemaSlug,
					sessionEntityId: event.sessionEntityId ?? null,
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })),
				);
				const plan: LifecyclePlan = yield* planner.plan({
					trigger: lifecycleTrigger(
						{
							...command,
							causation: { ...command.causation, parentTriggerId: prepared.plan.trigger.id },
						},
						payload.userId,
						{ after, resource: "event", category: "change", operation: "create" },
					),
				});
				return { eventId: event.id, dispatch: [toLifecycleDispatchPlan(plan)] };
			}),
		),
	});
});

export const runEventCreateWorkflow = Effect.fn("EventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
	const execution = yield* LifecycleExecution;
	const outcomes: EventCreateItemOutcome[] = [];
	const warnings: AutomationWarning[] = [];
	const subjects = new Map<string, PolicyIdentity[]>();
	let count = 0;
	let failure: { index: number; reason: EventCreateFailureReason } | null = null;
	for (const [index, item] of payload.payload.entries()) {
		const processed = subjects.get(item.entityId.trim()) ?? [];
		subjects.set(item.entityId.trim(), processed);
		const attempt = yield* Effect.gen(function* () {
			const prepared = yield* prepareItem(payload, index, [...processed]);
			const policy = yield* runEventCreatePolicies(
				payload,
				index,
				prepared.plan,
				prepared.propertiesSchema,
				processed,
			);
			if (policy.kind === "skipped") {
				return policy;
			}
			return {
				kind: "written" as const,
				committed: yield* writeEvent(payload, index, prepared, policy.draft),
			};
		}).pipe(
			Effect.catchTag("EventCreateItemError", (error) =>
				Effect.succeed({ reason: error.reason, kind: "failed" as const }),
			),
		);
		if (attempt.kind === "failed") {
			failure = { index, reason: attempt.reason };
			break;
		}
		if (attempt.kind === "skipped") {
			outcomes.push({ index, reason: attempt.reason, status: "skipped_by_policy" });
			continue;
		}
		const { eventId, dispatch } = attempt.committed;
		outcomes.push({ index, eventId, status: "written" });
		count += 1;
		warnings.push(
			...(yield* execution
				.dispatch(dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
		);
	}
	return { count, failure, outcomes, warnings };
});

export const EventCreateWorkflowDefinitionsLive = implementWorkflow(
	EventCreateWorkflow,
	runEventCreateWorkflow,
);
