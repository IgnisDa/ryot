import { Schema } from "effect";

import { UserId } from "../../schema/brands";

export const UserLifecycleOperationKind = Schema.Literals(["delete", "reset"]);
export type UserLifecycleOperationKind = typeof UserLifecycleOperationKind.Type;

export const UserLifecycleOperationStatus = Schema.Literals([
	"pending",
	"running",
	"completed",
	"failed",
]);
export type UserLifecycleOperationStatus = typeof UserLifecycleOperationStatus.Type;

export const UserLifecycleOperationFailure = Schema.Union([
	Schema.Struct({ code: Schema.Literal("operation-start-failed") }),
	Schema.Struct({ code: Schema.Literal("object-cleanup-failed") }),
	Schema.Struct({ code: Schema.Literal("database-cleanup-failed") }),
	Schema.Struct({ code: Schema.Literal("reset-user-recreation-failed") }),
	Schema.Struct({ code: Schema.Literal("operation-completion-failed") }),
]);
export type UserLifecycleOperationFailure = typeof UserLifecycleOperationFailure.Type;

export const UserResetResult = Schema.Struct({
	userId: UserId,
	email: Schema.String,
	resetUrl: Schema.NullOr(Schema.String),
});
export type UserResetResult = typeof UserResetResult.Type;

export const UserLifecycleOperation = Schema.Struct({
	userId: UserId,
	id: Schema.String,
	createdAt: Schema.String,
	kind: UserLifecycleOperationKind,
	status: UserLifecycleOperationStatus,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	resetResult: Schema.NullOr(UserResetResult),
	failure: Schema.NullOr(UserLifecycleOperationFailure),
});
export type UserLifecycleOperation = typeof UserLifecycleOperation.Type;
