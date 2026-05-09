import { Schema } from "effect";

export const ClearUserStateResponse = Schema.Struct({
	entityId: Schema.String,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

export type ClearUserStateResponse = typeof ClearUserStateResponse.Type;
