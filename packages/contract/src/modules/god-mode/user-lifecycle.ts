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
	error: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	resetResult: Schema.NullOr(UserResetResult),
});
export type UserLifecycleOperation = typeof UserLifecycleOperation.Type;
