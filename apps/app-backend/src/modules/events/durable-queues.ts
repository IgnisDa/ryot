import { DurableQueue } from "@effect/workflow";
import { Schema } from "effect";

import { DbError } from "#lib/errors";
import { EntityId, UserId } from "#lib/schema/brands";

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
