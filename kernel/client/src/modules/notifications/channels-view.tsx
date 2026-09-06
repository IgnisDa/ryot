import { Button, StatusMessage, Switch } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { NotificationChannelSummary } from "@ryot-app/ryotql-recipes/notification-channels";
import clsx from "clsx";
import { useRef, useState } from "react";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { notificationChannelName } from "#/modules/notifications/channel-catalog";
import {
	notificationChannelDeleteConfirmation,
	notificationChannelDetail,
} from "#/modules/notifications/presentation";
import { DestructiveConfirmation } from "#/modules/ui/destructive-confirmation";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { StatusState } from "#/modules/ui/status-state";

export const NOTIFICATION_CHANNELS_LOAD_ERROR = {
	title: "Unable to load notification channels",
	detail: "Your notification channels could not be loaded. Check the server and try again.",
};

const INTRO =
	"Ryot sends notifications to every channel you leave enabled here. Automations and integrations use the same channels.";

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
	readonly enabledCount: number;
	readonly onSendTest: () => void;
	readonly testSucceeded: boolean;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly onDelete: (id: string) => void;
	readonly testDetail: string | undefined;
	readonly deleteFailedId: string | undefined;
	readonly state: NotificationChannelListState;
	readonly pendingChannelId: string | undefined;
	readonly isDemoProtected: boolean;
	readonly onToggle: (id: string, isDisabled: boolean) => void;
};

function NotificationChannelRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly isPending: boolean;
	readonly onDelete: () => void;
	readonly deleteFailed: boolean;
	readonly channel: NotificationChannelSummary;
	readonly onToggle: (isDisabled: boolean) => void;
	readonly isDemoProtected: boolean;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [isConfirming, setIsConfirming] = useState(false);
	const name = notificationChannelName(props.channel.channel);

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
					{notificationChannelDetail(props.channel, props.nowMs)}
				</span>
			</span>
			<Switch
				checked={!props.channel.isDisabled}
				onChange={(checked) => props.onToggle(!checked)}
				disabled={props.isPending || props.isDemoProtected}
				label={`${props.channel.isDisabled ? "Enable" : "Pause"} the ${name} channel`}
			/>
			<button
				type="button"
				ref={triggerRef}
				onClick={() => setIsConfirming(true)}
				aria-label={`Delete the ${name} channel`}
				disabled={props.isPending || props.isDemoProtected}
				className="shrink-0 p-1.5 text-text-subtle disabled:opacity-50"
			>
				<AppIcon size={16} name="trash-2" />
			</button>
			{isConfirming && (
				<DestructiveConfirmation
					triggerRef={triggerRef}
					pending={props.isPending}
					onConfirm={props.onDelete}
					pendingLabel="Deleting..."
					actionLabel="Delete channel"
					title={`Delete the ${name} channel?`}
					onClose={() => setIsConfirming(false)}
					detail={notificationChannelDeleteConfirmation(props.channel)}
					errorMessage={
						props.deleteFailed ? "This channel could not be deleted. Try again." : undefined
					}
				/>
			)}
		</div>
	);
}

export function NotificationChannelsView(props: NotificationChannelsViewProps) {
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={NOTIFICATION_CHANNELS_LOAD_ERROR.title}
				detail={NOTIFICATION_CHANNELS_LOAD_ERROR.detail}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">{INTRO}</p>
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
					Add a channel
				</Button>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title="No notification channels yet"
					icon={<AppIcon size={40} name="inbox" className="text-text-subtle" />}
					detail="Add a channel and Ryot can tell you when something in your library changes."
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onAdd}
							disabled={props.isDemoProtected}
							className="w-full sm:w-auto sm:px-6"
						>
							Add a channel
						</Button>
					}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							Channels
						</span>
						<Button
							type="button"
							variant="secondary"
							onClick={props.onSendTest}
							aria-label="Send a test notification to every enabled channel"
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
							disabled={props.isDemoProtected || props.isTesting || props.enabledCount === 0}
						>
							<AppIcon size={14} name="send" className="text-text" />
							{props.isTesting ? "Sending..." : "Send test notification"}
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
						<button
							type="button"
							onClick={props.onShowMore}
							disabled={props.isLoadingMore}
							aria-label="Show more notification channels"
							className={clsx(
								"self-start py-2 text-sm font-medium text-accent-text",
								props.isLoadingMore && "opacity-50",
							)}
						>
							{props.isLoadingMore ? "Loading more..." : "Show more channels"}
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}
