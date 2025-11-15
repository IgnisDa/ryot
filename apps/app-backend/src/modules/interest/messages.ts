import { Schema } from "effect";

import { EntityUpdatedReason } from "#lib/redis";

// Replace semantics: each interest message supersedes the connection's previous set.
export const InterestMessage = Schema.Struct({
	type: Schema.Literal("interest"),
	entityIds: Schema.Array(Schema.String),
});
export type InterestMessage = typeof InterestMessage.Type;

export const ClientMessage = Schema.Union(InterestMessage).annotations({
	identifier: "ClientMessage",
});
export type ClientMessage = typeof ClientMessage.Type;

export const decodeClientMessage = Schema.decodeUnknownEither(Schema.parseJson(ClientMessage));

export const EntityUpdatedFrame = Schema.Struct({
	entityId: Schema.String,
	reason: EntityUpdatedReason,
	type: Schema.Literal("entity:updated"),
});

export const ErrorFrame = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	type: Schema.Literal("error"),
});

export const ServerMessage = Schema.Union(EntityUpdatedFrame, ErrorFrame).annotations({
	identifier: "ServerMessage",
});
export type ServerMessage = typeof ServerMessage.Type;

export const encodeServerMessage = (message: ServerMessage): string => JSON.stringify(message);
