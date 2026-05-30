import { Schema } from "effect";

export const ClearUserStateResponse = Schema.Struct({
	entityId: Schema.String,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

export type ClearUserStateResponse = typeof ClearUserStateResponse.Type;

export const MergeUserStateBody = Schema.Struct({
	mergeFrom: Schema.String,
	mergeInto: Schema.String,
});

export type MergeUserStateBody = typeof MergeUserStateBody.Type;

export const MergeUserStateResponse = Schema.Struct({
	mergeFrom: Schema.String,
	mergeInto: Schema.String,
	movedEventsCount: Schema.Number,
	movedRelationshipsCount: Schema.Number,
});

export type MergeUserStateResponse = typeof MergeUserStateResponse.Type;
