import {
	type NotificationChannelOutcome,
	type NotificationOutcome,
	NotificationRequest,
} from "@ryot-app/contract/modules/notifications/delivery";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const NOTIFICATION_BATCH_SIZE = 50;
export const NOTIFICATION_CHANNEL_LIMIT = 200;
export const NOTIFICATION_RECOVERY_PAGE_LIMIT = 10;
export const NOTIFICATION_ATTEMPT_TIMEOUT_MS = 15_000;
export const NOTIFICATION_ABANDONED_AFTER_MS = 60_000;

export const NotificationAdmission = Schema.Struct({
	userId: UserId,
	sourceKey: Schema.String,
	request: NotificationRequest,
	accountGeneration: AccountGeneration,
	sourceRunId: Schema.NullOr(Schema.String),
	sourceSubmittedAt: Schema.NullOr(Schema.String),
});
export type NotificationAdmission = typeof NotificationAdmission.Type;

export const summarizeNotification = (
	statuses: ReadonlyArray<NotificationChannelOutcome>,
): NotificationOutcome => {
	if (statuses.includes("unknown")) {
		return "unknown";
	}
	if (statuses.every((status) => status === "skipped")) {
		return "not-sent";
	}
	if (statuses.every((status) => status === "accepted")) {
		return "accepted";
	}
	if (statuses.includes("accepted")) {
		return "partial";
	}
	return "failed";
};
