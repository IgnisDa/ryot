import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { MergeUserStateBody } from "@ryot/contract/modules/user-state/schemas";
import { EntityId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

const entityNotFoundError = "Entity not found";
const sameEntityMergeError = "Cannot merge an entity into itself";
const entityMergeDeniedError = "Entity user state cannot be merged";
const entityClearDeniedError = "Entity user state cannot be cleared";
const differentEntitySchemaError = "Entities must belong to the same schema";

export class UserStateService extends Effect.Service<UserStateService>()("UserStateService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventsRepository = yield* EventsRepository;
		const events = yield* EventsService;
		const relationships = yield* RelationshipsService;
		const definitions = yield* DefinitionRegistry;
		const runInTransaction = yield* TransactionRunner;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		const clearUserState = Effect.fn("UserStateService.clearUserState")(function* (
			user: CurrentUserValue,
			entityIdInput: EntityId,
		) {
			const trimmedEntityId = trimToNull(entityIdInput);
			if (!trimmedEntityId) {
				return yield* badRequest("Entity id is required");
			}

			const entityId = EntityId.make(trimmedEntityId);
			const scope = yield* runWithDb(
				entitiesRepository.getEntityScopeForUser({ userId: user.id, entityId }),
			);
			if (!scope) {
				return yield* notFound(entityNotFoundError);
			}

			const entitySchema = definitions.getEntitySchema(scope.entitySchemaSlug);
			if (entitySchema?.userState?.deniedOperations.includes("clear")) {
				return yield* badRequest(entityClearDeniedError);
			}

			return yield* runInTransaction(
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
				}),
			);
		});

		const mergeUserState = Effect.fn("UserStateService.mergeUserState")(function* (
			user: CurrentUserValue,
			payload: MergeUserStateBody,
		) {
			const trimmedMergeFrom = trimToNull(payload.mergeFrom);
			const trimmedMergeInto = trimToNull(payload.mergeInto);

			if (!trimmedMergeFrom) {
				return yield* badRequest("mergeFrom is required");
			}
			if (!trimmedMergeInto) {
				return yield* badRequest("mergeInto is required");
			}
			if (trimmedMergeFrom === trimmedMergeInto) {
				return yield* badRequest(sameEntityMergeError);
			}

			const mergeFrom = EntityId.make(trimmedMergeFrom);
			const mergeInto = EntityId.make(trimmedMergeInto);

			const [fromScope, intoScope] = yield* Effect.all([
				runWithDb(
					entitiesRepository.getEntityMergeScopeForUser({
						userId: user.id,
						entityId: mergeFrom,
					}),
				),
				runWithDb(
					entitiesRepository.getEntityMergeScopeForUser({
						userId: user.id,
						entityId: mergeInto,
					}),
				),
			]);
			if (!fromScope || !intoScope) {
				return yield* notFound(entityNotFoundError);
			}
			const fromEntitySchema = definitions.getEntitySchema(fromScope.entitySchemaSlug);
			const intoEntitySchema = definitions.getEntitySchema(intoScope.entitySchemaSlug);
			if (
				fromEntitySchema?.userState?.deniedOperations.includes("merge") ||
				intoEntitySchema?.userState?.deniedOperations.includes("merge")
			) {
				return yield* badRequest(entityMergeDeniedError);
			}
			if (fromScope.entitySchemaSlug !== intoScope.entitySchemaSlug) {
				return yield* badRequest(differentEntitySchemaError);
			}
			if (!fromEntitySchema) {
				return yield* Effect.die("Entity schema not found during entity merge");
			}
			for (const property of fromEntitySchema.mergeIdentityProperties) {
				if (!Bun.deepEquals(fromScope.properties[property], intoScope.properties[property])) {
					return yield* badRequest(`Entities must have the same '${property}' property`);
				}
			}
			return yield* runInTransaction(
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
					const getPropertiesSchema = Effect.fn("UserStateService.getRelationshipPropertiesSchema")(
						function* (
							relationshipSchemaSlug: (typeof relationshipRows)[number]["relationshipSchemaSlug"],
						) {
							const cached = propertiesSchemas.get(relationshipSchemaSlug);
							if (cached) {
								return cached;
							}

							const relationshipSchema = yield* runWithDb(
								relationshipSchemasRepository.findById(relationshipSchemaSlug, user.id),
							);
							if (!relationshipSchema) {
								return yield* Effect.die("Relationship schema not found during entity merge");
							}

							propertiesSchemas.set(relationshipSchemaSlug, relationshipSchema.propertiesSchema);
							return relationshipSchema.propertiesSchema;
						},
					);

					let movedRelationshipsCount = 0;
					for (const relationship of relationshipRows) {
						const sourceEntityId =
							relationship.sourceEntityId === mergeFrom ? mergeInto : relationship.sourceEntityId;
						const targetEntityId =
							relationship.targetEntityId === mergeFrom ? mergeInto : relationship.targetEntityId;

						if (sourceEntityId !== targetEntityId) {
							yield* relationships.create({
								scope: "user",
								sourceEntityId,
								targetEntityId,
								userId: user.id,
								properties: relationship.properties,
								relationshipSchemaSlug: relationship.relationshipSchemaSlug,
								propertiesSchema: yield* getPropertiesSchema(relationship.relationshipSchemaSlug),
							});
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
				}),
			);
		});

		return { clearUserState, mergeUserState };
	}),
}) {}
