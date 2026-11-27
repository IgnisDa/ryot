import {
	type NotificationChannelKind,
	notificationChannelKinds,
} from "@ryot-app/contract/modules/notifications/types";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { DisplayText, Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import type { CatalogEntry, CatalogEntryGroup } from "#/modules/ui/catalog/selection";

const SMTP_REQUIRED_MESSAGE = kernelMessage("client.notifications.smtp-required");

type ChannelGroup = { readonly key: string; readonly heading: Message };

const GROUPS = {
	chat: { key: "chat", heading: kernelMessage("client.notifications.group.chat") },
	push: { key: "push", heading: kernelMessage("client.notifications.group.push") },
	email: { key: "email", heading: kernelMessage("client.notifications.group.email") },
	relay: { key: "relay", heading: kernelMessage("client.notifications.group.relay") },
} as const satisfies Record<string, ChannelGroup>;

/**
 * Plugin-contributed catalogs receive their `AppSchema` over the wire; channel kinds are static, so
 * the table lives here.
 * Keying it by `NotificationChannelKind` turns a kind added to the contract union into a build error
 * until it is described.
 */
export type NotificationChannelDefinition = {
	readonly badge: Message;
	readonly schema: AppSchema;
	readonly name: DisplayText;
	readonly group: ChannelGroup;
	readonly description: Message;
	readonly slug: NotificationChannelKind;
};

const notificationChannelDefinitions = {
	push_safer: {
		name: "Pushsafer",
		slug: "push_safer",
		group: GROUPS.push,
		badge: kernelMessage("client.notifications.badge.push"),
		description: kernelMessage("client.notifications.channel.push-safer.description"),
		schema: {
			fields: {
				key: {
					position: 1,
					secret: true,
					type: "string",
					validation: { required: true },
					label: kernelMessage("client.notifications.field.private-key"),
					description: "The private or alias key from your Pushsafer dashboard.",
					hint: kernelMessage("client.notifications.channel.push-safer.key-help"),
				},
			},
		},
	},
	discord: {
		slug: "discord",
		name: "Discord",
		group: GROUPS.chat,
		badge: kernelMessage("client.notifications.badge.webhook"),
		description: kernelMessage("client.notifications.channel.discord.description"),
		schema: {
			fields: {
				webhookUrl: {
					position: 1,
					type: "string",
					format: { kind: "url" },
					validation: { required: true },
					label: kernelMessage("client.notifications.field.webhook-url"),
					description: "Create one under Channel settings, Integrations, Webhooks.",
					hint: kernelMessage("client.notifications.channel.discord.webhook-url-help"),
				},
			},
		},
	},
	push_bullet: {
		name: "Pushbullet",
		group: GROUPS.push,
		slug: "push_bullet",
		badge: kernelMessage("client.notifications.badge.push"),
		description: kernelMessage("client.notifications.channel.push-bullet.description"),
		schema: {
			fields: {
				accessToken: {
					position: 1,
					secret: true,
					type: "string",
					validation: { required: true },
					label: kernelMessage("client.notifications.field.access-token"),
					description: "Create one under Settings, Account, Access Tokens.",
					hint: kernelMessage("client.notifications.channel.push-bullet.access-token-help"),
				},
			},
		},
	},
	email: {
		slug: "email",
		group: GROUPS.email,
		badge: kernelMessage("client.notifications.badge.smtp"),
		name: kernelMessage("client.notifications.channel.email.name"),
		description: kernelMessage("client.notifications.channel.email.description"),
		schema: {
			fields: {
				recipient: {
					position: 1,
					type: "string",
					format: { kind: "email" },
					validation: { required: true },
					description: "The address notifications are sent to.",
					label: kernelMessage("client.notifications.field.recipient"),
					hint: kernelMessage("client.notifications.channel.email.recipient-help"),
				},
			},
		},
	},
	apprise: {
		slug: "apprise",
		name: "Apprise",
		group: GROUPS.relay,
		badge: kernelMessage("client.notifications.badge.relay"),
		description: kernelMessage("client.notifications.channel.apprise.description"),
		schema: {
			fields: {
				key: {
					position: 2,
					secret: true,
					type: "string",
					validation: { required: true },
					description: "The Apprise configuration to notify.",
					label: kernelMessage("client.notifications.field.configuration-key"),
					hint: kernelMessage("client.notifications.channel.apprise.key-help"),
				},
				baseUrl: {
					position: 1,
					type: "string",
					format: { kind: "url" },
					validation: { required: true },
					description: "Where your Apprise API server is reachable.",
					label: kernelMessage("client.notifications.field.server-url"),
					hint: kernelMessage("client.notifications.channel.apprise.base-url-help"),
				},
			},
		},
	},
	gotify: {
		slug: "gotify",
		name: "Gotify",
		group: GROUPS.push,
		badge: kernelMessage("client.notifications.badge.push"),
		description: kernelMessage("client.notifications.channel.gotify.description"),
		schema: {
			fields: {
				priority: {
					position: 3,
					type: "integer",
					description: "Defaults to 5.",
					label: kernelMessage("client.notifications.field.priority"),
					hint: kernelMessage("client.notifications.channel.gotify.priority-help"),
				},
				token: {
					position: 2,
					secret: true,
					type: "string",
					validation: { required: true },
					description: "The token of the Gotify application to post as.",
					label: kernelMessage("client.notifications.field.application-token"),
					hint: kernelMessage("client.notifications.channel.gotify.token-help"),
				},
				baseUrl: {
					position: 1,
					type: "string",
					format: { kind: "url" },
					validation: { required: true },
					description: "Where your Gotify server is reachable.",
					label: kernelMessage("client.notifications.field.server-url"),
					hint: kernelMessage("client.notifications.channel.gotify.base-url-help"),
				},
			},
		},
	},
	push_over: {
		name: "Pushover",
		slug: "push_over",
		group: GROUPS.push,
		badge: kernelMessage("client.notifications.badge.push"),
		description: kernelMessage("client.notifications.channel.push-over.description"),
		schema: {
			fields: {
				device: {
					position: 3,
					type: "string",
					label: kernelMessage("client.notifications.field.device"),
					description: "Leave blank to reach every device on your account.",
					hint: kernelMessage("client.notifications.channel.push-over.device-help"),
				},
				userKey: {
					position: 1,
					secret: true,
					type: "string",
					validation: { required: true },
					description: "Found on your Pushover dashboard.",
					label: kernelMessage("client.notifications.field.user-key"),
					hint: kernelMessage("client.notifications.channel.push-over.user-key-help"),
				},
				appToken: {
					position: 2,
					secret: true,
					type: "string",
					label: kernelMessage("client.notifications.field.application-token"),
					description: "Leave blank to send through Ryot's own Pushover application.",
					hint: kernelMessage("client.notifications.channel.push-over.app-token-help"),
				},
			},
		},
	},
	telegram: {
		slug: "telegram",
		name: "Telegram",
		group: GROUPS.chat,
		badge: kernelMessage("client.notifications.badge.bot"),
		description: kernelMessage("client.notifications.channel.telegram.description"),
		schema: {
			fields: {
				messageThreadId: {
					position: 3,
					type: "integer",
					validation: { minimum: 1 },
					description: "The ID of the Telegram topic to post to.",
					label: kernelMessage("client.notifications.field.topic-id"),
					hint: kernelMessage("client.notifications.channel.telegram.topic-id-help"),
				},
				chatId: {
					position: 2,
					type: "string",
					validation: { required: true },
					label: kernelMessage("client.notifications.field.chat-id"),
					hint: kernelMessage("client.notifications.channel.telegram.chat-id-help"),
					description: "The chat the bot posts to. Your bot must already be in it.",
				},
				botToken: {
					position: 1,
					secret: true,
					type: "string",
					validation: { required: true },
					label: kernelMessage("client.notifications.field.bot-token"),
					description: "The token BotFather gave you when you created the bot.",
					hint: kernelMessage("client.notifications.channel.telegram.bot-token-help"),
				},
			},
		},
	},
	ntfy: {
		slug: "ntfy",
		name: "ntfy",
		group: GROUPS.push,
		badge: kernelMessage("client.notifications.badge.push"),
		description: kernelMessage("client.notifications.channel.ntfy.description"),
		schema: {
			fields: {
				priority: {
					position: 4,
					type: "integer",
					label: kernelMessage("client.notifications.field.priority"),
					description: "1 is lowest and 5 is highest. Defaults to 3.",
					hint: kernelMessage("client.notifications.channel.ntfy.priority-help"),
				},
				accessToken: {
					position: 3,
					secret: true,
					type: "string",
					description: "Only needed for a protected topic.",
					label: kernelMessage("client.notifications.field.access-token"),
					hint: kernelMessage("client.notifications.channel.ntfy.access-token-help"),
				},
				baseUrl: {
					position: 2,
					type: "string",
					format: { kind: "url" },
					description: "Leave blank to use https://ntfy.sh.",
					label: kernelMessage("client.notifications.field.server-url"),
					hint: kernelMessage("client.notifications.channel.ntfy.base-url-help"),
				},
				topic: {
					position: 1,
					type: "string",
					validation: { required: true },
					label: kernelMessage("client.notifications.field.topic"),
					hint: kernelMessage("client.notifications.channel.ntfy.topic-help"),
					description: "The topic to publish to. Anyone who knows it can read it.",
				},
			},
		},
	},
} as const satisfies Record<NotificationChannelKind, NotificationChannelDefinition>;

export const notificationChannelDefinition = (
	kind: NotificationChannelKind,
): NotificationChannelDefinition => notificationChannelDefinitions[kind];

export const notificationChannelName = (kind: NotificationChannelKind) =>
	notificationChannelDefinition(kind).name;

export const notificationChannelList: readonly NotificationChannelDefinition[] =
	notificationChannelKinds.map(notificationChannelDefinition);

export const notificationChannelEntry =
	(options: { readonly smtpEnabled: boolean; readonly t: (message: Message) => Text }) =>
	(definition: NotificationChannelDefinition): CatalogEntry => {
		const { t } = options;
		const isAvailable = definition.slug !== "email" || options.smtpEnabled;
		const group: CatalogEntryGroup = {
			key: definition.group.key,
			heading: t(definition.group.heading),
		};
		return {
			group,
			isAvailable,
			key: definition.slug,
			badge: t(definition.badge),
			description: t(definition.description),
			name: formatDisplayText(t, definition.name),
			requirement: isAvailable ? undefined : t(SMTP_REQUIRED_MESSAGE),
		};
	};

export const notificationChannelChooseLabel = (
	t: (message: Message) => Text,
	entry: CatalogEntry,
) =>
	t(
		kernelMessage(
			entry.isAvailable ? "client.notifications.choose-channel" : "client.ui.wizard.unavailable",
			{ name: entry.name },
		),
	);
