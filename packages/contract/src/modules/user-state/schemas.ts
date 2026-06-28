import { Schema } from "effect";

import { EntityId } from "../../schema/brands";

const UserStateBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("same-entity-merge") }),
	Schema.Struct({ code: Schema.Literal("entity-schema-mismatch") }),
	Schema.Struct({ code: Schema.Literal("relationship-merge-failed") }),
	Schema.Struct({ property: Schema.String, code: Schema.Literal("identity-property-mismatch") }),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["entityId", "mergeFrom", "mergeInto"]),
	}),
	Schema.Struct({
		code: Schema.Literal("operation-denied"),
		operation: Schema.Literals(["clear", "merge"]),
	}),
]);

const UserStateNotFoundReason = Schema.Union([
	Schema.Struct({
		code: Schema.Literal("entity-not-found"),
		entityIds: Schema.NonEmptyArray(EntityId),
	}),
]);

export class UserStateBadRequest extends Schema.TaggedError<UserStateBadRequest>()(
	"UserStateBadRequest",
	{ reason: UserStateBadRequestReason },
) {}

export class UserStateNotFound extends Schema.TaggedError<UserStateNotFound>()(
	"UserStateNotFound",
	{ reason: UserStateNotFoundReason },
) {}

export const ClearUserStateResponse = Schema.Struct({
	entityId: EntityId,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

export type ClearUserStateResponse = typeof ClearUserStateResponse.Type;

export const MergeUserStateBody = Schema.Struct({ mergeFrom: EntityId, mergeInto: EntityId });

export type MergeUserStateBody = typeof MergeUserStateBody.Type;

export const MergeUserStateResponse = Schema.Struct({
	mergeFrom: EntityId,
	mergeInto: EntityId,
	movedEventsCount: Schema.Number,
	movedRelationshipsCount: Schema.Number,
});

export type MergeUserStateResponse = typeof MergeUserStateResponse.Type;
