import { Schema } from "effect";

export const NotificationChannelKind = Schema.Literals([
	"ntfy",
	"email",
	"gotify",
	"apprise",
	"discord",
	"push_over",
	"push_bullet",
	"push_safer",
	"telegram",
]);

export type NotificationChannelKind = typeof NotificationChannelKind.Type;

export const notificationChannelKinds = NotificationChannelKind.literals;
