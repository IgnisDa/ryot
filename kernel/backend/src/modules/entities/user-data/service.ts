import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type MergeEntityUserDataBody,
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, type EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	type LifecyclePersistenceError,
} from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteConflict, type DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventMoveReferences,
} from "#modules/events/service";
import {
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	MutationReceipts,
} from "#modules/mutations/receipts";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";
import { trimToNull } from "#platform/validation";

const itemCommand = (
	command: DomainLifecycleCommand,
	identity: string,
): DomainLifecycleCommand => ({ ...command, itemIdentity: `${command.itemIdentity}:${identity}` });

const lifecyclePersistenceFailure = (error: LifecyclePersistenceError) =>
	new DbError({ message: `User-state lifecycle persistence failed: ${error.code}` });
const relationshipFailure =
	(operation: "clear" | "merge") => (error: RelationshipBadRequest | RelationshipNotFound) =>
		Effect.logWarning(`relationship ${operation} failed`, error).pipe(
			Effect.andThen(
				new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }),
			),
		);

type MergeAuthority = { readonly entitySchemaSlug: EntitySchemaSlug };

export class EntityUserDataService extends Context.Service<EntityUserDataService>()(
	"EntityUserDataService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				database.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const planner = yield* LifecyclePlanner;
			const receipts = yield* MutationReceipts;
			const ClearResult = Schema.Struct({
				entityId: EntityId,
				deletedEventsCount: Schema.Finite,
				deletedRelationshipsCount: Schema.Finite,
			});
			const MergeResult = Schema.Struct({
				mergeFrom: EntityId,
				mergeInto: EntityId,
				movedEventsCount: Schema.Finite,
				movedRelationshipsCount: Schema.Finite,
			});
			const lookup = <Result>(
				identity: ReturnType<typeof mutationReceiptIdentity>,
				result: Schema.Codec<Result, unknown>,
				lock = true,
			) =>
				(lock ? receipts.lookup(identity, result) : receipts.peek(identity, result)).pipe(
					Effect.mapError((error) =>
						error instanceof MutationReceiptIdentityConflict
							? new EntityUserDataBadRequest({ reason: { code: "command-identity-conflict" } })
							: error,
					),
				);
			const lifecycleExecution = yield* LifecycleExecution;
			const eventsRepository = yield* EventsRepository;
			const events = yield* EventsService;
			const relationships = yield* RelationshipsService;
			const definitions = yield* DefinitionRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			type RelationshipRow = Effect.Success<
				ReturnType<typeof relationshipsRepository.listUserRelationshipsForEntityWithProvenance>
			>[number];
			const withBatches = Effect.fnUntraced(function* (
				command: DomainLifecycleCommand,
				eventDispatch: ReadonlyArray<LifecycleDispatchPlan>,
				relationshipDispatch: ReadonlyArray<LifecycleDispatchPlan>,
			) {
				return [
					...eventDispatch,
					...relationshipDispatch,
					...(yield* planner.planBatch({ command, resource: "event", identity: ["events"] })),
					...(yield* planner.planBatch({
						command,
						resource: "relationship",
						identity: ["relationships"],
					})),
				];
			});

			const prepareRelationshipMove = Effect.fnUntraced(function* (input: {
				relationship: RelationshipRow;
				mergeFrom: EntityId;
				mergeInto: EntityId;
				userId: CurrentUserValue["id"];
				command: DomainLifecycleCommand;
			}) {
				const { userId, command, mergeFrom, mergeInto, relationship } = input;
				const sourceEntityId =
					relationship.sourceEntityId === mergeFrom ? mergeInto : relationship.sourceEntityId;
				const targetEntityId =
					relationship.targetEntityId === mergeFrom ? mergeInto : relationship.targetEntityId;
				let create: PreparedUserRelationshipCreate | null = null;
				if (sourceEntityId !== targetEntityId) {
					create = yield* relationships
						.prepareUserCreate(
							{
								userId,
								scope: "user",
								sourceEntityId,
								targetEntityId,
								properties: relationship.properties,
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:create`),
						)
						.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("merge") }));
				}

				const deletion = yield* relationships
					.prepareUserDelete(
						{
							userId,
							scope: "user",
							sourceEntityId: relationship.sourceEntityId,
							targetEntityId: relationship.targetEntityId,
							relationshipSchema: {
								slug: relationship.relationshipSchemaSlug,
								owner: definitionOwner(relationship.relationshipSchemaPluginId),
							},
						},
						itemCommand(command, `relationship:${relationship.id}:delete`),
					)
					.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("merge") }));
				return { create, deletion };
			});

			const clearEntityUserData = Effect.fn("EntityUserDataService.clearEntityUserData")(function* (
				user: CurrentUserValue,
				entityIdInput: EntityId,
				command: DomainLifecycleCommand,
			) {
				const trimmedEntityId = trimToNull(entityIdInput);
				if (!trimmedEntityId) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "entityId", code: "required-field" },
					});
				}

				const entityId = EntityId.make(trimmedEntityId);
				const identity = mutationReceiptIdentity({
					command,
					input: { entityId },
					ownerUserId: user.id,
					scopeUserId: user.id,
					commandKind: "entity-user-data:clear",
				});
				const replay = yield* lookup(identity, ClearResult, false);
				if (replay) {
					return {
						...replay.result,
						warnings: yield* lifecycleExecution.dispatch(replay.dispatch),
					};
				}
				const scope = yield* entitiesRepository.getEntityScopeForUser({
					entityId,
					userId: user.id,
				});
				if (!scope) {
					return yield* new EntityUserDataNotFound({
						reason: { entityIds: [entityId], code: "entity-not-found" },
					});
				}

				const entitySchemaReference = {
					slug: scope.entitySchemaSlug,
					owner: definitionOwner(scope.entitySchemaPluginId),
				};
				const entitySchema = (yield* definitions
					.findUserEntitySchemas(user.id, [entitySchemaReference])
					.pipe(Effect.orDie))[
					definitionKey("entity", entitySchemaReference.owner, entitySchemaReference.slug)
				];
				if (entitySchema?.userState?.deniedOperations.includes("clear")) {
					return yield* new EntityUserDataBadRequest({
						reason: { operation: "clear", code: "operation-denied" },
					});
				}

				const eventIds = yield* eventsRepository.listUserEventIdsForEntity({
					entityId,
					userId: user.id,
				});
				const preparedEvents: PreparedEventDelete[] = [];
				for (const eventId of eventIds) {
					const prepared = yield* events.prepareDelete(
						{ eventId, userId: user.id },
						itemCommand(command, `event:${eventId}:delete`),
					);
					if (prepared) {
						preparedEvents.push(prepared);
					}
				}
				const relationshipRows =
					yield* relationshipsRepository.listUserRelationshipsForEntityWithProvenance({
						entityId,
						userId: user.id,
					});
				const preparedRelationships: PreparedUserRelationshipDelete[] = [];
				for (const relationship of relationshipRows) {
					const prepared = yield* relationships
						.prepareUserDelete(
							{
								scope: "user",
								userId: user.id,
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:delete`),
						)
						.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("clear") }));
					if (prepared) {
						preparedRelationships.push(prepared);
					}
				}

				const committed = yield* transaction(
					Effect.gen(function* () {
						const prior = yield* lookup(identity, ClearResult);
						if (prior) {
							return { result: prior.result, dispatch: prior.dispatch };
						}
						yield* planner.prepareBatch({
							command,
							resource: "event",
							scopes: [user.id],
							identity: ["events"],
						});
						yield* planner.prepareBatch({
							command,
							scopes: [user.id],
							resource: "relationship",
							identity: ["relationships"],
						});
						const eventDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedEvents.entries()) {
							eventDispatch.push(
								...(yield* events.persistPreparedDelete(prepared, {
									index,
									command,
									identity: ["events"],
								})).dispatch,
							);
						}
						const relationshipDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedRelationships.entries()) {
							const work = yield* relationships
								.persistPreparedUserDelete(prepared, {
									index,
									command,
									identity: ["relationships"],
								})
								.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("clear")));
							relationshipDispatch.push(...work.dispatch);
						}
						const dispatch = yield* withBatches(command, eventDispatch, relationshipDispatch);
						const result = {
							entityId,
							deletedEventsCount: preparedEvents.length,
							deletedRelationshipsCount: preparedRelationships.length,
						};
						yield* receipts.insert({ result, identity, dispatch });
						return { result, dispatch };
					}),
				);
				const warnings = yield* lifecycleExecution.dispatch(committed.dispatch);
				return { ...committed.result, warnings };
			});

			const mergeEntityUserData = Effect.fn("EntityUserDataService.mergeEntityUserData")(function* (
				userId: UserId,
				payload: MergeEntityUserDataBody,
				command: DomainLifecycleCommand,
				authority?: MergeAuthority,
			) {
				const trimmedMergeFrom = trimToNull(payload.mergeFrom);
				const trimmedMergeInto = trimToNull(payload.mergeInto);

				if (!trimmedMergeFrom) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "mergeFrom", code: "required-field" },
					});
				}
				if (!trimmedMergeInto) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "mergeInto", code: "required-field" },
					});
				}
				if (trimmedMergeFrom === trimmedMergeInto) {
					return yield* new EntityUserDataBadRequest({ reason: { code: "same-entity-merge" } });
				}

				const mergeFrom = EntityId.make(trimmedMergeFrom);
				const mergeInto = EntityId.make(trimmedMergeInto);
				const identity = mutationReceiptIdentity({
					command,
					ownerUserId: userId,
					scopeUserId: userId,
					input: { mergeFrom, mergeInto },
					commandKind: "entity-user-data:merge",
				});
				const replay = yield* lookup(identity, MergeResult, false);
				if (replay) {
					return {
						...replay.result,
						warnings: yield* lifecycleExecution.dispatch(replay.dispatch),
					};
				}

				const [fromScope, intoScope] = yield* Effect.all([
					entitiesRepository.getEntityMergeScopeForUser({ userId: userId, entityId: mergeFrom }),
					entitiesRepository.getEntityMergeScopeForUser({ userId: userId, entityId: mergeInto }),
				]);
				if (!fromScope || !intoScope) {
					return yield* new EntityUserDataNotFound({
						reason: { code: "entity-not-found", entityIds: [mergeFrom, mergeInto] },
					});
				}
				if (authority) {
					const plugin = command.writeContext?.pluginRevision;
					if (!plugin) {
						return yield* new DbError({ message: "Entity merge requires a pinned plugin" });
					}
					if (
						fromScope.entitySchemaSlug !== authority.entitySchemaSlug ||
						intoScope.entitySchemaSlug !== authority.entitySchemaSlug
					) {
						return yield* new EntityUserDataBadRequest({
							reason: { code: "entity-schema-mismatch" },
						});
					}
					for (const scope of [fromScope, intoScope]) {
						if (scope.entitySchemaPluginId !== plugin.id) {
							return yield* new DomainWriteConflict({
								message: "Entity merge belongs to another definition owner",
								reason: {
									code: "owner-mismatch",
									expected: definitionOwner(plugin.id),
									actual: definitionOwner(scope.entitySchemaPluginId),
								},
							});
						}
					}
					if (fromScope.entityUserId !== userId) {
						return yield* new DomainWriteConflict({
							reason: { code: "global-scope-forbidden" },
							message: "Entity merge requires a user-owned source",
						});
					}
				}
				const fromEntitySchemaReference = {
					slug: fromScope.entitySchemaSlug,
					owner: definitionOwner(fromScope.entitySchemaPluginId),
				};
				const intoEntitySchemaReference = {
					slug: intoScope.entitySchemaSlug,
					owner: definitionOwner(intoScope.entitySchemaPluginId),
				};
				const entitySchemas = yield* definitions
					.findUserEntitySchemas(userId, [fromEntitySchemaReference, intoEntitySchemaReference])
					.pipe(Effect.orDie);
				const fromEntitySchema =
					entitySchemas[
						definitionKey("entity", fromEntitySchemaReference.owner, fromEntitySchemaReference.slug)
					];
				const intoEntitySchema =
					entitySchemas[
						definitionKey("entity", intoEntitySchemaReference.owner, intoEntitySchemaReference.slug)
					];
				if (
					fromEntitySchema?.userState?.deniedOperations.includes("merge") ||
					intoEntitySchema?.userState?.deniedOperations.includes("merge")
				) {
					return yield* new EntityUserDataBadRequest({
						reason: { operation: "merge", code: "operation-denied" },
					});
				}
				if (
					fromScope.entitySchemaSlug !== intoScope.entitySchemaSlug ||
					fromScope.entitySchemaPluginId !== intoScope.entitySchemaPluginId
				) {
					return yield* new EntityUserDataBadRequest({
						reason: { code: "entity-schema-mismatch" },
					});
				}
				if (!fromEntitySchema) {
					return yield* Effect.die("Entity schema not found during entity merge");
				}
				for (const property of fromEntitySchema.mergeIdentityProperties) {
					if (!Bun.deepEquals(fromScope.properties[property], intoScope.properties[property])) {
						return yield* new EntityUserDataBadRequest({
							reason: { property, code: "identity-property-mismatch" },
						});
					}
				}
				const eventIds = yield* eventsRepository.listUserEventIdsForEntity({
					userId: userId,
					entityId: mergeFrom,
				});
				const preparedEvents: PreparedEventMoveReferences[] = [];
				for (const eventId of eventIds) {
					const prepared = yield* events.prepareMoveReferences(
						{ eventId, mergeFrom, mergeInto, userId: userId },
						itemCommand(command, `event:${eventId}:update`),
					);
					if (prepared) {
						preparedEvents.push(prepared);
					}
				}
				const relationshipRows =
					yield* relationshipsRepository.listUserRelationshipsForEntityWithProvenance({
						userId: userId,
						entityId: mergeFrom,
					});
				const preparedRelationships: Array<{
					create: PreparedUserRelationshipCreate | null;
					deletion: PreparedUserRelationshipDelete | null;
				}> = [];
				for (const relationship of relationshipRows) {
					preparedRelationships.push(
						yield* prepareRelationshipMove({
							command,
							mergeFrom,
							mergeInto,
							relationship,
							userId: userId,
						}),
					);
				}

				const committed = yield* transaction(
					Effect.gen(function* () {
						const prior = yield* lookup(identity, MergeResult);
						if (prior) {
							return { result: prior.result, dispatch: prior.dispatch };
						}
						yield* planner.prepareBatch({
							command,
							scopes: [userId],
							resource: "event",
							identity: ["events"],
						});
						yield* planner.prepareBatch({
							command,
							scopes: [userId],
							resource: "relationship",
							identity: ["relationships"],
						});
						const eventDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedEvents.entries()) {
							eventDispatch.push(
								...(yield* events.persistPreparedMoveReferences(prepared, {
									index,
									command,
									identity: ["events"],
								})).dispatch,
							);
						}
						const relationshipDispatch: LifecycleDispatchPlan[] = [];
						let movedRelationshipsCount = 0;
						let relationshipIndex = 0;
						for (const prepared of preparedRelationships) {
							if (prepared.create) {
								const work = yield* relationships
									.persistPreparedUserCreate(prepared.create, {
										command,
										index: relationshipIndex++,
										identity: ["relationships"],
									})
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipDispatch.push(...work.dispatch);
							}
							if (prepared.deletion) {
								const work = yield* relationships
									.persistPreparedUserDelete(prepared.deletion, {
										command,
										index: relationshipIndex++,
										identity: ["relationships"],
									})
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipDispatch.push(...work.dispatch);
								movedRelationshipsCount += 1;
							}
						}

						const dispatch = yield* withBatches(command, eventDispatch, relationshipDispatch);
						const result = {
							mergeFrom,
							mergeInto,
							movedRelationshipsCount,
							movedEventsCount: preparedEvents.length,
						};
						yield* receipts.insert({ result, identity, dispatch });
						return { result, dispatch };
					}),
				);
				const warnings = yield* lifecycleExecution.dispatch(committed.dispatch);
				return { ...committed.result, warnings };
			});

			return {
				clearEntityUserData: (
					user: CurrentUserValue,
					entityId: EntityId,
					command: LifecycleCommand,
				) =>
					clearEntityUserData(user, entityId, { ...command, writeContext: null }).pipe(
						Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
					),
				mergeEntityUserData: (
					user: CurrentUserValue,
					payload: MergeEntityUserDataBody,
					command: LifecycleCommand,
				) =>
					mergeEntityUserData(user.id, payload, { ...command, writeContext: null }).pipe(
						Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
					),
				mergeEntityUserDataForCommand: (
					userId: UserId,
					payload: MergeEntityUserDataBody & MergeAuthority,
					command: DomainLifecycleCommand,
				) =>
					mergeEntityUserData(
						userId,
						{ mergeFrom: payload.mergeFrom, mergeInto: payload.mergeInto },
						command,
						{ entitySchemaSlug: payload.entitySchemaSlug },
					).pipe(Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
