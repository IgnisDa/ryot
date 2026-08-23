import { Schema } from "effect";

import { NotificationChannelId } from "../../schema/brands";
import { Email, HttpUrl } from "../../schema/utils";
import { NotificationChannelKind } from "./types";

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

export const ListedNotificationChannel = Schema.Struct({
	createdAt: Schema.String,
	updatedAt: Schema.String,
	description: Schema.String,
	id: NotificationChannelId,
	isDisabled: Schema.Boolean,
	channel: NotificationChannelKind,
});

export type ListedNotificationChannel = typeof ListedNotificationChannel.Type;

export const CreateNotificationChannelBody = Schema.Struct({
	channel: NotificationChannelKind,
	channelSpecifics: NotificationChannelSpecifics,
	isDisabled: Schema.optional(Schema.Boolean),
});

export type CreateNotificationChannelBody = typeof CreateNotificationChannelBody.Type;

export const UpdateNotificationChannelBody = Schema.Struct({
	isDisabled: Schema.optional(Schema.Boolean),
});

export type UpdateNotificationChannelBody = typeof UpdateNotificationChannelBody.Type;

const NotificationRequestFailureReason = Schema.Union([
	Schema.Struct({
		channel: NotificationChannelKind,
		specificsKind: NotificationChannelKind,
		code: Schema.Literal("channel-kind-mismatch"),
	}),
]);

const NotificationNotFoundReason = Schema.Union([
	Schema.Struct({ channelId: NotificationChannelId, code: Schema.Literal("channel-not-found") }),
]);

export class NotificationRequestError extends Schema.TaggedError<NotificationRequestError>()(
	"NotificationRequestError",
	{ reason: NotificationRequestFailureReason },
) {}

export class NotificationNotFoundError extends Schema.TaggedError<NotificationNotFoundError>()(
	"NotificationNotFoundError",
	{ reason: NotificationNotFoundReason },
) {}
