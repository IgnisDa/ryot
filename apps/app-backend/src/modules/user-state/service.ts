import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner, TransactionRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";
import { badRequest, notFound } from "#lib/errors";
import { trimToNull } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import type { ClearUserStateResponse } from "./schemas";

const entityNotFoundError = "Entity not found";
const libraryEntityUserStateError = "Library entity user state cannot be cleared";

type UserStateServiceShape = {
	readonly clearUserState: (
		user: CurrentUserValue,
		entityIdInput: string,
	) => Effect.Effect<ClearUserStateResponse, BadRequest | DbError | NotFound>;
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
		} satisfies UserStateServiceShape;
	}),
}) {}
