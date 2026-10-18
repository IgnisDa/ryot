import { DbError } from "@ryot-app/contract/errors";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import type { EventMutationChange } from "@ryot-app/contract/modules/events/mutations";
import {
	EventBadRequest,
	EventCreateItemError,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import { UserCommand, UserCommandResult } from "@ryot-app/contract/modules/mutations/user-command";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";

import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan, LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import {
	type PolicyBatchResult,
	PolicyBatchWorkflow,
} from "#modules/automations/lifecycle/policy-batch";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	EntitiesService,
	restoreUserEntitySave,
	SerializedUserEntitySave,
	serializeUserEntitySave,
} from "#modules/entities/service";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventMutations, eventPolicyItems, PreparedEventChanges } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { DataRevisions } from "#modules/mutations/data-revisions";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	restoreUserRelationshipCreate,
	SerializedUserRelationshipCreate,
	serializeUserRelationshipCreate,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

const Failure = Schema.Union([
	DbError,
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
	EventBadRequest,
	EventNotFound,
	EventStale,
	EventCreateItemError,
	RelationshipBadRequest,
	RelationshipNotFound,
	AutomationPolicyExecutionError,
]);
const Payload = Schema.Struct({
	userId: UserId,
	input: UserCommand,
	command: DomainLifecycleCommand,
});
const identity = ({ command }: { command: DomainLifecycleCommand }) =>
	`${command.causation.executionId}:${command.itemIdentity}`;

export const UserCommandWorkflow = Workflow.make("UserCommandWorkflow", {
	error: Failure,
	payload: Payload,
	idempotencyKey: identity,
	success: UserCommandResult,
});
export const UserEntityPreparationWorkflow = Workflow.make("UserEntityPreparationWorkflow", {
	error: Failure,
	payload: Payload,
	idempotencyKey: identity,
	success: SerializedUserEntitySave,
});
export const UserRelationshipPreparationWorkflow = Workflow.make(
	"UserRelationshipPreparationWorkflow",
	{
		error: Failure,
		idempotencyKey: identity,
		success: Schema.NullOr(SerializedUserRelationshipCreate),
		payload: Schema.Struct({
			userId: UserId,
			command: DomainLifecycleCommand,
			entity: SerializedUserEntitySave,
			relationship: UserCommand.fields.relationships.value,
		}),
	},
);

const referencedEntity = (
	reference: typeof UserCommand.fields.relationships.value.Type.source,
	rootId: EntityId,
) => (reference.kind === "root" ? rootId : reference.entityId);

