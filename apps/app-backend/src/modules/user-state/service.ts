import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	type MergeUserStateBody,
	UserStateBadRequest,
	UserStateNotFound,
} from "@ryot/contract/modules/user-state/schemas";
import { EntityId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

export class UserStateService extends Context.Service<UserStateService>()("UserStateService", {
	make: Effect.gen(function* () {
		const eventsRepository = yield* EventsRepository;
		const events = yield* EventsService;
		const relationships = yield* RelationshipsService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		const clearUserState = Effect.fn("UserStateService.clearUserState")(function* (
			user: CurrentUserValue,
			entityIdInput: EntityId,
		) {
			const trimmedEntityId = trimToNull(entityIdInput);
			if (!trimmedEntityId) {
				return yield* new UserStateBadRequest({
					reason: { code: "required-field", field: "entityId" },
				});
			}

			const entityId = EntityId.make(trimmedEntityId);
			const scope = yield* entitiesRepository.getEntityScopeForUser({ userId: user.id, entityId });
			if (!scope) {
				return yield* new UserStateNotFound({
					reason: { code: "entity-not-found", entityIds: [entityId] },
				});
			}

			const definitions = yield* pluginRuntime.getEffectiveDefinitions(user.id).pipe(Effect.orDie);
			const entitySchema = definitions.entitySchemas[scope.entitySchemaSlug];
			if (entitySchema?.userState?.deniedOperations.includes("clear")) {
				return yield* new UserStateBadRequest({
					reason: { code: "operation-denied", operation: "clear" },
				});
			}

			const database = yield* Database;
			return yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const eventIds = yield* eventsRepository.listUserEventIdsForEntity({
							entityId,
							userId: user.id,
						});
						let deletedEventsCount = 0;
						for (const eventId of eventIds) {
							const deleted = yield* events.delete({ eventId, userId: user.id });
							if (deleted) {
								deletedEventsCount += 1;
							}
						}
						const relationshipRows = yield* relationshipsRepository.listUserRelationshipsForEntity({
							entityId,
							userId: user.id,
						});
						let deletedRelationshipsCount = 0;
						for (const relationship of relationshipRows) {
							const deleted = yield* relationships.delete({
								scope: "user",
								userId: user.id,
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchemaSlug: relationship.relationshipSchemaSlug,
							});
							if (deleted) {
								deletedRelationshipsCount += 1;
							}
						}

						return { entityId, deletedEventsCount, deletedRelationshipsCount };
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
		});

		const mergeUserState = Effect.fn("UserStateService.mergeUserState")(function* (
			user: CurrentUserValue,
			payload: MergeUserStateBody,
		) {
			const trimmedMergeFrom = trimToNull(payload.mergeFrom);
			const trimmedMergeInto = trimToNull(payload.mergeInto);

			if (!trimmedMergeFrom) {
				return yield* new UserStateBadRequest({
					reason: { code: "required-field", field: "mergeFrom" },
				});
			}
			if (!trimmedMergeInto) {
				return yield* new UserStateBadRequest({
					reason: { code: "required-field", field: "mergeInto" },
				});
			}
			if (trimmedMergeFrom === trimmedMergeInto) {
				return yield* new UserStateBadRequest({ reason: { code: "same-entity-merge" } });
			}

			const mergeFrom = EntityId.make(trimmedMergeFrom);
			const mergeInto = EntityId.make(trimmedMergeInto);

			const [fromScope, intoScope] = yield* Effect.all([
				entitiesRepository.getEntityMergeScopeForUser({
					userId: user.id,
					entityId: mergeFrom,
				}),
				entitiesRepository.getEntityMergeScopeForUser({
					userId: user.id,
					entityId: mergeInto,
				}),
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
					reason: { code: "operation-denied", operation: "merge" },
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
						reason: { code: "identity-property-mismatch", property },
					});
				}
			}
			const database = yield* Database;
			return yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const eventIds = yield* eventsRepository.listUserEventIdsForEntity({
							userId: user.id,
							entityId: mergeFrom,
						});
						let movedEventsCount = 0;
						for (const eventId of eventIds) {
							const updated = yield* events.update({
								eventId,
								mergeFrom,
								mergeInto,
								userId: user.id,
							});
							if (updated) {
								movedEventsCount += 1;
							}
						}
						const relationshipRows = yield* relationshipsRepository.listUserRelationshipsForEntity({
							userId: user.id,
							entityId: mergeFrom,
						});
						const propertiesSchemas = new Map<string, AppSchema>();
						const getPropertiesSchema = Effect.fn(
							"UserStateService.getRelationshipPropertiesSchema",
						)(function* (
							relationshipSchemaSlug: (typeof relationshipRows)[number]["relationshipSchemaSlug"],
						) {
							const cached = propertiesSchemas.get(relationshipSchemaSlug);
							if (cached) {
								return cached;
							}

							const relationshipSchema = yield* relationshipSchemasRepository.findById(
								relationshipSchemaSlug,
								user.id,
							);
							if (!relationshipSchema) {
								return yield* Effect.die("Relationship schema not found during entity merge");
							}

							propertiesSchemas.set(relationshipSchemaSlug, relationshipSchema.propertiesSchema);
							return relationshipSchema.propertiesSchema;
						});

						let movedRelationshipsCount = 0;
						for (const relationship of relationshipRows) {
							const sourceEntityId =
								relationship.sourceEntityId === mergeFrom ? mergeInto : relationship.sourceEntityId;
							const targetEntityId =
								relationship.targetEntityId === mergeFrom ? mergeInto : relationship.targetEntityId;

							if (sourceEntityId !== targetEntityId) {
								yield* relationships
									.create({
										scope: "user",
										sourceEntityId,
										targetEntityId,
										userId: user.id,
										properties: relationship.properties,
										relationshipSchemaSlug: relationship.relationshipSchemaSlug,
										propertiesSchema: yield* getPropertiesSchema(
											relationship.relationshipSchemaSlug,
										),
									})
									.pipe(
										Effect.catchTag("RelationshipBadRequest", (error) =>
											Effect.logWarning("relationship merge validation failed", error).pipe(
												Effect.andThen(
													new UserStateBadRequest({
														reason: { code: "relationship-merge-failed" },
													}),
												),
											),
										),
									);
							}

							const deleted = yield* relationships.delete({
								scope: "user",
								userId: user.id,
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchemaSlug: relationship.relationshipSchemaSlug,
							});
							if (deleted) {
								movedRelationshipsCount += 1;
							}
						}

						return { mergeFrom, mergeInto, movedEventsCount, movedRelationshipsCount };
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
		});

		return { clearUserState, mergeUserState };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
