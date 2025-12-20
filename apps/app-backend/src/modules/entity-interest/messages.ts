import { Schema } from "effect";

import { EntityUpdatedReason } from "#lib/redis";

export const EntityUpdatedFrame = Schema.Struct({
	entityId: Schema.String,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedFrame = typeof EntityUpdatedFrame.Type;

export const encodeEntityUpdatedFrame = (frame: EntityUpdatedFrame): string =>
	JSON.stringify(frame);

export const ConnectedFrame = Schema.Struct({
	streamId: Schema.String,
});
export type ConnectedFrame = typeof ConnectedFrame.Type;

export const encodeConnectedFrame = (frame: ConnectedFrame): string => JSON.stringify(frame);

export const MAX_INTEREST_ENTITY_IDS = 500;

export const DeclareInterestBody = Schema.Struct({
	streamId: Schema.String,
	entityIds: Schema.Array(Schema.String),
});
export type DeclareInterestBody = typeof DeclareInterestBody.Type;

export const DeclareInterestResponse = Schema.Struct({
	terminal: Schema.Array(EntityUpdatedFrame),
});
export type DeclareInterestResponse = typeof DeclareInterestResponse.Type;
