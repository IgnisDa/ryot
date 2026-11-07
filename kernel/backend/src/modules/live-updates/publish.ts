import { EntityUpdatedReason } from "@ryot-app/contract/modules/live-updates/messages";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Array as Arr, Effect, Schema } from "effect";

import { broadcastStatement } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";

export const entityUpdatedTopic = "entity-updated";
export const derivedDataUpdatedTopic = "derived-data-updated";
export const impersonationEndedTopic = "impersonation-ended";

export const EntityUpdatedMessage = Schema.fromJsonString(
	Schema.Struct({ entityId: EntityId, reason: EntityUpdatedReason, userIds: Schema.Array(UserId) }),
);
export const DerivedDataUpdatedMessage = Schema.fromJsonString(Schema.Struct({ userId: UserId }));
export const ImpersonationEndedMessage = Schema.fromJsonString(
	Schema.Struct({ sessionId: Schema.String }),
);

// A notification carries about 8 KB, so a long list of requesters goes out in several.
const USERS_PER_MESSAGE = 100;

/** Tells these users' open clients to refetch an entity. Joins the caller's transaction, if any. */
export const publishEntityUpdated = Effect.fn("publishEntityUpdated")(function* (
	entityId: EntityId,
	reason: EntityUpdatedReason,
	userIds: ReadonlyArray<UserId>,
) {
	const session = yield* DatabaseSession;
	for (const chunk of Arr.chunksOf(userIds, USERS_PER_MESSAGE)) {
		const message = yield* Schema.encodeEffect(EntityUpdatedMessage)({
			reason,
			entityId,
			userIds: chunk,
		}).pipe(Effect.orDie);
		yield* session.run((db) => db.execute(broadcastStatement(entityUpdatedTopic, message)));
	}
});

/** A non-durable hint; clients also refresh on reconnect, so a lost publication only delays refresh. */
export const publishDerivedDataUpdated = Effect.fn("publishDerivedDataUpdated")(function* (
	userId: UserId,
) {
	const session = yield* DatabaseSession;
	const message = yield* Schema.encodeEffect(DerivedDataUpdatedMessage)({ userId }).pipe(
		Effect.orDie,
	);
	yield* session
		.run((db) => db.execute(broadcastStatement(derivedDataUpdatedTopic, message)))
		.pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("Derived data refresh publication failed", cause),
			),
		);
});
