import { DurableQueue } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

const GlobalEntityReferencedPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	executionId: Schema.String,
});

export const GlobalEntityReferencedQueue = DurableQueue.make({
	error: DbError,
	success: Schema.Void,
	name: "GlobalEntityReferencedQueue",
	payload: GlobalEntityReferencedPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
