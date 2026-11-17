import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import { notificationChannelName } from "#/modules/notifications/channel-catalog";
import { formatRelativeTime } from "#/modules/ui/run/run-status";

type Translate = (message: Message) => Text;

type NotificationChannelIdentity = {
	readonly createdAt: string;
	readonly isDisabled: boolean;
	readonly description: string;
	readonly channel: NotificationChannelKind;
};

export const notificationChannelStateLabel = (channel: { readonly isDisabled: boolean }) =>
	kernelMessage(
		channel.isDisabled ? "client.notifications.state.paused" : "client.notifications.state.active",
	);

export const notificationChannelDetail = (
	t: Translate,
	formatters: Formatters,
	channel: NotificationChannelIdentity,
	nowMs: number,
) =>
	t(
		kernelMessage("client.notifications.detail", {
			description: channel.description,
			state: notificationChannelStateLabel(channel),
			relative: formatRelativeTime(formatters, t, channel.createdAt, nowMs),
		}),
	);

export const notificationChannelDeleteConfirmation = (
	t: Translate,
	channel: NotificationChannelIdentity,
) =>
	t(
		kernelMessage("client.notifications.delete-confirmation", {
			name: formatDisplayText(t, notificationChannelName(channel.channel)),
		}),
	);

export const enabledNotificationChannelCount = (
	channels: readonly { readonly isDisabled: boolean }[],
) => channels.filter((channel) => !channel.isDisabled).length;
