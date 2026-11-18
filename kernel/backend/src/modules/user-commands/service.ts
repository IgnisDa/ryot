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
import type {
	CommandEntityReference,
	UserCommand,
	UserCommandResult,
} from "@ryot-app/contract/modules/mutations/user-command";
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
import {
	PluginUserSettingsPatchError,
	PluginUserSettingsWriter,
} from "#modules/plugins/preferences/user-settings-writer";
import type { PreparedUserRelationshipCreate } from "#modules/relationships/prepared-mutations";
import { RelationshipsService } from "#modules/relationships/service";
import { isUserBootstrapPrincipal } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";

/** A commit hook found its command already committed, so the commit rolled back. */
export class UserCommandAlreadyCommitted extends Schema.TaggedError<
	UserCommandAlreadyCommitted,
	{ readonly brand: unique symbol }
>()("UserCommandAlreadyCommitted", {}) {}

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
	PluginUserSettingsPatchError,
	UserCommandAlreadyCommitted,
]);

/** Work that joins the commit transaction: `start` runs before any write, `finish` after them all. */
export type UserCommandCommitHook = {
	readonly start: Effect.Effect<void, DbError | UserCommandAlreadyCommitted>;
	readonly finish: (result: UserCommandResult) => Effect.Effect<void, DbError>;
};

const itemCommand = (command: DomainLifecycleCommand, itemIdentity: string) => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
});

const rootRequired = () => new EventBadRequest({ reason: { code: "root-entity-required" } });

const referencedEntity = (reference: typeof CommandEntityReference.Type, rootId?: EntityId) => {
	if (reference.kind === "existing") {
		return Effect.succeed(reference.entityId);
	}
	return rootId === undefined ? Effect.fail(rootRequired()) : Effect.succeed(rootId);
};

