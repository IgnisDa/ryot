import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner, TransactionRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";
import { badRequest, notFound } from "#lib/errors";
import { trimToNull } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import type { ClearUserStateResponse, MergeUserStateBody, MergeUserStateResponse } from "./schemas";

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

type UserStateServiceShape = {
	readonly clearUserState: (
		user: CurrentUserValue,
		entityIdInput: string,
	) => Effect.Effect<ClearUserStateResponse, BadRequest | DbError | NotFound>;
	readonly mergeUserState: (
		user: CurrentUserValue,
		payload: MergeUserStateBody,
	) => Effect.Effect<MergeUserStateResponse, BadRequest | DbError | NotFound>;
};

export class UserStateService extends Effect.Service<UserStateService>()("UserStateService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventsRepository = yield* EventsRepository;
		const runInTransaction = yield* TransactionRunner;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;

		return {
			clearUserState: (user: CurrentUserValue, entityIdInput: string) =>
				Effect.gen(function* () {
					const entityId = trimToNull(entityIdInput);
					if (!entityId) {
						return yield* badRequest("Entity id is required");
					}

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
				}),
			mergeUserState: (user: CurrentUserValue, payload: MergeUserStateBody) =>
				Effect.gen(function* () {
					const mergeFrom = trimToNull(payload.mergeFrom);
					const mergeInto = trimToNull(payload.mergeInto);

					if (!mergeFrom) {
						return yield* badRequest("mergeFrom is required");
					}
					if (!mergeInto) {
						return yield* badRequest("mergeInto is required");
					}
					if (mergeFrom === mergeInto) {
						return yield* badRequest(sameEntityMergeError);
					}

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
					if (
						fromScope.entitySchemaSlug === "library" ||
						intoScope.entitySchemaSlug === "library"
					) {
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
				}),
		} satisfies UserStateServiceShape;
	}),
}) {}
