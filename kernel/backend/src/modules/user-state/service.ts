import { PgClient } from "@effect/sql-pg";
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
import { Context, Effect, Layer } from "effect";

import {
	LifecyclePlanner,
	type LifecyclePersistenceError,
	type LifecyclePlan,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventUpdate,
} from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
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
		const database = yield* Database;
		const sqlClient = yield* PgClient.PgClient;
		const planner = yield* LifecyclePlanner;
		const lifecycleExecution = yield* LifecycleExecution;
		const eventsRepository = yield* EventsRepository;
		const events = yield* EventsService;
		const relationships = yield* RelationshipsService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const provideMutation = <A, E>(
			effect: Effect.Effect<
				A,
				E,
				Database | EntitiesRepository | LifecycleExecution | LifecyclePlanner | PgClient.PgClient
			>,
		) =>
			effect.pipe(
				Effect.provideService(Database, database),
				Effect.provideService(PgClient.PgClient, sqlClient),
				Effect.provideService(LifecyclePlanner, planner),
				Effect.provideService(LifecycleExecution, lifecycleExecution),
				Effect.provideService(EntitiesRepository, entitiesRepository),
			);
		type RelationshipRow = Effect.Success<
			ReturnType<typeof relationshipsRepository.listUserRelationshipsForEntityWithProvenance>
		>[number];
		const withBatches = Effect.fnUntraced(function* (
			command: LifecycleCommand,
			eventPlans: ReadonlyArray<LifecyclePlan>,
			relationshipPlans: ReadonlyArray<LifecyclePlan>,
		) {
			return [
				...eventPlans,
				...relationshipPlans,
				...(yield* planner.planBatch({
					command,
					resource: "event",
					plans: eventPlans,
					identity: ["events"],
				})),
				...(yield* planner.planBatch({
					command,
					resource: "relationship",
					plans: relationshipPlans,
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
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: relationshipFailure("merge"),
							RelationshipBadRequest: relationshipFailure("merge"),
						}),
					);
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
				.pipe(
					Effect.catchTags({
						RelationshipNotFound: relationshipFailure("merge"),
						RelationshipBadRequest: relationshipFailure("merge"),
					}),
				);
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
			const scope = yield* entitiesRepository.getEntityScopeForUser({ entityId, userId: user.id });
			if (!scope) {
				return yield* new UserStateNotFound({
					reason: { entityIds: [entityId], code: "entity-not-found" },
				});
			}

			const definitions = yield* pluginRuntime.getEffectiveDefinitions(user.id).pipe(Effect.orDie);
			const entitySchema = definitions.entitySchemas[scope.entitySchemaSlug];
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
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: relationshipFailure("clear"),
							RelationshipBadRequest: relationshipFailure("clear"),
						}),
					);
				if (prepared) {
					preparedRelationships.push(prepared);
				}
			}

			const committed = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const eventPlans: LifecyclePlan[] = [];
						for (const prepared of preparedEvents) {
							eventPlans.push(...(yield* events.persistPreparedDelete(prepared)).plans);
						}
						const relationshipPlans: LifecyclePlan[] = [];
						for (const prepared of preparedRelationships) {
							const work = yield* relationships
								.persistPreparedUserDelete(prepared)
								.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("clear")));
							relationshipPlans.push(...work.plans);
						}

						return yield* withBatches(command, eventPlans, relationshipPlans);
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			const warnings = yield* lifecycleExecution.dispatch(committed.map(toLifecycleDispatchPlan));
			return {
				warnings,
				entityId,
				deletedEventsCount: preparedEvents.length,
				deletedRelationshipsCount: preparedRelationships.length,
			};
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

			const [fromScope, intoScope] = yield* Effect.all([
				entitiesRepository.getEntityMergeScopeForUser({ userId: user.id, entityId: mergeFrom }),
				entitiesRepository.getEntityMergeScopeForUser({ userId: user.id, entityId: mergeInto }),
			]);
			if (!fromScope || !intoScope) {
				return yield* new UserStateNotFound({
					reason: { code: "entity-not-found", entityIds: [mergeFrom, mergeInto] },
				});
			}
			const definitions = yield* pluginRuntime.getEffectiveDefinitions(user.id).pipe(Effect.orDie);
			const fromEntitySchema = definitions.entitySchemas[fromScope.entitySchemaSlug];
			const intoEntitySchema = definitions.entitySchemas[intoScope.entitySchemaSlug];
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

			const committed = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const eventPlans: LifecyclePlan[] = [];
						for (const prepared of preparedEvents) {
							eventPlans.push(...(yield* events.persistPreparedUpdate(prepared)).plans);
						}
						const relationshipPlans: LifecyclePlan[] = [];
						let movedRelationshipsCount = 0;
						for (const prepared of preparedRelationships) {
							if (prepared.create) {
								const work = yield* relationships
									.persistPreparedUserCreate(prepared.create)
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipPlans.push(...work.plans);
							}
							if (prepared.deletion) {
								const work = yield* relationships
									.persistPreparedUserDelete(prepared.deletion)
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipPlans.push(...work.plans);
								movedRelationshipsCount += 1;
							}
						}

						return {
							movedRelationshipsCount,
							plans: yield* withBatches(command, eventPlans, relationshipPlans),
						};
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			const warnings = yield* lifecycleExecution.dispatch(
				committed.plans.map(toLifecycleDispatchPlan),
			);
			return {
				warnings,
				mergeFrom,
				mergeInto,
				movedEventsCount: preparedEvents.length,
				movedRelationshipsCount: committed.movedRelationshipsCount,
			};
		});

		return {
			clearUserState: (user: CurrentUserValue, entityId: EntityId, command: LifecycleCommand) =>
				provideMutation(clearUserState(user, entityId, command)).pipe(
					Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
				),
			mergeUserState: (
				user: CurrentUserValue,
				payload: MergeUserStateBody,
				command: LifecycleCommand,
			) =>
				provideMutation(mergeUserState(user, payload, command)).pipe(
					Effect.catchTag("LifecyclePersistenceError", lifecyclePersistenceFailure),
				),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
