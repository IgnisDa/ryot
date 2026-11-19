import { formatDisplayText } from "@ryot-app/i18n/format";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	Button,
	DestructiveConfirmation,
	LoadMoreButton,
	StatusMessage,
	Switch,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { NotificationChannelSummary } from "@ryot-app/ryotql-recipes/notification-channels";
import clsx from "clsx";
import { useRef, useState } from "react";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { notificationChannelName } from "#/modules/notifications/channel-catalog";
import {
	notificationChannelDeleteConfirmation,
	notificationChannelDetail,
} from "#/modules/notifications/presentation";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { StatusState } from "#/modules/ui/status-state";

export const NOTIFICATION_CHANNELS_LOAD_ERROR = {
	title: kernelMessage("client.notifications.load-error.title"),
	detail: kernelMessage("client.notifications.load-error.detail"),
};

export type NotificationChannelListState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly channels: readonly NotificationChannelSummary[];
	  };

type NotificationChannelsViewProps = {
	readonly nowMs: number;
	readonly onAdd: () => void;
	readonly isTesting: boolean;
	readonly onRetry: () => void;
	readonly isFetching?: boolean;
	readonly enabledCount: number;
	readonly onSendTest: () => void;
	readonly testSucceeded: boolean;
	readonly onShowMore: () => void;
	readonly isDemoProtected: boolean;
	readonly isFetchingNextPage: boolean;
	readonly onDelete: (id: string) => void;
	readonly testDetail: string | undefined;
	readonly deleteFailedId: string | undefined;
	readonly state: NotificationChannelListState;
	readonly pendingChannelId: string | undefined;
	readonly onToggle: (id: string, isDisabled: boolean) => void;
};

export function NotificationChannelsView(props: NotificationChannelsViewProps) {
	const t = useT();
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={t(NOTIFICATION_CHANNELS_LOAD_ERROR.title)}
				detail={t(NOTIFICATION_CHANNELS_LOAD_ERROR.detail)}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.notifications.intro"))}
			</p>
			{props.isDemoProtected ? <DemoProtectionMessage /> : null}
			{ready === undefined ? null : (
				<Button
					type="button"
					variant="primary"
					onClick={props.onAdd}
					disabled={props.isDemoProtected}
					className="flex w-full items-center justify-center gap-2 sm:w-auto sm:self-start sm:px-6"
				>
					<AppIcon size={16} name="plus" className="text-accent-ink" />
					{t(kernelMessage("client.notifications.add"))}
				</Button>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title={t(kernelMessage("client.notifications.empty.title"))}
					detail={t(kernelMessage("client.notifications.empty.detail"))}
					icon={<AppIcon size={40} name="inbox" className="text-text-subtle" />}
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onAdd}
							disabled={props.isDemoProtected}
							className="w-full sm:w-auto sm:px-6"
						>
							{t(kernelMessage("client.notifications.add"))}
						</Button>
					}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							{t(kernelMessage("client.notifications.channels"))}
						</span>
						<Button
							type="button"
							variant="secondary"
							onClick={props.onSendTest}
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
							aria-label={t(kernelMessage("client.notifications.send-test-aria"))}
							disabled={props.isDemoProtected || props.isTesting || props.enabledCount === 0}
						>
							<AppIcon size={14} name="send" className="text-text" />
							{t(
								props.isTesting
									? kernelMessage("client.notifications.sending")
									: kernelMessage("client.notifications.send-test"),
							)}
						</Button>
					</div>
					{props.testDetail === undefined ? null : (
						<StatusMessage className="text-sm" tone={props.testSucceeded ? "success" : "error"}>
							{props.testDetail}
						</StatusMessage>
					)}
					<div>
						{ready.channels.map((channel, index) => (
							<NotificationChannelRow
								key={channel.id}
								channel={channel}
								nowMs={props.nowMs}
								isFirst={index === 0}
								isDemoProtected={props.isDemoProtected}
								onDelete={() => props.onDelete(channel.id)}
								isPending={props.pendingChannelId === channel.id}
								deleteFailed={props.deleteFailedId === channel.id}
								onToggle={(isDisabled) => props.onToggle(channel.id, isDisabled)}
							/>
						))}
					</div>
					{ready.hasMore ? (
						<LoadMoreButton
							type="button"
							variant="ghost"
							onClick={props.onShowMore}
							disabled={props.isFetching}
							isFetchingNextPage={props.isFetchingNextPage}
							label={t(kernelMessage("client.notifications.show-more"))}
							className="self-start py-2 text-sm font-medium text-accent-text"
							aria-label={t(kernelMessage("client.notifications.show-more-aria"))}
						/>
					) : null}
				</div>
			)}
		</div>
	);
}

function NotificationChannelRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly isPending: boolean;
	readonly onDelete: () => void;
	readonly deleteFailed: boolean;
	readonly isDemoProtected: boolean;
	readonly channel: NotificationChannelSummary;
	readonly onToggle: (isDisabled: boolean) => void;
}) {
	const t = useT();
	const formatters = useFormatters();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [isConfirming, setIsConfirming] = useState(false);
	const name = formatDisplayText(t, notificationChannelName(props.channel.channel));

	return (
		<div
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				props.channel.isDisabled && "opacity-70",
			)}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{name}</span>
				<span className="truncate text-xs text-text-subtle">
					{notificationChannelDetail(t, formatters, props.channel, props.nowMs)}
				</span>
			</span>
			<Switch
				checked={!props.channel.isDisabled}
				onChange={(checked) => props.onToggle(!checked)}
				disabled={props.isPending || props.isDemoProtected}
				label={t(
					props.channel.isDisabled
						? kernelMessage("client.notifications.enable-aria", { name })
						: kernelMessage("client.notifications.pause-aria", { name }),
				)}
			/>
			<button
				type="button"
				ref={triggerRef}
				onClick={() => setIsConfirming(true)}
				disabled={props.isPending || props.isDemoProtected}
				className="shrink-0 p-1.5 text-text-subtle disabled:opacity-50"
				aria-label={t(kernelMessage("client.notifications.delete-aria", { name }))}
			>
				<AppIcon size={16} name="trash-2" />
			</button>
			{isConfirming && (
				<DestructiveConfirmation
					triggerRef={triggerRef}
					pending={props.isPending}
					onConfirm={props.onDelete}
					onClose={() => setIsConfirming(false)}
					pendingLabel={t(kernelMessage("common.status.deleting"))}
					detail={notificationChannelDeleteConfirmation(t, props.channel)}
					actionLabel={t(kernelMessage("client.notifications.delete-action"))}
					title={t(kernelMessage("client.notifications.delete-title", { name }))}
					errorMessage={
						props.deleteFailed ? t(kernelMessage("client.notifications.delete-failed")) : undefined
					}
				/>
			)}
		</div>
	);
}
