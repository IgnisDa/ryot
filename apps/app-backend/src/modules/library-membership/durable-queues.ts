import { DurableQueue } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

const EnsureLibraryMembershipPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	executionId: Schema.String,
});

export const EnsureLibraryMembershipQueue = DurableQueue.make({
	error: DbError,
	success: Schema.Void,
	name: "EnsureLibraryMembershipQueue",
	payload: EnsureLibraryMembershipPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
