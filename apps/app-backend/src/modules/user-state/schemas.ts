import { Schema } from "effect";

import { EntityId } from "#lib/schema/brands";

export const ClearUserStateResponse = Schema.Struct({
	entityId: EntityId,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

export type ClearUserStateResponse = typeof ClearUserStateResponse.Type;

export const MergeUserStateBody = Schema.Struct({
	mergeFrom: EntityId,
	mergeInto: EntityId,
});

export type MergeUserStateBody = typeof MergeUserStateBody.Type;

export const MergeUserStateResponse = Schema.Struct({
	mergeFrom: EntityId,
	mergeInto: EntityId,
	movedEventsCount: Schema.Number,
	movedRelationshipsCount: Schema.Number,
});

export type MergeUserStateResponse = typeof MergeUserStateResponse.Type;
