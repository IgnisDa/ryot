import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	type MergeUserStateBody,
	UserStateBadRequest,
	UserStateNotFound,
} from "@ryot-app/contract/modules/user-state/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	type LifecyclePersistenceError,
} from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventUpdate,
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

const itemCommand = (command: LifecycleCommand, identity: string): LifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${identity}`,
});

const lifecyclePersistenceFailure = (error: LifecyclePersistenceError) =>
	new DbError({ message: `User-state lifecycle persistence failed: ${error.code}` });
const relationshipFailure =
	(operation: "clear" | "merge") => (error: RelationshipBadRequest | RelationshipNotFound) =>
		Effect.logWarning(`relationship ${operation} failed`, error).pipe(
			Effect.andThen(new UserStateBadRequest({ reason: { code: "relationship-merge-failed" } })),
		);

export class UserStateService extends Context.Service<UserStateService>()("UserStateService", {
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
						? new UserStateBadRequest({ reason: { code: "command-identity-conflict" } })
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
			command: LifecycleCommand,
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
			command: LifecycleCommand;
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
							relationshipSchemaSlug: relationship.relationshipSchemaSlug,
							relationshipSchemaPluginId: relationship.relationshipSchemaPluginId,
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
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						relationshipSchemaPluginId: relationship.relationshipSchemaPluginId,
					},
					itemCommand(command, `relationship:${relationship.id}:delete`),
				)
				.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("merge") }));
			return { create, deletion };
		});

		const clearUserState = Effect.fn("UserStateService.clearUserState")(function* (
			user: CurrentUserValue,
			entityIdInput: EntityId,
			command: LifecycleCommand,
		) {
			const trimmedEntityId = trimToNull(entityIdInput);
			if (!trimmedEntityId) {
				return yield* new UserStateBadRequest({
					reason: { field: "entityId", code: "required-field" },
				});
			}

			const entityId = EntityId.make(trimmedEntityId);
			const identity = mutationReceiptIdentity({
				command,
				input: { entityId },
				ownerUserId: user.id,
				scopeUserId: user.id,
				commandKind: "user-state:clear",
			});
			const replay = yield* lookup(identity, ClearResult, false);
			if (replay) {
				return { ...replay.result, warnings: yield* lifecycleExecution.dispatch(replay.dispatch) };
			}
			const scope = yield* entitiesRepository.getEntityScopeForUser({ entityId, userId: user.id });
			if (!scope) {
				return yield* new UserStateNotFound({
					reason: { entityIds: [entityId], code: "entity-not-found" },
				});
			}

			const entitySchema = (yield* definitions
				.findUserEntitySchemas(user.id, [scope.entitySchemaSlug])
				.pipe(Effect.orDie))[scope.entitySchemaSlug];
			if (entitySchema?.userState?.deniedOperations.includes("clear")) {
				return yield* new UserStateBadRequest({
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
							relationshipSchemaSlug: relationship.relationshipSchemaSlug,
							relationshipSchemaPluginId: relationship.relationshipSchemaPluginId,
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
							.persistPreparedUserDelete(prepared, { index, command, identity: ["relationships"] })
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

		const mergeUserState = Effect.fn("UserStateService.mergeUserState")(function* (
			user: CurrentUserValue,
			payload: MergeUserStateBody,
			command: LifecycleCommand,
		) {
			const trimmedMergeFrom = trimToNull(payload.mergeFrom);
			const trimmedMergeInto = trimToNull(payload.mergeInto);

			if (!trimmedMergeFrom) {
				return yield* new UserStateBadRequest({
					reason: { field: "mergeFrom", code: "required-field" },
				});
			}
			if (!trimmedMergeInto) {
				return yield* new UserStateBadRequest({
					reason: { field: "mergeInto", code: "required-field" },
				});
			}
			if (trimmedMergeFrom === trimmedMergeInto) {
				return yield* new UserStateBadRequest({ reason: { code: "same-entity-merge" } });
			}

			const mergeFrom = EntityId.make(trimmedMergeFrom);
			const mergeInto = EntityId.make(trimmedMergeInto);
			const identity = mutationReceiptIdentity({
				command,
				ownerUserId: user.id,
				scopeUserId: user.id,
				commandKind: "user-state:merge",
				input: { mergeFrom, mergeInto },
			});
			const replay = yield* lookup(identity, MergeResult, false);
			if (replay) {
				return { ...replay.result, warnings: yield* lifecycleExecution.dispatch(replay.dispatch) };
			}

			const [fromScope, intoScope] = yield* Effect.all([
				entitiesRepository.getEntityMergeScopeForUser({ userId: user.id, entityId: mergeFrom }),
				entitiesRepository.getEntityMergeScopeForUser({ userId: user.id, entityId: mergeInto }),
			]);
			if (!fromScope || !intoScope) {
				return yield* new UserStateNotFound({
					reason: { code: "entity-not-found", entityIds: [mergeFrom, mergeInto] },
				});
			}
			const entitySchemas = yield* definitions
				.findUserEntitySchemas(user.id, [fromScope.entitySchemaSlug, intoScope.entitySchemaSlug])
				.pipe(Effect.orDie);
			const fromEntitySchema = entitySchemas[fromScope.entitySchemaSlug];
			const intoEntitySchema = entitySchemas[intoScope.entitySchemaSlug];
			if (
				fromEntitySchema?.userState?.deniedOperations.includes("merge") ||
				intoEntitySchema?.userState?.deniedOperations.includes("merge")
			) {
				return yield* new UserStateBadRequest({
					reason: { operation: "merge", code: "operation-denied" },
				});
			}
			if (fromScope.entitySchemaSlug !== intoScope.entitySchemaSlug) {
				return yield* new UserStateBadRequest({ reason: { code: "entity-schema-mismatch" } });
			}
			if (!fromEntitySchema) {
				return yield* Effect.die("Entity schema not found during entity merge");
			}
			for (const property of fromEntitySchema.mergeIdentityProperties) {
				if (!Bun.deepEquals(fromScope.properties[property], intoScope.properties[property])) {
					return yield* new UserStateBadRequest({
						reason: { property, code: "identity-property-mismatch" },
					});
				}
			}
			const eventIds = yield* eventsRepository.listUserEventIdsForEntity({
				userId: user.id,
				entityId: mergeFrom,
			});
			const preparedEvents: PreparedEventUpdate[] = [];
			for (const eventId of eventIds) {
				const prepared = yield* events.prepareUpdate(
					{ eventId, mergeFrom, mergeInto, userId: user.id },
					itemCommand(command, `event:${eventId}:update`),
				);
				if (prepared) {
					preparedEvents.push(prepared);
				}
			}
			const relationshipRows =
				yield* relationshipsRepository.listUserRelationshipsForEntityWithProvenance({
					userId: user.id,
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
						userId: user.id,
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
							...(yield* events.persistPreparedUpdate(prepared, {
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
			clearUserState: (user: CurrentUserValue, entityId: EntityId, command: LifecycleCommand) =>
				clearUserState(user, entityId, command).pipe(
					Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
				),
			mergeUserState: (
				user: CurrentUserValue,
				payload: MergeUserStateBody,
				command: LifecycleCommand,
			) =>
				mergeUserState(user, payload, command).pipe(
					Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
				),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
