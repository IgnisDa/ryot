import { Schema } from "effect";

import { EntityId, ReminderId } from "../../schema/brands";
import { IsoUtcString } from "../../schema/utils";

export const REMINDER_MESSAGE_MAX_LENGTH = 4000;

export const ReminderState = Schema.Literals([
	"needs-scheduling",
	"scheduled",
	"processing",
	"settled",
	"cancelled",
]);

export type ReminderState = typeof ReminderState.Type;

export const ReminderReason = Schema.Literals([
	"subscription-disabled",
	"formatter-failed",
	"formatter-expired",
	"admission-missing",
	"cancelled",
	"no-enabled-channels",
	"server-disabled",
	"channel-disabled",
	"channel-deleted",
	"preparation-failed",
	"provider-rejected",
	"delivery-unknown",
	"source-cancelled",
]);

export type ReminderReason = typeof ReminderReason.Type;

export const ReminderScheduleEvidence = Schema.Struct({
	mayHaveSent: Schema.Boolean,
	date: Schema.NullOr(Schema.String),
	dueAt: Schema.NullOr(IsoUtcString),
	timezone: Schema.NullOr(Schema.String),
});

export type ReminderScheduleEvidence = typeof ReminderScheduleEvidence.Type;

export const ReminderSubmission = Schema.Struct({
	submittedAt: IsoUtcString,
	idempotencyKey: Schema.NonEmptyString,
});

export type ReminderSubmission = typeof ReminderSubmission.Type;

const ReminderMessage = Schema.String.pipe(
	Schema.check(Schema.isMinLength(1), Schema.isMaxLength(REMINDER_MESSAGE_MAX_LENGTH)),
);

const ReminderRevision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

export const CreateReminderBody = Schema.Struct({
	...ReminderSubmission.fields,
	entityId: EntityId,
	dueAt: IsoUtcString,
	message: ReminderMessage,
	timezone: Schema.NonEmptyString,
	parentEntityId: Schema.NullOr(EntityId),
	replaces: Schema.NullOr(Schema.Struct({ id: ReminderId, revision: ReminderRevision })),
});

export type CreateReminderBody = typeof CreateReminderBody.Type;

export const EditReminderBody = Schema.Struct({
	...ReminderSubmission.fields,
	dueAt: IsoUtcString,
	message: ReminderMessage,
	revision: ReminderRevision,
	timezone: Schema.NonEmptyString,
});

export type EditReminderBody = typeof EditReminderBody.Type;

export const ChangeReminderBody = Schema.Struct({
	...ReminderSubmission.fields,
	revision: ReminderRevision,
});

export type ChangeReminderBody = typeof ChangeReminderBody.Type;

export const ReminderCommandResult = Schema.Struct({
	id: ReminderId,
	revision: ReminderRevision,
	sendStarted: Schema.Boolean,
});

export type ReminderCommandResult = typeof ReminderCommandResult.Type;

export const ReminderDeliveryConfiguration = Schema.Struct({
	scanSchedule: Schema.String,
	deliveryEnabled: Schema.Boolean,
	dispatchersEnabled: Schema.Boolean,
});
export type ReminderDeliveryConfiguration = typeof ReminderDeliveryConfiguration.Type;

export class ReminderNotFound extends Schema.TaggedError<
	ReminderNotFound,
	{ readonly brand: unique symbol }
>()("ReminderNotFound", { id: ReminderId }) {}

export class ReminderConflict extends Schema.TaggedError<
	ReminderConflict,
	{ readonly brand: unique symbol }
>()("ReminderConflict", {
	reason: Schema.Literals(["stale-revision", "submission-content-conflict"]),
}) {}

export class ReminderInvalid extends Schema.TaggedError<
	ReminderInvalid,
	{ readonly brand: unique symbol }
>()("ReminderInvalid", {
	reason: Schema.Literals([
		"invalid-message",
		"invalid-timezone",
		"schedule-not-future",
		"invalid-scope",
		"invalid-state",
	]),
}) {}