export const UserCommandWorkflowDefinitionsLive = Layer.mergeAll(
	implementWorkflow(
		UserEntityPreparationWorkflow,
		Effect.fn("UserEntityPreparationWorkflow")(function* (payload, executionId) {
			const entities = yield* EntitiesService;
			const receipts = yield* MutationReceipts.make;
			yield* admitWorkflow(
				receipts,
				UserEntityPreparationWorkflow,
				payload.command.accountGeneration,
				executionId,
			);
			const owner = payload.command.writeContext?.pluginRevision;
			if (!owner) {
				return yield* new DbError({ message: "User command requires exact plugin authority" });
			}
			const entity = payload.input.entity;
			return serializeUserEntitySave(
				yield* entities.prepareUserSave({
					name: entity.name,
					target: entity.target,
					userId: payload.userId,
					lifecycle: payload.command,
					properties: entity.properties,
					entitySchema: {
						owner: definitionOwner(owner.id),
						slug: EntitySchemaSlug.make(entity.entitySchemaSlug),
					},
				}),
			);
		}),
	),
	implementWorkflow(
		UserRelationshipPreparationWorkflow,
		Effect.fn("UserRelationshipPreparationWorkflow")(function* (payload, executionId) {
			const relationships = yield* RelationshipsService;
			const receipts = yield* MutationReceipts.make;
			yield* admitWorkflow(
				receipts,
				UserRelationshipPreparationWorkflow,
				payload.command.accountGeneration,
				executionId,
			);
			const owner = payload.command.writeContext?.pluginRevision;
			if (!owner) {
				return yield* new DbError({ message: "User command requires exact plugin authority" });
			}
			const entity = yield* restoreUserEntitySave(payload.entity);
			const relation = payload.relationship;
			const prepared = yield* relationships.prepareUserCreate(
				{
					scope: "user",
					userId: payload.userId,
					properties: relation.properties,
					sourceEntityId: referencedEntity(relation.source, entity.entityId),
					targetEntityId: referencedEntity(relation.target, entity.entityId),
					relationshipSchema: {
						owner: definitionOwner(owner.id),
						slug: RelationshipSchemaSlug.make(relation.relationshipSchemaSlug),
					},
				},
				payload.command,
				entity.created ?? undefined,
				relation.propertiesMode,
			);
			return prepared === null
				? null
				: yield* Schema.decodeEffect(SerializedUserRelationshipCreate)(
						serializeUserRelationshipCreate(prepared),
					).pipe(Effect.mapError(() => new DbError({ message: "Invalid prepared relationship" })));
		}),
	),
	implementWorkflow(
		UserCommandWorkflow,
		Effect.fn("UserCommandWorkflow")(function* (payload, executionId) {
			const receipts = yield* MutationReceipts.make;
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesService;
			const entityRows = yield* EntitiesRepository;
			const eventRows = yield* EventsRepository;
			const events = yield* EventMutations;
			const dataRevisions = yield* DataRevisions;
			const relationships = yield* RelationshipsService;
			const planner = yield* LifecyclePlanner;
			const lifecycle = yield* LifecycleExecution;
			yield* admitWorkflow(
				receipts,
				UserCommandWorkflow,
				payload.command.accountGeneration,
				executionId,
			);
			const receiptIdentity = mutationReceiptIdentity({
				input: payload.input,
				command: payload.command,
				ownerUserId: payload.userId,
				scopeUserId: payload.userId,
				commandKind: "user-command:commit",
			});
			const existing = yield* receipts
				.peek(receiptIdentity, UserCommandResult)
				.pipe(
					Effect.catchTag(
						"MutationReceiptIdentityConflict",
						() => new DbError({ message: "Command identity reused with different input" }),
					),
				);
			if (existing) {
				yield* lifecycle
					.dispatch(existing.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return existing.result;
			}
			const rawEntity = yield* UserEntityPreparationWorkflow.execute({
				...payload,
				command: { ...payload.command, itemIdentity: `${payload.command.itemIdentity}:entity` },
			});
			const entity = yield* restoreUserEntitySave(rawEntity);
			const changes: EventMutationChange[] = [
				...payload.input.events.creates.map((item) => ({
					kind: "create" as const,
					itemIdentity: item.itemIdentity,
					item: {
						...(item.orderAfter ? { orderAfter: item.orderAfter } : {}),
						properties: item.properties,
						occurredAt: item.occurredAt,
						entityId: referencedEntity(item.entity, entity.entityId),
						eventSchemaSlug: EventSchemaSlug.make(item.eventSchemaSlug),
						sessionEntityId: item.session
							? referencedEntity(item.session, entity.entityId)
							: undefined,
					},
				})),
				...payload.input.events.changes,
			];
			if (new Set(changes.map((item) => item.itemIdentity)).size !== changes.length) {
				return yield* new EventBadRequest({
					reason: { code: "mutation-conflict", message: "Command item identities must be unique" },
				});
			}
			const changedIds = changes.flatMap((item) =>
				item.kind === "create" ? [] : [item.kind === "delete" ? item.eventId : item.item.eventId],
			);
			if (new Set(changedIds).size !== changedIds.length) {
				return yield* new EventBadRequest({
					reason: { code: "mutation-conflict", message: "Command repeats an existing event" },
				});
			}
			const preparedRelations: SerializedUserRelationshipCreate[] = [];
			for (const [index, relationship] of payload.input.relationships.entries()) {
				const prepared = yield* UserRelationshipPreparationWorkflow.execute({
					relationship,
					entity: rawEntity,
					userId: payload.userId,
					command: {
						...payload.command,
						itemIdentity: `${payload.command.itemIdentity}:relationship:${index}`,
					},
				});
				if (prepared) {
					preparedRelations.push(prepared);
				}
			}
			const preparedBatches: Array<{
				command: DomainLifecycleCommand;
				prepared: PreparedEventChanges;
				validated: PolicyBatchResult;
			}> = [];
			for (let offset = 0; offset < changes.length; offset += 50) {
				const command = {
					...payload.command,
					itemIdentity: `${payload.command.itemIdentity}:events:${offset}`,
				};
				const prepared = yield* makeActivity({
					error: Failure,
					success: PreparedEventChanges,
					name: `prepare-events-${offset}`,
					execute: session
						.transaction(
							events.prepare({
								command,
								userId: payload.userId,
								positionOffset: offset,
								changes: changes.slice(offset, offset + 50),
								proposedEntities: { [entity.entityId]: rawEntity.mutation.draft },
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				});
				const validated = yield* PolicyBatchWorkflow.execute({
					command,
					resource: "event",
					userId: payload.userId,
					references: prepared.references,
					items: yield* eventPolicyItems(prepared),
				}).pipe(
					Effect.catchTag(
						"PolicyBatchBlocked",
						() =>
							new EventBadRequest({
								reason: { code: "automation-limit", message: "Command exceeds automation limits" },
							}),
					),
				);
				if (validated.items.some((item) => item.rejected !== null)) {
					return yield* new EventBadRequest({
						reason: { code: "policy-rejected", message: "Command rejected by event policy" },
					});
				}
				const invalid = validated.items.find((item) => item.error !== null);
				if (invalid?.error) {
					return yield* new EventBadRequest({
						reason: {
							message: "Command draft validation failed",
							code:
								invalid.error.code === "reference-not-found"
									? "invalid-policy-transform"
									: invalid.error.code,
						},
					});
				}
				preparedBatches.push({ command, prepared, validated });
			}
			const committed = yield* makeActivity({
				name: "commit",
				error: Failure,
				success: Schema.Struct({
					result: UserCommandResult,
					dispatch: Schema.Array(LifecycleDispatchPlan),
				}),
				execute: session
					.transaction(
						Effect.gen(function* () {
							const replay = yield* receipts
								.lookup(receiptIdentity, UserCommandResult)
								.pipe(
									Effect.catchTag(
										"MutationReceiptIdentityConflict",
										() => new DbError({ message: "Command identity reused with different input" }),
									),
								);
							if (replay) {
								return { result: replay.result, dispatch: replay.dispatch };
							}
							const baselines = payload.input.events.baselines ?? [];
							for (const baseline of baselines) {
								const visible = yield* entityRows.getByIdForUser({
									userId: payload.userId,
									entityId: baseline.entityId,
								});
								if (
									!visible ||
									visible.entitySchemaPluginId !== payload.command.writeContext?.pluginRevision?.id
								) {
									return yield* new EventBadRequest({
										reason: {
											code: "mutation-conflict",
											message: "Event baseline is outside the command scope",
										},
									});
								}
							}
							const references = [
								...new Set([
									entity.entityId,
									...baselines.map((baseline) => baseline.entityId),
									...preparedBatches.flatMap((batch) =>
										Object.keys(batch.validated.references).map((id) => EntityId.make(id)),
									),
									...payload.input.relationships.flatMap((relation) => [
										referencedEntity(relation.source, entity.entityId),
										referencedEntity(relation.target, entity.entityId),
									]),
								]),
							].sort();
							const lockedReferences = yield* entityRows.getMutationEntities(references, true);
							if (payload.input.dataBaseline) {
								const owner = payload.command.writeContext?.pluginRevision;
								if (
									!owner ||
									!(yield* dataRevisions.validate({
										pluginId: owner.id,
										userId: payload.userId,
										...payload.input.dataBaseline,
									}))
								) {
									return yield* new EntityStale({
										reason: { code: "entity-stale", entityId: entity.entityId },
									});
								}
							}
							for (const baseline of baselines) {
								if (!lockedReferences.has(baseline.entityId)) {
									return yield* new EntityStale({
										reason: { code: "entity-stale", entityId: baseline.entityId },
									});
								}
								const owner = payload.command.writeContext?.pluginRevision;
								if (!owner) {
									return yield* new DbError({
										message: "User command requires exact plugin authority",
									});
								}
								const current = yield* eventRows.getScopeRevision({
									userId: payload.userId,
									entityId: baseline.entityId,
									eventSchemaPluginId: owner.id,
								});
								if (baseline.revision !== current) {
									return yield* new EntityStale({
										reason: { code: "entity-stale", entityId: baseline.entityId },
									});
								}
							}
							const expected = payload.input.events.expected;
							if (expected) {
								const owner = payload.command.writeContext?.pluginRevision;
								if (!owner) {
									return yield* new DbError({
										message: "User command requires exact plugin authority",
									});
								}
								const current = yield* eventRows.listSessionEventIds({
									userId: payload.userId,
									eventSchemaPluginId: owner.id,
									sessionEntityId: entity.entityId,
									eventSchemaSlug: expected.eventSchemaSlug,
								});
								if (stableStringify([...expected.eventIds].sort()) !== stableStringify(current)) {
									return yield* new EntityStale({
										reason: { code: "entity-stale", entityId: entity.entityId },
									});
								}
							}
							const saved = yield* entities.persistPreparedUserSave(entity);
							const dispatch = [...saved.dispatch];
							const batch = {
								command: payload.command,
								identity: ["relationships"],
								resource: "relationship" as const,
							};
							yield* planner.prepareBatch({ ...batch, scopes: [payload.userId] });
							for (const [index, relation] of preparedRelations.entries()) {
								const work = yield* relationships.persistPreparedUserCreate(
									yield* restoreUserRelationshipCreate(relation),
									{ ...batch, index },
								);
								dispatch.push(...work.dispatch);
							}
							dispatch.push(...(yield* planner.planBatch(batch)));
							const written = [];
							const eventBatch = {
								identity: ["events"],
								command: payload.command,
								resource: "event" as const,
							};
							yield* planner.prepareBatch({ ...eventBatch, scopes: [payload.userId] });
							let eventOffset = 0;
							for (const prepared of preparedBatches) {
								const work = yield* events.persist({
									userId: payload.userId,
									...prepared,
									sealBatch: false,
									batch: eventBatch,
									batchIndexOffset: eventOffset,
								});
								eventOffset += prepared.prepared.items.length;
								written.push(...work.results);
								dispatch.push(...work.dispatch);
							}
							dispatch.push(...(yield* planner.planBatch(eventBatch)));
							const result = { events: written, entityId: saved.entity.id };
							yield* receipts.insert({ result, dispatch, identity: receiptIdentity });
							return { result, dispatch };
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
			});
			yield* lifecycle
				.dispatch(committed.dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
			return committed.result;
		}),
	),
).pipe(Layer.provide(DataRevisions.layer));
