import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	CollectionConflict,
	CollectionNotFound,
	type ReorderMembershipBody,
	ReorderMembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";

import { CollectionsRepository } from "./repository";

export class CollectionOrderingService extends Context.Service<CollectionOrderingService>()(
	"CollectionOrderingService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const collections = yield* CollectionsRepository;
			const entities = yield* EntitiesRepository;
			const relationships = yield* RelationshipsRepository;
			const reorder = Effect.fn("CollectionOrderingService.reorder")(function* (
				user: CurrentUserValue,
				input: ReorderMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const identity = mutationReceiptIdentity({
					input,
					command,
					ownerUserId: user.id,
					scopeUserId: user.id,
					commandKind: "collection:reorder",
				});
				return yield* session
					.transaction(
						Effect.gen(function* () {
							const prior = yield* receipts
								.lookup(identity, ReorderMembershipResponse)
								.pipe(
									Effect.catchTag(
										"MutationReceiptIdentityConflict",
										() => new CollectionConflict({ reason: { code: "command-identity-conflict" } }),
									),
								);
							if (prior) {
								return prior.result;
							}
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
							if (collection !== input.expectedRevision) {
								return yield* new CollectionConflict({ reason: { code: "order-stale" } });
							}
							yield* relationships.moveCollectionMember(
								{ userId: user.id, collectionId: input.collectionId },
								input.entityId,
								input.destination,
							);
							const orderRevision = yield* collections.getOrderRevision(
								input.collectionId,
								user.id,
							);
							if (orderRevision === null) {
								return yield* Effect.die("Locked collection disappeared");
							}
							const result = { orderRevision, collectionId: input.collectionId };
							yield* receipts.insert({ result, identity, dispatch: [] });
							return result;
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
