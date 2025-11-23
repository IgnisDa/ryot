import { Schema } from "effect";

import { NotificationPlatformId } from "../../schema/brands";
import { Email, HttpUrl } from "../../schema/utils";
import { NotificationEventType, NotificationPlatformKind } from "./types";

const AppriseSpecifics = Schema.Struct({
	baseUrl: HttpUrl,
	key: Schema.String,
	kind: Schema.Literal("apprise"),
});

const DiscordSpecifics = Schema.Struct({
	webhookUrl: HttpUrl,
	kind: Schema.Literal("discord"),
});

const EmailSpecifics = Schema.Struct({
	recipient: Email,
	kind: Schema.Literal("email"),
});

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

export const NotificationPlatformSpecifics = Schema.Union(
	NtfySpecifics,
	EmailSpecifics,
	GotifySpecifics,
	AppriseSpecifics,
	DiscordSpecifics,
	PushOverSpecifics,
	TelegramSpecifics,
	PushSaferSpecifics,
	PushBulletSpecifics,
);

export type NotificationPlatformSpecifics = typeof NotificationPlatformSpecifics.Type;

export const ListedNotificationPlatform = Schema.Struct({
	createdAt: Schema.String,
	updatedAt: Schema.String,
	description: Schema.String,
	id: NotificationPlatformId,
	isDisabled: Schema.Boolean,
	platform: NotificationPlatformKind,
	configuredEvents: Schema.Array(NotificationEventType),
});

export type ListedNotificationPlatform = typeof ListedNotificationPlatform.Type;

export const CreateNotificationPlatformBody = Schema.Struct({
	platform: NotificationPlatformKind,
	platformSpecifics: NotificationPlatformSpecifics,
	isDisabled: Schema.optional(Schema.Boolean),
	configuredEvents: Schema.optional(Schema.Array(NotificationEventType)),
});

export type CreateNotificationPlatformBody = typeof CreateNotificationPlatformBody.Type;

export const UpdateNotificationPlatformBody = Schema.Struct({
	isDisabled: Schema.optional(Schema.Boolean),
	configuredEvents: Schema.optional(Schema.Array(NotificationEventType)),
});

export type UpdateNotificationPlatformBody = typeof UpdateNotificationPlatformBody.Type;
