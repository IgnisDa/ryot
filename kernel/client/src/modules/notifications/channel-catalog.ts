import {
	notificationChannelKinds,
	type NotificationChannelKind,
} from "@ryot-app/contract/modules/notifications/types";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import type { CatalogEntry, CatalogEntryGroup } from "#/modules/ui/catalog/selection";

export const SMTP_REQUIRED_MESSAGE = "SMTP is not configured on this server.";

const GROUPS = {
	chat: { key: "chat", heading: "Chat" },
	email: { key: "email", heading: "Email" },
	relay: { key: "relay", heading: "Relays" },
	push: { key: "push", heading: "Push services" },
} as const satisfies Record<string, CatalogEntryGroup>;

/**
 * Plugin-contributed catalogs receive their `AppSchema` over the wire; channel kinds are static, so
 * the table lives here. Keying it by `NotificationChannelKind` turns a kind added to the contract
 * union into a build error until it is described.
 */
export type NotificationChannelDefinition = {
	readonly name: string;
	readonly badge: string;
	readonly schema: AppSchema;
	readonly description: string;
	readonly group: CatalogEntryGroup;
	readonly slug: NotificationChannelKind;
};

const notificationChannelDefinitions = {
	push_safer: {
		badge: "Push",
		name: "Pushsafer",
		slug: "push_safer",
		group: GROUPS.push,
		description: "Push to your Pushsafer devices.",
		schema: {
			fields: {
				key: {
					position: 1,
					secret: true,
					type: "string",
					label: "Private key",
					validation: { required: true },
					description: "The private or alias key from your Pushsafer dashboard.",
				},
			},
		},
	},
	email: {
		slug: "email",
		name: "Email",
		badge: "SMTP",
		group: GROUPS.email,
		description: "Email you through the SMTP server this Ryot server is configured with.",
		schema: {
			fields: {
				recipient: {
					position: 1,
					type: "string",
					label: "Recipient",
					format: { kind: "email" },
					validation: { required: true },
					description: "The address notifications are sent to.",
				},
			},
		},
	},
	push_bullet: {
		badge: "Push",
		name: "Pushbullet",
		group: GROUPS.push,
		slug: "push_bullet",
		description: "Push to the devices signed in to your Pushbullet account.",
		schema: {
			fields: {
				accessToken: {
					position: 1,
					secret: true,
					type: "string",
					label: "Access token",
					validation: { required: true },
					description: "Create one under Settings, Account, Access Tokens.",
				},
			},
		},
	},
	discord: {
		slug: "discord",
		name: "Discord",
		badge: "Webhook",
		group: GROUPS.chat,
		description: "Post messages into a Discord channel through a webhook.",
		schema: {
			fields: {
				webhookUrl: {
					position: 1,
					type: "string",
					label: "Webhook URL",
					format: { kind: "url" },
					validation: { required: true },
					description: "Create one under Channel settings, Integrations, Webhooks.",
				},
			},
		},
	},
	telegram: {
		badge: "Bot",
		slug: "telegram",
		name: "Telegram",
		group: GROUPS.chat,
		description: "Send messages to a Telegram chat from your own bot.",
		schema: {
			fields: {
				chatId: {
					position: 2,
					type: "string",
					label: "Chat ID",
					validation: { required: true },
					description: "The chat the bot posts to. Your bot must already be in it.",
				},
				botToken: {
					position: 1,
					secret: true,
					type: "string",
					label: "Bot token",
					validation: { required: true },
					description: "The token BotFather gave you when you created the bot.",
				},
			},
		},
	},
	apprise: {
		badge: "Relay",
		slug: "apprise",
		name: "Apprise",
		group: GROUPS.relay,
		description: "Hand off to an Apprise API server, which fans out to everything it knows.",
		schema: {
			fields: {
				key: {
					position: 2,
					secret: true,
					type: "string",
					label: "Configuration key",
					validation: { required: true },
					description: "The Apprise configuration to notify.",
				},
				baseUrl: {
					position: 1,
					type: "string",
					label: "Server URL",
					format: { kind: "url" },
					validation: { required: true },
					description: "Where your Apprise API server is reachable.",
				},
			},
		},
	},
	push_over: {
		badge: "Push",
		name: "Pushover",
		slug: "push_over",
		group: GROUPS.push,
		description: "Push to your Pushover devices.",
		schema: {
			fields: {
				device: {
					position: 3,
					type: "string",
					label: "Device",
					description: "Leave blank to reach every device on your account.",
				},
				userKey: {
					position: 1,
					secret: true,
					type: "string",
					label: "User key",
					validation: { required: true },
					description: "Found on your Pushover dashboard.",
				},
				appToken: {
					position: 2,
					secret: true,
					type: "string",
					label: "Application token",
					description: "Leave blank to send through Ryot's own Pushover application.",
				},
			},
		},
	},
	gotify: {
		badge: "Push",
		slug: "gotify",
		name: "Gotify",
		group: GROUPS.push,
		description: "Send messages to your self-hosted Gotify server.",
		schema: {
			fields: {
				priority: {
					position: 3,
					type: "integer",
					label: "Priority",
					description: "Defaults to 5.",
				},
				baseUrl: {
					position: 1,
					type: "string",
					label: "Server URL",
					format: { kind: "url" },
					validation: { required: true },
					description: "Where your Gotify server is reachable.",
				},
				token: {
					position: 2,
					secret: true,
					type: "string",
					label: "Application token",
					validation: { required: true },
					description: "The token of the Gotify application to post as.",
				},
			},
		},
	},
	ntfy: {
		slug: "ntfy",
		name: "ntfy",
		badge: "Push",
		group: GROUPS.push,
		description: "Publish to an ntfy topic, on ntfy.sh or your own server.",
		schema: {
			fields: {
				priority: {
					position: 4,
					type: "integer",
					label: "Priority",
					description: "1 is lowest and 5 is highest. Defaults to 3.",
				},
				accessToken: {
					position: 3,
					secret: true,
					type: "string",
					label: "Access token",
					description: "Only needed for a protected topic.",
				},
				baseUrl: {
					position: 2,
					type: "string",
					label: "Server URL",
					format: { kind: "url" },
					description: "Leave blank to use https://ntfy.sh.",
				},
				topic: {
					position: 1,
					type: "string",
					label: "Topic",
					validation: { required: true },
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
	(options: { readonly smtpEnabled: boolean }) =>
	(definition: NotificationChannelDefinition): CatalogEntry => {
		const isAvailable = definition.slug !== "email" || options.smtpEnabled;
		return {
			isAvailable,
			slug: definition.slug,
			name: definition.name,
			badge: definition.badge,
			group: definition.group,
			description: definition.description,
			requirement: isAvailable ? undefined : SMTP_REQUIRED_MESSAGE,
		};
	};

export const notificationChannelChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Add ${entry.name}` : `${entry.name} is unavailable`;
