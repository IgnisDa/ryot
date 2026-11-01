import { Schema } from "effect";

import { NotificationChannelId } from "../../schema/brands";
import { NotificationChannelKind } from "./types";

export const NotificationRequest = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("test") }),
	Schema.Struct({ message: Schema.String, kind: Schema.Literal("message") }),
]);
export type NotificationRequest = typeof NotificationRequest.Type;

export const NotificationChannelOutcome = Schema.Literals([
	"accepted",
	"failed",
	"unknown",
	"skipped",
]);
export type NotificationChannelOutcome = typeof NotificationChannelOutcome.Type;

export const NotificationOutcome = Schema.Literals([
	"accepted",
	"partial",
	"failed",
	"unknown",
	"not-sent",
]);
export type NotificationOutcome = typeof NotificationOutcome.Type;

export const NotificationDeliveryReason = Schema.Literals([
	"no-enabled-channels",
	"server-disabled",
	"channel-disabled",
	"channel-deleted",
	"preparation-failed",
	"provider-rejected",
	"delivery-unknown",
	"source-cancelled",
]);
export type NotificationDeliveryReason = typeof NotificationDeliveryReason.Type;

export const NotificationDeliveryResult = Schema.Struct({
	channel: NotificationChannelKind,
	channelId: NotificationChannelId,
	status: Schema.Literals(["queued", "sending", "accepted", "failed", "unknown", "skipped"]),
});
export type NotificationDeliveryResult = typeof NotificationDeliveryResult.Type;
