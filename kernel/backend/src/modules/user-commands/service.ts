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
import type { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
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
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import {
	type PolicyBatchResult,
	runPolicyBatch,
} from "#modules/automations/lifecycle/policy-batch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService, userEntitySaveDraft } from "#modules/entities/service";
import {
	type DomainLifecycleCommand,
	reuseLockedWriteChecks,
} from "#modules/entities/write-context";
import { eventReferenceBadRequest } from "#modules/events/event-references";
import {
	EventMutations,
	eventPolicyItems,
	type PreparedEventChanges,
} from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import type { PreparedUserRelationshipCreate } from "#modules/relationships/prepared-mutations";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";

export const UserCommandFailure = Schema.Union([
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

const itemCommand = (command: DomainLifecycleCommand, itemIdentity: string) => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
});

const referencedEntity = (
	reference: typeof UserCommand.fields.relationships.value.Type.source,
	rootId: EntityId,
) => (reference.kind === "root" ? rootId : reference.entityId);

export class UserCommands extends Context.Service<UserCommands>()(
	"@ryot-app/kernel-backend/modules/user-commands/service/UserCommands",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesService;
			const entityRows = yield* EntitiesRepository;
			const eventRows = yield* EventsRepository;
			const events = yield* EventMutations;
			const relationships = yield* RelationshipsService;
			const planner = yield* LifecyclePlanner;
			const lifecycle = yield* LifecycleExecution;
			const policyContext = yield* Effect.context<
				DatabaseSession | LifecyclePlanner | EntitiesRepository | LifecycleExecution
			>();
			const commit = Effect.fn("UserCommands.commit")(function* (
				input: UserCommand,
				command: DomainLifecycleCommand,
				userId: UserId,
			) {
				const pluginRevision = command.writeContext?.pluginRevision;
				if (!pluginRevision) {
					return yield* new DbError({ message: "User command requires exact plugin authority" });
				}
				const owner = definitionOwner(pluginRevision.id);
				const entity = yield* entities.prepareUserSave({
					userId,
					name: input.entity.name,
					target: input.entity.target,
					properties: input.entity.properties,
					lifecycle: itemCommand(command, input.entity.itemIdentity ?? "entity"),
					entitySchema: { owner, slug: EntitySchemaSlug.make(input.entity.entitySchemaSlug) },
				});
				const changes: EventMutationChange[] = [
					...input.events.creates.map((item) => ({
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
					...input.events.changes,
				];
				if (new Set(changes.map((item) => item.itemIdentity)).size !== changes.length) {
					return yield* new EventBadRequest({
						reason: {
							code: "mutation-conflict",
							message: "Command item identities must be unique",
						},
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
				const preparedRelations: PreparedUserRelationshipCreate[] = [];
				for (const [index, relation] of input.relationships.entries()) {
					const prepared = yield* relationships.prepareUserCreate(
						{
							userId,
							scope: "user",
							properties: relation.properties,
							sourceEntityId: referencedEntity(relation.source, entity.entityId),
							targetEntityId: referencedEntity(relation.target, entity.entityId),
							relationshipSchema: {
								owner,
								slug: RelationshipSchemaSlug.make(relation.relationshipSchemaSlug),
							},
						},
						itemCommand(command, relation.itemIdentity ?? `relationship:${index}`),
						entity.created ?? undefined,
						relation.propertiesMode,
					);
					if (prepared) {
						preparedRelations.push(prepared);
					}
				}
				const preparedBatches: Array<{
					validated: PolicyBatchResult;
					prepared: PreparedEventChanges;
					command: DomainLifecycleCommand;
				}> = [];
				for (let offset = 0; offset < changes.length; offset += 50) {
					const batchCommand = itemCommand(command, `events:${offset}`);
					const prepared = yield* session
						.transaction(
							events.prepare({
								userId,
								command,
								positionOffset: offset,
								changes: changes.slice(offset, offset + 50),
								proposedEntities: { [entity.entityId]: userEntitySaveDraft(entity) },
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					const validated = yield* runPolicyBatch({
						userId,
						resource: "event",
						command: batchCommand,
						references: prepared.references,
						items: yield* eventPolicyItems(prepared),
						propertiesSchemas: prepared.propertiesSchemas,
					}).pipe(
						Effect.provideContext(policyContext),
						Effect.catchTag(
							"PolicyBatchBlocked",
							() =>
								new EventBadRequest({
									reason: {
										code: "automation-limit",
										message: "Command exceeds automation limits",
									},
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
					preparedBatches.push({ prepared, validated, command: batchCommand });
				}
				const committed = yield* events
					.transaction(
						reuseLockedWriteChecks(
							Effect.gen(function* () {
								const baselines = input.events.baselines ?? [];
								for (const baseline of baselines) {
									const visible = yield* entityRows.getByIdForUser({
										userId,
										entityId: baseline.entityId,
									});
									if (
										!visible ||
										visible.entitySchemaPluginId !== command.writeContext?.pluginRevision?.id
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
										...input.relationships.flatMap((relation) => [
											referencedEntity(relation.source, entity.entityId),
											referencedEntity(relation.target, entity.entityId),
										]),
									]),
								].sort();
								const lockedEntityIds = yield* events.captureGroups({
									userId,
									entityIds: references,
									batches: preparedBatches,
								});
								const lockedReferences = yield* entityRows.getMutationEntities(
									lockedEntityIds,
									true,
								);
								for (const baseline of baselines) {
									if (!lockedReferences.has(baseline.entityId)) {
										return yield* new EntityStale({
											reason: { code: "entity-stale", entityId: baseline.entityId },
										});
									}
									const current = yield* eventRows.getScopeRevision({
										userId,
										entityId: baseline.entityId,
										eventSchemaPluginId: pluginRevision.id,
									});
									if (baseline.revision !== current) {
										return yield* new EntityStale({
											reason: { code: "entity-stale", entityId: baseline.entityId },
										});
									}
								}
								const expected = input.events.expected;
								if (expected) {
									const current = yield* eventRows.listSessionEventIds({
										userId,
										sessionEntityId: entity.entityId,
										eventSchemaPluginId: pluginRevision.id,
										eventSchemaSlug: expected.eventSchemaSlug,
									});
									if (stableStringify([...expected.eventIds].sort()) !== stableStringify(current)) {
										return yield* new EntityStale({
											reason: { code: "entity-stale", entityId: entity.entityId },
										});
									}
								}
								const saved = yield* entities.persistPreparedUserSave(entity);
								yield* events.lockPreparedChanges({ userId, batches: preparedBatches });
								const dispatch = [...saved.dispatch];
								if (preparedRelations.length > 0) {
									const batch = {
										command,
										identity: ["relationships"],
										resource: "relationship" as const,
									};
									yield* planner.prepareBatch({ ...batch, scopes: [userId] });
									for (const [index, relation] of preparedRelations.entries()) {
										const work = yield* relationships.persistPreparedUserCreate(relation, {
											...batch,
											index,
										});
										dispatch.push(...work.dispatch);
									}
									dispatch.push(...(yield* planner.planBatch(batch)));
								}
								const written = [];
								const eventBatch = { command, identity: ["events"], resource: "event" as const };
								yield* planner.prepareBatch({ ...eventBatch, scopes: [userId] });
								let eventOffset = 0;
								for (const prepared of preparedBatches) {
									const work = yield* events
										.persist({
											userId,
											...prepared,
											sealBatch: false,
											batch: eventBatch,
											batchIndexOffset: eventOffset,
										})
										.pipe(Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest));
									eventOffset += prepared.prepared.items.length;
									written.push(...work.results);
									dispatch.push(...work.dispatch);
								}
								dispatch.push(...(yield* planner.planBatch(eventBatch)));
								const result = { events: written, entityId: saved.entity.id };
								return { result, dispatch };
							}),
						),
					)
					.pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							LifecyclePersistenceError: Effect.die,
						}),
					);
				yield* lifecycle
					.dispatch(committed.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return committed.result;
			});
			return { commit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
