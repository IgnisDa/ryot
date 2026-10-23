import {
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import type { NotificationChannelsResult } from "@ryot-app/ryotql-recipes/notification-channels";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import {
	NOTIFICATION_CHANNELS_LOAD_ERROR,
	type NotificationChannelListState,
	NotificationChannelsView,
} from "#/modules/notifications/channels-view";
import { NotificationChannelCreateWizard } from "#/modules/notifications/create-wizard";
import { enabledNotificationChannelCount } from "#/modules/notifications/presentation";
import {
	deleteNotificationChannelMutation,
	NOTIFICATION_CHANNELS_PAGE_SIZE,
	notificationChannelsQuery,
	notificationSmtpEnabledQuery,
	testNotificationChannelsMutation,
	updateNotificationChannelMutation,
} from "#/modules/notifications/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

const listState = (page: NotificationChannelsResult): NotificationChannelListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", channels: page.items, hasMore: page.pageInfo.hasMore };

const queryListState = (
	page: NotificationChannelsResult | undefined,
	pending: boolean,
): NotificationChannelListState | undefined => {
	if (page !== undefined) {
		return listState(page);
	}
	return pending ? undefined : { status: "failed" };
};

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
	const listed = useRyotInfiniteQuery(notificationChannelsQuery, undefined, {
		mode: "replace",
		getPageInput: (_input, limit) => limit,
		initialPageParam: NOTIFICATION_CHANNELS_PAGE_SIZE,
		getNextPageParam: (page, limit) =>
			page.pageInfo.hasMore ? limit + NOTIFICATION_CHANNELS_PAGE_SIZE : null,
	});
	const smtpEnabled = useRyotQuery(notificationSmtpEnabledQuery);
	const state = queryListState(listed.data, listed.isPending);
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const sendTestMutation = useRyotMutation(testNotificationChannelsMutation);
	const updateMutation = useRyotMutation(updateNotificationChannelMutation);
	const deleteMutation = useRyotMutation(deleteNotificationChannelMutation);

	const enabledCount =
		state?.status === "ready" ? enabledNotificationChannelCount(state.channels) : 0;

	/** Delivery is enqueued and the endpoint returns at once, so "queued" is all that can be said. */
	const sendTest = () => {
		setTestDetail(undefined);
		setTestSucceeded(false);
		return Effect.runPromise(
			Effect.gen(function* () {
				const queued = yield* sendTestMutation.mutateEffect().pipe(
					Effect.as(true),
					Effect.catchCause(() => Effect.succeed(false)),
				);
				setTestSucceeded(queued);
				setTestDetail(
					queued
						? testedChannelsDetail(enabledCount)
						: "The test notification could not be sent. Try again.",
				);
			}),
		);
	};

	const toggleChannel = (id: string, isDisabled: boolean) => {
		setPendingChannelId(id);
		setTestDetail(undefined);
		setDeleteFailedId(undefined);
		return Effect.runPromise(
			updateMutation
				.mutateEffect({ id, isDisabled })
				.pipe(
					Effect.ignoreCause,
					Effect.ensuring(Effect.sync(() => setPendingChannelId(undefined))),
				),
		);
	};

	const deleteChannel = (id: string) => {
		setPendingChannelId(id);
		setDeleteFailedId(undefined);
		return Effect.runPromise(
			Effect.gen(function* () {
				const removed = yield* deleteMutation.mutateEffect(id).pipe(
					Effect.as(true),
					Effect.catchCause(() => Effect.succeed(false)),
				);
				setPendingChannelId(undefined);
				if (!removed) {
					setDeleteFailedId(id);
					return;
				}
				setTestDetail(undefined);
			}),
		);
	};

	const wizard = useSearchParamModal({
		isOpen: create === true,
		onCompleted: () => undefined,
		open: () => void navigate({ search: { create: true } }),
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
				isFetching={listed.isFetching}
				deleteFailedId={deleteFailedId}
				isDemoProtected={isDemoProtected}
				onSendTest={() => void sendTest()}
				pendingChannelId={pendingChannelId}
				isTesting={sendTestMutation.isPending}
				onDelete={(id) => void deleteChannel(id)}
				isFetchingNextPage={listed.isFetchingNextPage}
				onToggle={(id, isDisabled) => void toggleChannel(id, isDisabled)}
				onShowMore={() => {
					if (listed.errorOperation === "append") {
						listed.retry();
					} else {
						listed.fetchNextPage();
					}
				}}
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
