import { Schema, SchemaGetter } from "effect";

import { EntityId, UserId } from "../../schema/brands";
import { IsoUtcString } from "../../schema/utils";

export const EntityUpdatedReason = Schema.Literals([
	"populated",
	"translated",
	"population-failed",
	"projection-updated",
]);
export type EntityUpdatedReason = typeof EntityUpdatedReason.Type;

export const EntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedMessage = typeof EntityUpdatedMessage.Type;

export const EntityUpdatePublication = Schema.Struct({
	...EntityUpdatedMessage.fields,
	userId: Schema.optional(UserId),
});
export type EntityUpdatePublication = typeof EntityUpdatePublication.Type;

export const encodeEntityUpdatedMessage = (
	entityId: EntityId,
	reason: EntityUpdatedReason,
	userId?: UserId,
): string =>
	JSON.stringify({
		reason,
		entityId,
		...(userId === undefined ? {} : { userId }),
	} satisfies EntityUpdatePublication);

// Sync decoder for the ioredis message callback (not an Effect context).
export const decodeEntityUpdatedMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityUpdatePublication),
);

export const MAX_INTEREST_ENTITY_IDS = 500;
export const MAX_FOREGROUND_ENTITY_IDS = 50;

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

export const EntityWatchAuthenticateMessage = Schema.Struct({
	ticket: Schema.String,
	type: Schema.Literal("authenticate"),
});
export type EntityWatchAuthenticateMessage = typeof EntityWatchAuthenticateMessage.Type;

const FOREGROUND_LIMIT_MESSAGE = `Expected at most ${MAX_FOREGROUND_ENTITY_IDS} foreground entity IDs`;

export const EntityWatchReplaceMessage = Schema.Struct({
	revision: Revision,
	entityIds: EntityIds,
	foregroundIds: EntityIds,
	type: Schema.Literal("replace"),
}).pipe(
	Schema.check(
		Schema.makeFilter(({ entityIds, foregroundIds }) => {
			if (foregroundIds.length > MAX_FOREGROUND_ENTITY_IDS) {
				return FOREGROUND_LIMIT_MESSAGE;
			}
			const members = new Set(entityIds);
			return foregroundIds.every((entityId) => members.has(entityId))
				? true
				: "Expected foreground entity IDs to be a subset of entity IDs";
		}),
	),
);
export type EntityWatchReplaceMessage = typeof EntityWatchReplaceMessage.Type;

export const EntityWatchPongMessage = Schema.Struct({
	nonce: Schema.String,
	type: Schema.Literal("pong"),
});
export type EntityWatchPongMessage = typeof EntityWatchPongMessage.Type;

export const EntityWatchClientMessage = Schema.Union([
	EntityWatchPongMessage,
	EntityWatchReplaceMessage,
	EntityWatchAuthenticateMessage,
]);
export type EntityWatchClientMessage = typeof EntityWatchClientMessage.Type;

export const EntityWatchReadyMessage = Schema.Struct({
	sessionId: Schema.String,
	maxEntityIds: Schema.Finite,
	type: Schema.Literal("ready"),
	heartbeatIntervalMs: Schema.Finite,
});
export type EntityWatchReadyMessage = typeof EntityWatchReadyMessage.Type;

export const EntityWatchAppliedMessage = Schema.Struct({
	revision: Revision,
	type: Schema.Literal("applied"),
});
export type EntityWatchAppliedMessage = typeof EntityWatchAppliedMessage.Type;

export const EntityWatchEntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
	type: Schema.Literal("entity-updated"),
});
export type EntityWatchEntityUpdatedMessage = typeof EntityWatchEntityUpdatedMessage.Type;

export const EntityWatchPingMessage = Schema.Struct({
	nonce: Schema.String,
	type: Schema.Literal("ping"),
});
export type EntityWatchPingMessage = typeof EntityWatchPingMessage.Type;

export const EntityWatchRejectedMessage = Schema.Struct({
	revision: Revision,
	maxEntityIds: Schema.Finite,
	type: Schema.Literal("rejected"),
	code: Schema.Literal("interest-limit-exceeded"),
});
export type EntityWatchRejectedMessage = typeof EntityWatchRejectedMessage.Type;

export const EntityWatchServerMessage = Schema.Union([
	EntityWatchPingMessage,
	EntityWatchReadyMessage,
	EntityWatchAppliedMessage,
	EntityWatchRejectedMessage,
	EntityWatchEntityUpdatedMessage,
]);
export type EntityWatchServerMessage = typeof EntityWatchServerMessage.Type;

export const decodeEntityWatchClientMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityWatchClientMessage),
);
export const encodeEntityWatchClientMessage = Schema.encodeSync(
	Schema.fromJsonString(EntityWatchClientMessage),
);
export const decodeEntityWatchServerMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(EntityWatchServerMessage),
);
export const encodeEntityWatchServerMessage = Schema.encodeSync(
	Schema.fromJsonString(EntityWatchServerMessage),
);

export const EntityWatchSocketTicketResponse = Schema.Struct({
	ticket: Schema.String,
	expiresAt: IsoUtcString,
});
export type EntityWatchSocketTicketResponse = typeof EntityWatchSocketTicketResponse.Type;
