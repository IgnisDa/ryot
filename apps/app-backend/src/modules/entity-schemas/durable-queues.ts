import { DurableQueue } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { TrackerId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const CreateDefaultSavedViewPayload = Schema.Struct({
	userId: UserId,
	icon: Schema.String,
	trackerId: TrackerId,
	accentColor: Schema.String,
	executionId: Schema.String,
	entitySchemaName: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type CreateDefaultSavedViewPayload = Schema.Schema.Type<
	typeof CreateDefaultSavedViewPayload
>;

export const DefaultSavedViewQueue = DurableQueue.make({
	error: DbError,
	success: Schema.Void,
	name: "DefaultSavedViewQueue",
	payload: CreateDefaultSavedViewPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
