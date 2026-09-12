import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import type { NotificationChannelsResult } from "@ryot-app/ryotql-recipes/notification-channels";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import {
	NOTIFICATION_CHANNELS_LOAD_ERROR,
	NotificationChannelsView,
	type NotificationChannelListState,
} from "#/modules/notifications/channels-view";
import { NotificationChannelCreateWizard } from "#/modules/notifications/create-wizard";
import { enabledNotificationChannelCount } from "#/modules/notifications/presentation";
import {
	NOTIFICATION_CHANNELS_PAGE_SIZE,
	deleteNotificationChannelMutation,
	notificationChannelsQuery,
	notificationSmtpEnabledQuery,
	testNotificationChannelsMutation,
	updateNotificationChannelMutation,
} from "#/modules/notifications/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";
import { useLatestListState } from "#/modules/ui/use-latest-defined";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

const listState = (page: NotificationChannelsResult): NotificationChannelListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", channels: page.items, hasMore: page.pageInfo.hasMore };

const testedChannelsDetail = (enabledCount: number) =>
	enabledCount === 1
		? "Test notification queued for 1 enabled channel."
		: `Test notification queued for ${enabledCount} enabled channels.`;

export const Route = createFileRoute("/_authenticated/settings/notification-channels")({
	component: NotificationChannelsRoute,
	validateSearch: (search) => ({
		create: search.create === true || search.create === "true" ? true : undefined,
	}),
});

function NotificationChannelsFrame(props: { readonly children: ReactNode }) {
	return (
		<SettingsFrame backFallbackHref="/settings" title="Notification channels">
			{props.children}
		</SettingsFrame>
	);
}

function NotificationChannelsRoute() {
	const { server, runtime } = Route.useRouteContext();
	const isDemoProtected = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const [testDetail, setTestDetail] = useState<string | undefined>();
	const [testSucceeded, setTestSucceeded] = useState(false);
	const [deleteFailedId, setDeleteFailedId] = useState<string | undefined>();
	const [pendingChannelId, setPendingChannelId] = useState<string | undefined>();
	const [limit, setLimit] = useState(NOTIFICATION_CHANNELS_PAGE_SIZE);
	const listed = useRyotQuery(notificationChannelsQuery, limit);
	const smtpEnabled = useRyotQuery(notificationSmtpEnabledQuery);
	const state = useLatestListState(listed, listState);
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const sendTestMutation = useRyotMutation(testNotificationChannelsMutation);
	const updateMutation = useRyotMutation(updateNotificationChannelMutation);
	const deleteMutation = useRyotMutation(deleteNotificationChannelMutation);

	const enabledCount =
		state?.status === "ready" ? enabledNotificationChannelCount(state.channels) : 0;

	/** Delivery is enqueued and the endpoint returns at once, so "queued" is all that can be said. */
	const sendTest = async () => {
		setTestDetail(undefined);
		setTestSucceeded(false);
		const queued = await sendTestMutation
			.mutateAsync()
			.then(() => true)
			.catch(() => false);
		setTestSucceeded(queued);
		setTestDetail(
			queued
				? testedChannelsDetail(enabledCount)
				: "The test notification could not be sent. Try again.",
		);
	};

	const toggleChannel = async (id: string, isDisabled: boolean) => {
		setPendingChannelId(id);
		setTestDetail(undefined);
		setDeleteFailedId(undefined);
		await updateMutation.mutateAsync({ id, isDisabled }).catch(() => undefined);
		setPendingChannelId(undefined);
	};

	const deleteChannel = async (id: string) => {
		setPendingChannelId(id);
		setDeleteFailedId(undefined);
		const removed = await deleteMutation
			.mutateAsync(id)
			.then(() => true)
			.catch(() => false);
		setPendingChannelId(undefined);
		if (!removed) {
			setDeleteFailedId(id);
			return;
		}
		setTestDetail(undefined);
	};

	const wizard = useSearchParamModal({
		isOpen: create === true,
		open: () => void navigate({ search: { create: true } }),
		onCompleted: () => setLimit(NOTIFICATION_CHANNELS_PAGE_SIZE),
		close: () => void navigate({ replace: true, search: { create: undefined } }),
	});

	if (state === undefined || smtpEnabled.data === undefined) {
		return listed.isError ? (
			<NotificationChannelsLoadError onRetry={listed.refetch} />
		) : (
			<NotificationChannelsPending />
		);
	}

	return (
		<NotificationChannelsFrame>
			<NotificationChannelsView
				state={state}
				nowMs={nowMs}
				onAdd={wizard.open}
				testDetail={testDetail}
				onRetry={listed.refetch}
				enabledCount={enabledCount}
				testSucceeded={testSucceeded}
				deleteFailedId={deleteFailedId}
				isDemoProtected={isDemoProtected}
				onSendTest={() => void sendTest()}
				pendingChannelId={pendingChannelId}
				isTesting={sendTestMutation.isPending}
				onDelete={(id) => void deleteChannel(id)}
				onToggle={(id, isDisabled) => void toggleChannel(id, isDisabled)}
				isLoadingMore={listed.isFetching && limit > NOTIFICATION_CHANNELS_PAGE_SIZE}
				onShowMore={() => setLimit((current) => current + NOTIFICATION_CHANNELS_PAGE_SIZE)}
			/>
			{create === true && !isDemoProtected && (
				<NotificationChannelCreateWizard
					onClose={wizard.close}
					smtpEnabled={smtpEnabled.data}
					onCreated={wizard.markCompleted}
				/>
			)}
		</NotificationChannelsFrame>
	);
}

function NotificationChannelsPending() {
	return (
		<NotificationChannelsFrame>
			<StatusState className="py-16" detail="Loading your notification channels..." />
		</NotificationChannelsFrame>
	);
}

function NotificationChannelsLoadError(props: { readonly onRetry: () => void }) {
	return (
		<NotificationChannelsFrame>
			<LoadErrorState
				onRetry={props.onRetry}
				title={NOTIFICATION_CHANNELS_LOAD_ERROR.title}
				detail={NOTIFICATION_CHANNELS_LOAD_ERROR.detail}
			/>
		</NotificationChannelsFrame>
	);
}
