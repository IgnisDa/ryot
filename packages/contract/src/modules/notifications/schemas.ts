import { Schema } from "effect";

import { NotificationChannelId } from "../../schema/brands";
import { Email, HttpUrl, IsoUtcString } from "../../schema/utils";

const AppriseSpecifics = Schema.Struct({
	baseUrl: HttpUrl,
	key: Schema.String,
	kind: Schema.Literal("apprise"),
});

const DiscordSpecifics = Schema.Struct({ webhookUrl: HttpUrl, kind: Schema.Literal("discord") });

const EmailSpecifics = Schema.Struct({ recipient: Email, kind: Schema.Literal("email") });

const GotifySpecifics = Schema.Struct({
	baseUrl: HttpUrl,
	token: Schema.String,
	kind: Schema.Literal("gotify"),
	priority: Schema.optional(Schema.Int),
});

const NtfySpecifics = Schema.Struct({
	topic: Schema.String,
	kind: Schema.Literal("ntfy"),
	baseUrl: Schema.optional(HttpUrl),
	priority: Schema.optional(Schema.Int),
	accessToken: Schema.optional(Schema.String),
});

const PushBulletSpecifics = Schema.Struct({
	accessToken: Schema.String,
	kind: Schema.Literal("push_bullet"),
});

const PushOverSpecifics = Schema.Struct({
	userKey: Schema.String,
	kind: Schema.Literal("push_over"),
	device: Schema.optional(Schema.String),
	appToken: Schema.optional(Schema.String),
});

const PushSaferSpecifics = Schema.Struct({
	key: Schema.String,
	kind: Schema.Literal("push_safer"),
});

const TelegramSpecifics = Schema.Struct({
	chatId: Schema.String,
	botToken: Schema.String,
	kind: Schema.Literal("telegram"),
});

export const NotificationChannelSpecifics = Schema.Union([
	NtfySpecifics,
	EmailSpecifics,
	GotifySpecifics,
	AppriseSpecifics,
	DiscordSpecifics,
	PushOverSpecifics,
	TelegramSpecifics,
	PushSaferSpecifics,
	PushBulletSpecifics,
]);

export type NotificationChannelSpecifics = typeof NotificationChannelSpecifics.Type;

export const CreateNotificationChannelBody = Schema.Struct({
	isDisabled: Schema.optional(Schema.Boolean),
	channelSpecifics: NotificationChannelSpecifics,
});

export type CreateNotificationChannelBody = typeof CreateNotificationChannelBody.Type;

export const UpdateNotificationChannelBody = Schema.Struct({
	isDisabled: Schema.optional(Schema.Boolean),
});

export type UpdateNotificationChannelBody = typeof UpdateNotificationChannelBody.Type;

export const TestNotificationChannelsBody = Schema.Struct({
	submittedAt: IsoUtcString,
	idempotencyKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
});
export type TestNotificationChannelsBody = typeof TestNotificationChannelsBody.Type;

export class NotificationAdmissionConflictError extends Schema.TaggedError<
	NotificationAdmissionConflictError,
	{ readonly brand: unique symbol }
>()("NotificationAdmissionConflictError", {
	reason: Schema.Struct({ code: Schema.Literal("source-content-conflict") }),
}) {}

export class NotificationAdmissionUnavailableError extends Schema.TaggedError<
	NotificationAdmissionUnavailableError,
	{ readonly brand: unique symbol }
>()("NotificationAdmissionUnavailableError", {
	reason: Schema.Struct({ limit: Schema.Int, code: Schema.Literal("channel-capacity") }),
}) {}

const NotificationNotFoundReason = Schema.Union([
	Schema.Struct({ channelId: NotificationChannelId, code: Schema.Literal("channel-not-found") }),
]);

export class NotificationNotFoundError extends Schema.TaggedError<
	NotificationNotFoundError,
	{ readonly brand: unique symbol }
>()("NotificationNotFoundError", { reason: NotificationNotFoundReason }) {}
