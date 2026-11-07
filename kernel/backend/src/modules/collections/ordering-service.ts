import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	CollectionConflict,
	CollectionNotFound,
	type ReorderMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";

import { CollectionsRepository } from "./repository";

export class CollectionOrderingService extends Context.Service<CollectionOrderingService>()(
	"@ryot-app/kernel-backend/modules/collections/ordering-service/CollectionOrderingService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const admission = yield* AccountAdmission.make;
			const collections = yield* CollectionsRepository;
			const entities = yield* EntitiesRepository;
			const relationships = yield* RelationshipsRepository;
			const reorder = Effect.fn("CollectionOrderingService.reorder")(function* (
				user: CurrentUserValue,
				input: ReorderMembershipBody,
			) {
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* admission.admitAccount(user.id);
							yield* entities.lockEntityReferencesByIds([
								input.collectionId,
								input.entityId,
								...("entityId" in input.destination ? [input.destination.entityId] : []),
							]);
							yield* relationships.lockCollectionOrders([
								{
									scope: "user",
									userId: user.id,
									sourceEntityId: input.entityId,
									relationshipSchemaPluginId: null,
									targetEntityId: input.collectionId,
									relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
								},
							]);
							const collection = yield* collections.getOrderRevision(input.collectionId, user.id);
							if (collection === null) {
								return yield* new CollectionNotFound({
									reason: { code: "collection-not-found", collectionId: input.collectionId },
								});
							}
							const scope = { userId: user.id, collectionId: input.collectionId };
							if (collection !== input.expectedRevision) {
								if (
									yield* relationships.isCollectionMemberAt(
										scope,
										input.entityId,
										input.destination,
									)
								) {
									return { orderRevision: collection, collectionId: input.collectionId };
								}
								return yield* new CollectionConflict({ reason: { code: "order-stale" } });
							}
							yield* relationships.moveCollectionMember(scope, input.entityId, input.destination);
							const orderRevision = yield* collections.getOrderRevision(
								input.collectionId,
								user.id,
							);
							if (orderRevision === null) {
								return yield* Effect.die("Locked collection disappeared");
							}
							return { orderRevision, collectionId: input.collectionId };
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			});
			return { reorder };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
