import { DurableQueue } from "@effect/workflow";
import { Schema } from "effect";

import { DbError } from "#lib/errors";
import { TrackerId, UserId } from "#lib/schema/brands";

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
