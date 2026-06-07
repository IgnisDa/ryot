import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner, TransactionRunner } from "#lib/db/service";
import { badRequest, notFound } from "#lib/errors";
import { EntityId } from "#lib/schema/brands";
import { trimToNull } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import type { MergeUserStateBody } from "./schemas";

const entityNotFoundError = "Entity not found";
const sameEntityMergeError = "Cannot merge an entity into itself";
const exerciseKindMismatchError = "Exercises must have the same kind";
const libraryEntityMergeError = "Library entity user state cannot be merged";
const differentEntitySchemaError = "Entities must belong to the same schema";
const libraryEntityUserStateError = "Library entity user state cannot be cleared";

const getPropertyString = (properties: Record<string, unknown>, key: string) => {
	const value = properties[key];
	return typeof value === "string" ? value : null;
};

export class UserStateService extends Effect.Service<UserStateService>()("UserStateService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventsRepository = yield* EventsRepository;
		const runInTransaction = yield* TransactionRunner;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;

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

			if (scope.entitySchemaSlug === "library") {
				return yield* badRequest(libraryEntityUserStateError);
			}

			return yield* runInTransaction(
				Effect.gen(function* () {
					const deletedEventsCount = yield* eventsRepository.deleteUserEventsForEntity({
						entityId,
						userId: user.id,
					});
					const deletedRelationshipsCount =
						yield* relationshipsRepository.deleteUserRelationshipsForEntity({
							entityId,
							userId: user.id,
						});

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
			if (fromScope.entitySchemaSlug === "library" || intoScope.entitySchemaSlug === "library") {
				return yield* badRequest(libraryEntityMergeError);
			}
			if (fromScope.entitySchemaId !== intoScope.entitySchemaId) {
				return yield* badRequest(differentEntitySchemaError);
			}
			if (
				fromScope.entitySchemaSlug === "exercise" &&
				getPropertyString(fromScope.properties, "kind") !==
					getPropertyString(intoScope.properties, "kind")
			) {
				return yield* badRequest(exerciseKindMismatchError);
			}

			return yield* runInTransaction(
				Effect.gen(function* () {
					const movedEventsCount = yield* eventsRepository.moveUserEventsBetweenEntities({
						mergeFrom,
						mergeInto,
						userId: user.id,
					});
					const movedRelationshipsCount =
						yield* relationshipsRepository.moveUserRelationshipsBetweenEntities({
							mergeFrom,
							mergeInto,
							userId: user.id,
						});

					return { mergeFrom, mergeInto, movedEventsCount, movedRelationshipsCount };
				}),
			);
		});

		return { clearUserState, mergeUserState };
	}),
}) {}
