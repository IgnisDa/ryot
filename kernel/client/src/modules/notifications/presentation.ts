import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";

import { notificationChannelName } from "#/modules/notifications/channel-catalog";
import { formatRelativeTime } from "#/modules/ui/run/run-status";

type NotificationChannelIdentity = {
	readonly createdAt: string;
	readonly isDisabled: boolean;
	readonly description: string;
	readonly channel: NotificationChannelKind;
};

export const notificationChannelStateLabel = (channel: { readonly isDisabled: boolean }) =>
	channel.isDisabled ? "Paused" : "Active";

export const notificationChannelDetail = (channel: NotificationChannelIdentity, nowMs: number) =>
	`${notificationChannelStateLabel(channel)} · ${channel.description} · Added ${formatRelativeTime(channel.createdAt, nowMs)}`;

export const notificationChannelDeleteConfirmation = (channel: NotificationChannelIdentity) =>
	`${notificationChannelName(channel.channel)} will stop receiving notifications and its settings will be removed. You will need to enter them again to add it back.`;

export const enabledNotificationChannelCount = (
	channels: readonly { readonly isDisabled: boolean }[],
) => channels.filter((channel) => !channel.isDisabled).length;
