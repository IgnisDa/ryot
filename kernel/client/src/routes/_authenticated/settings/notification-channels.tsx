import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
import { NotificationTestOutcome } from "#/modules/notifications/test-outcome";
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
	page: undefined | NotificationChannelsResult,
	pending: boolean,
): undefined | NotificationChannelListState => {
	if (page !== undefined) {
		return listState(page);
	}
	return pending ? undefined : { status: "failed" };
};

export const Route = createFileRoute("/_authenticated/settings/notification-channels")({
	component: NotificationChannelsRoute,
	validateSearch: (search) => ({
		create: search.create === true || search.create === "true" ? true : undefined,
	}),
});

function NotificationChannelsPending() {
	const t = useT();
	return (
		<NotificationChannelsFrame>
			<StatusState
				className="py-16"
				detail={t(kernelMessage("client.route.settings.notification-channels.loading"))}
			/>
		</NotificationChannelsFrame>
	);
}

function NotificationChannelsFrame(props: { readonly children: ReactNode }) {
	const t = useT();
	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.settings.section.notification-channels"))}
		>
			{props.children}
		</SettingsFrame>
	);
}

function NotificationChannelsLoadError(props: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<NotificationChannelsFrame>
			<LoadErrorState
				onRetry={props.onRetry}
				title={t(NOTIFICATION_CHANNELS_LOAD_ERROR.title)}
				detail={t(NOTIFICATION_CHANNELS_LOAD_ERROR.detail)}
			/>
		</NotificationChannelsFrame>
	);
}

function NotificationChannelsRoute() {
	const t = useT();
	const { server, runtime } = Route.useRouteContext();
	const isDemoProtected = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const [testDetail, setTestDetail] = useState<Message | undefined>();
	const [testSucceeded, setTestSucceeded] = useState(false);
	const [testNotificationId, setTestNotificationId] = useState<string>();
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

	const sendTest = () => {
		setTestDetail(undefined);
		setTestSucceeded(false);
		setTestNotificationId(undefined);
		return Effect.runPromise(
			Effect.gen(function* () {
				const queued = yield* sendTestMutation.mutateEffect().pipe(
					Effect.tap((result) => Effect.sync(() => setTestNotificationId(result.id))),
					Effect.as(true),
					Effect.catchCause(() => Effect.succeed(false)),
				);
				setTestSucceeded(queued);
				setTestDetail(
					queued
						? kernelMessage("client.route.settings.notification-channels.test-queued")
						: kernelMessage("client.route.settings.notification-channels.test-failed"),
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
			{testNotificationId ? <NotificationTestOutcome id={testNotificationId} /> : null}
			<NotificationChannelsView
				state={state}
				nowMs={nowMs}
				onAdd={wizard.open}
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
				testDetail={testDetail === undefined ? undefined : t(testDetail)}
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
