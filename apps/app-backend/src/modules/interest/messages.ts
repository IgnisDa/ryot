import { Schema } from "effect";

import { EntityUpdatedReason } from "#lib/redis";

// Sent as the data payload of an SSE "entity:updated" event, and reused as the shape of each
// already-terminal entry in the POST /api/interest response body.
export const EntityUpdatedFrame = Schema.Struct({
	entityId: Schema.String,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedFrame = typeof EntityUpdatedFrame.Type;

export const encodeEntityUpdatedFrame = (frame: EntityUpdatedFrame): string =>
	JSON.stringify(frame);

// Data payload of the SSE "connected" event, sent once when a stream is opened.
export const ConnectedFrame = Schema.Struct({
	streamId: Schema.String,
});
export type ConnectedFrame = typeof ConnectedFrame.Type;

export const encodeConnectedFrame = (frame: ConnectedFrame): string => JSON.stringify(frame);

// Upper bound on how many entity ids one interest declaration reconciles. reconcile runs ⌈N/100⌉
// sequential query-engine transactions per POST (each holding a DB connection), so an unbounded set
// — even a legit huge saved view — would turn one POST into a slow, connection-hogging request. The
// handler truncates to this many ids (and logs) rather than rejecting, so an oversized view still
// gets partial real-time updates. Enforced in modules/interest/routes.ts.
export const MAX_INTEREST_ENTITY_IDS = 500;

// POST /api/interest request body. Replace semantics: each call supersedes the interest set
// previously declared for that stream.
export const DeclareInterestBody = Schema.Struct({
	streamId: Schema.String,
	entityIds: Schema.Array(Schema.String),
});
export type DeclareInterestBody = typeof DeclareInterestBody.Type;

// POST /api/interest response body: entities that were already terminal at reconcile time, for
// immediate catch-up. The same entity may also arrive later over SSE; clients must dedupe by
// entityId.
export const DeclareInterestResponse = Schema.Struct({
	terminal: Schema.Array(EntityUpdatedFrame),
});
export type DeclareInterestResponse = typeof DeclareInterestResponse.Type;