export class UserCommands extends Context.Service<UserCommands>()(
	"@ryot-app/kernel-backend/modules/user-commands/service/UserCommands",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesService;
			const entityRows = yield* EntitiesRepository;
			const eventRows = yield* EventsRepository;
			const eventMutations = yield* EventMutations;
			const relationships = yield* RelationshipsService;
			const planner = yield* LifecyclePlanner;
			const lifecycle = yield* LifecycleExecution;
			const settingsWriter = yield* PluginUserSettingsWriter;
			const policyContext = yield* Effect.context<
				DatabaseSession | LifecyclePlanner | EntitiesRepository | LifecycleExecution
			>();
			const commit = Effect.fn("UserCommands.commit")(function* (
				input: UserCommand,
				command: DomainLifecycleCommand,
				userId: UserId,
				hook?: UserCommandCommitHook,
			) {
				const principal = command.writeContext;
				const pluginRevision = principal?.pluginRevision;
				if (!principal || !pluginRevision) {
					return yield* new DbError({ message: "User command requires exact plugin authority" });
				}
				const subject = principal.subject;
				const settings = input.settings;
				if (
					settings !== undefined &&
					(subject.type !== "user" ||
						subject.userId !== userId ||
						subject.integrationId !== undefined ||
						principal.initialization !== undefined ||
						isUserBootstrapPrincipal(principal))
				) {
					return yield* new PluginUserSettingsPatchError({
						message:
							"Plugin user settings cannot be written by integration, import, or bootstrap executions",
					});
				}
				const owner = definitionOwner(pluginRevision.id);
				const events: NonNullable<UserCommand["events"]> = input.events ?? {
					creates: [],
					changes: [],
				};
				const relationshipInputs = input.relationships ?? [];
				if (input.entity === undefined && events.expected !== undefined) {
					return yield* rootRequired();
				}
				const entity =
					input.entity === undefined
						? undefined
						: yield* entities.prepareUserSave({
								userId,
								name: input.entity.name,
								target: input.entity.target,
								properties: input.entity.properties,
								lifecycle: itemCommand(command, input.entity.itemIdentity ?? "entity"),
								entitySchema: { owner, slug: EntitySchemaSlug.make(input.entity.entitySchemaSlug) },
							});
				const rootId = entity?.entityId;
				const creates = yield* Effect.forEach(events.creates, (item) =>
					Effect.gen(function* () {
						return {
							kind: "create" as const,
							itemIdentity: item.itemIdentity,
							item: {
								...(item.orderAfter ? { orderAfter: item.orderAfter } : {}),
								properties: item.properties,
								occurredAt: item.occurredAt,
								entityId: yield* referencedEntity(item.entity, rootId),
								eventSchemaSlug: EventSchemaSlug.make(item.eventSchemaSlug),
								sessionEntityId: item.session
									? yield* referencedEntity(item.session, rootId)
									: undefined,
							},
						};
					}),
				);
				const changes: EventMutationChange[] = [...creates, ...events.changes];
				if (new Set(changes.map((item) => item.itemIdentity)).size !== changes.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const changedIds = changes.flatMap((item) =>
					item.kind === "create" ? [] : [item.kind === "delete" ? item.eventId : item.item.eventId],
				);
				if (new Set(changedIds).size !== changedIds.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const preparedRelations: PreparedUserRelationshipCreate[] = [];
				const relationEndpoints: EntityId[] = [];
				for (const [index, relation] of relationshipInputs.entries()) {
					const sourceEntityId = yield* referencedEntity(relation.source, rootId);
					const targetEntityId = yield* referencedEntity(relation.target, rootId);
					relationEndpoints.push(sourceEntityId, targetEntityId);
					const prepared = yield* relationships.prepareUserCreate(
						{
							userId,
							scope: "user",
							sourceEntityId,
							targetEntityId,
							properties: relation.properties,
							relationshipSchema: {
								owner,
								slug: RelationshipSchemaSlug.make(relation.relationshipSchemaSlug),
							},
						},
						itemCommand(command, relation.itemIdentity ?? `relationship:${index}`),
						entity?.created ?? undefined,
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
							eventMutations.prepare({
								userId,
								command,
								positionOffset: offset,
								changes: changes.slice(offset, offset + 50),
								proposedEntities:
									entity === undefined ? {} : { [entity.entityId]: userEntitySaveDraft(entity) },
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
							() => new EventBadRequest({ reason: { code: "automation-limit" } }),
						),
					);
					const rejection = validated.items.find((item) => item.rejected !== null)?.rejected;
					if (rejection) {
						return yield* new EventBadRequest({
							reason: { message: rejection, code: "policy-rejected" },
						});
					}
					const invalid = validated.items.find((item) => item.error !== null);
					if (invalid?.error) {
						return yield* new EventBadRequest({
							reason: {
								code:
									invalid.error.code === "reference-not-found"
										? "invalid-policy-transform"
										: invalid.error.code,
							},
						});
					}
					preparedBatches.push({ prepared, validated, command: batchCommand });
				}
				const sourceWrites = reuseLockedWriteChecks(
					Effect.gen(function* () {
						const baselines = events.baselines ?? [];
						for (const baseline of baselines) {
							const visible = yield* entityRows.getByIdForUser({
								userId,
								entityId: baseline.entityId,
							});
							if (
								!visible ||
								visible.entitySchemaPluginId !== command.writeContext?.pluginRevision?.id
							) {
								return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
							}
						}
						const references = [
							...new Set([
								...(rootId === undefined ? [] : [rootId]),
								...baselines.map((baseline) => baseline.entityId),
								...preparedBatches.flatMap((batch) =>
									Object.keys(batch.validated.references).map((id) => EntityId.make(id)),
								),
								...relationEndpoints,
							]),
						].sort();
						const lockedEntityIds = yield* eventMutations.captureGroups({
							userId,
							entityIds: references,
							batches: preparedBatches,
						});
						const lockedReferences = yield* entityRows.getMutationEntities(lockedEntityIds, true);
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
						const expected = events.expected;
						if (expected && rootId !== undefined) {
							const current = yield* eventRows.listSessionEventIds({
								userId,
								sessionEntityId: rootId,
								eventSchemaPluginId: pluginRevision.id,
								eventSchemaSlug: expected.eventSchemaSlug,
							});
							if (stableStringify([...expected.eventIds].sort()) !== stableStringify(current)) {
								return yield* new EntityStale({
									reason: { entityId: rootId, code: "entity-stale" },
								});
							}
						}
						const saved =
							entity === undefined ? undefined : yield* entities.persistPreparedUserSave(entity);
						yield* eventMutations.lockPreparedChanges({ userId, batches: preparedBatches });
						const dispatch = [...(saved?.dispatch ?? [])];
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
							const work = yield* eventMutations
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
						const result: UserCommandResult = {
							events: written,
							...(saved === undefined ? {} : { entityId: saved.entity.id }),
						};
						return { result, dispatch };
					}),
				);
				const committed = yield* eventMutations
					.transaction(
						Effect.gen(function* () {
							if (hook) {
								yield* hook.start;
							}
							if (settings !== undefined && subject.type === "user") {
								yield* settingsWriter.patchWithin({
									userId,
									values: settings,
									pluginId: pluginRevision.id,
									accountUserId: subject.userId,
									pluginRevisionId: pluginRevision.revisionId,
								});
							}
							const written = yield* sourceWrites;
							if (hook) {
								yield* hook.finish(written.result);
							}
							return written;
						}),
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
