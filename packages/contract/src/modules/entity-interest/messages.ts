import { DateTime, Schema, SchemaGetter } from "effect";

import { EntityId } from "../../schema/brands";

export const EntityUpdatedReason = Schema.Literals(["populated", "translated"]);
export type EntityUpdatedReason = typeof EntityUpdatedReason.Type;

export const EntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedMessage = typeof EntityUpdatedMessage.Type;

export const encodeEntityUpdatedMessage = (
	entityId: EntityId,
	reason: EntityUpdatedReason,
): string => JSON.stringify({ entityId, reason } satisfies EntityUpdatedMessage);

// Sync decoder for the ioredis message callback (not an Effect context).
export const decodeEntityUpdatedMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityUpdatedMessage),
);

export const MAX_INTEREST_ENTITY_IDS = 500;

const Revision = Schema.Finite.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThan(0)),
);
const EntityIds = Schema.Array(Schema.String).pipe(
	Schema.decodeTo(Schema.Array(Schema.String), {
		encode: SchemaGetter.transform((entityIds) => entityIds),
		decode: SchemaGetter.transform((entityIds) => Array.from(new Set(entityIds))),
	}),
);

export const EntityInterestAuthenticateMessage = Schema.Struct({
	ticket: Schema.String,
	type: Schema.Literal("authenticate"),
});
export type EntityInterestAuthenticateMessage = typeof EntityInterestAuthenticateMessage.Type;

export const EntityInterestReplaceMessage = Schema.Struct({
	revision: Revision,
	entityIds: EntityIds,
	type: Schema.Literal("replace"),
});
export type EntityInterestReplaceMessage = typeof EntityInterestReplaceMessage.Type;

export const EntityInterestUpdateMessage = Schema.Struct({
	add: EntityIds,
	remove: EntityIds,
	revision: Revision,
	type: Schema.Literal("update"),
}).pipe(
	Schema.check(
		Schema.makeFilter(({ add, remove }) => {
			if (add.length === 0 && remove.length === 0) {
				return "Expected at least one added or removed entity ID";
			}
			const removed = new Set(remove);
			return add.every((entityId) => !removed.has(entityId))
				? true
				: "Expected added and removed entity IDs not to overlap";
		}),
	),
);
export type EntityInterestUpdateMessage = typeof EntityInterestUpdateMessage.Type;

export const EntityInterestPongMessage = Schema.Struct({
	nonce: Schema.String,
	type: Schema.Literal("pong"),
});
export type EntityInterestPongMessage = typeof EntityInterestPongMessage.Type;

export const EntityInterestClientMessage = Schema.Union([
	EntityInterestPongMessage,
	EntityInterestUpdateMessage,
	EntityInterestReplaceMessage,
	EntityInterestAuthenticateMessage,
]);
export type EntityInterestClientMessage = typeof EntityInterestClientMessage.Type;

export const EntityInterestReadyMessage = Schema.Struct({
	sessionId: Schema.String,
	maxEntityIds: Schema.Finite,
	heartbeatIntervalMs: Schema.Finite,
	type: Schema.Literal("ready"),
});
export type EntityInterestReadyMessage = typeof EntityInterestReadyMessage.Type;

export const EntityInterestAppliedMessage = Schema.Struct({
	revision: Revision,
	type: Schema.Literal("applied"),
});
export type EntityInterestAppliedMessage = typeof EntityInterestAppliedMessage.Type;

export const EntityInterestEntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
	type: Schema.Literal("entity-updated"),
});
export type EntityInterestEntityUpdatedMessage = typeof EntityInterestEntityUpdatedMessage.Type;

export const EntityInterestPingMessage = Schema.Struct({
	nonce: Schema.String,
	type: Schema.Literal("ping"),
});
export type EntityInterestPingMessage = typeof EntityInterestPingMessage.Type;

export const EntityInterestRejectedMessage = Schema.Struct({
	revision: Revision,
	maxEntityIds: Schema.Finite,
	type: Schema.Literal("rejected"),
	code: Schema.Literal("interest-limit-exceeded"),
});
export type EntityInterestRejectedMessage = typeof EntityInterestRejectedMessage.Type;

export const EntityInterestServerMessage = Schema.Union([
	EntityInterestPingMessage,
	EntityInterestReadyMessage,
	EntityInterestAppliedMessage,
	EntityInterestRejectedMessage,
	EntityInterestEntityUpdatedMessage,
]);
export type EntityInterestServerMessage = typeof EntityInterestServerMessage.Type;

export const decodeEntityInterestClientMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityInterestClientMessage),
);
export const encodeEntityInterestClientMessage = Schema.encodeSync(
	Schema.fromJsonString(EntityInterestClientMessage),
);
export const decodeEntityInterestServerMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityInterestServerMessage),
);
export const encodeEntityInterestServerMessage = Schema.encodeSync(
	Schema.fromJsonString(EntityInterestServerMessage),
);

const IsoUtcString = Schema.DateTimeUtcFromString.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform(DateTime.formatIso),
		encode: SchemaGetter.transform(DateTime.makeUnsafe),
	}),
);

export const EntityInterestSocketTicketResponse = Schema.Struct({
	ticket: Schema.String,
	expiresAt: IsoUtcString,
});
export type EntityInterestSocketTicketResponse = typeof EntityInterestSocketTicketResponse.Type;
