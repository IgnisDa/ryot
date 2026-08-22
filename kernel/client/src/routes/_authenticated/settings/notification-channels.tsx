import { useRyot } from "@ryot-app/client-sdk/react";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import type { NotificationChannelsResult } from "@ryot-app/ryotql-recipes/notification-channels";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { NotificationsApi } from "#/api/notifications";
import { PublicApi } from "#/api/public";
import {
	NOTIFICATION_CHANNELS_LOAD_ERROR,
	NotificationChannelsView,
	type NotificationChannelListState,
} from "#/modules/notifications/channels-view";
import { NotificationChannelCreateWizard } from "#/modules/notifications/create-wizard";
import { enabledNotificationChannelCount } from "#/modules/notifications/presentation";
import {
	NOTIFICATION_CHANNELS_PAGE_SIZE,
	NotificationChannelsService,
} from "#/modules/notifications/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";

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
	errorComponent: NotificationChannelsLoadError,
	pendingComponent: NotificationChannelsPending,
	validateSearch: (search) => ({
		create: search.create === true || search.create === "true" ? true : undefined,
	}),
	loader: async ({ abortController, context }) => {
		const [page, smtpEnabled] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(NotificationChannelsService, (service) =>
					service.loadChannels(context.ryot, { limit: NOTIFICATION_CHANNELS_PAGE_SIZE }),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)).pipe(
					Effect.match({
						onFailure: () => false,
						onSuccess: (config) => config.notifications.smtpEnabled,
					}),
				),
				{ signal: abortController.signal },
			),
		]);
		return { page, smtpEnabled };
	},
});

function NotificationChannelsFrame(props: { readonly children: ReactNode }) {
	return (
		<SettingsFrame title="Notification channels" backFallbackHref="/settings">
			{props.children}
		</SettingsFrame>
	);
}

function NotificationChannelsRoute() {
	const ryot = useRyot();
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const loaded = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const controller = useRef(new AbortController());
	const [isTesting, setIsTesting] = useState(false);
	const [testDetail, setTestDetail] = useState<string | undefined>();
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [testSucceeded, setTestSucceeded] = useState(false);
	const [deleteFailedId, setDeleteFailedId] = useState<string | undefined>();
	const [state, setState] = useState(() => listState(loaded.page));
	const [pendingChannelId, setPendingChannelId] = useState<string | undefined>();
	const [limit, setLimit] = useState(NOTIFICATION_CHANNELS_PAGE_SIZE);

	useEffect(() => () => controller.current.abort(), []);

	const enabledCount =
		state.status === "ready" ? enabledNotificationChannelCount(state.channels) : 0;

	const reload = useEffectEvent(async (nextLimit: number) => {
		setIsLoadingMore(nextLimit > limit);
		const outcome = await runtime.runPromise(
			Effect.flatMap(NotificationChannelsService, (service) =>
				service.loadChannels(ryot, { limit: nextLimit }),
			).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (page) => listState(page) })),
			{ signal: controller.current.signal },
		);
		setIsLoadingMore(false);
		setLimit(nextLimit);
		setState(outcome ?? { status: "failed" });
	});

	/** Delivery is enqueued and the endpoint returns at once, so "queued" is all that can be said. */
	const sendTest = useEffectEvent(async () => {
		setIsTesting(true);
		setTestDetail(undefined);
		setTestSucceeded(false);
		const queued = await runtime.runPromise(
			Effect.flatMap(NotificationsApi, (api) => api.testChannels(scope)).pipe(
				Effect.match({ onFailure: () => false, onSuccess: () => true }),
			),
			{ signal: controller.current.signal },
		);
		setIsTesting(false);
		setTestSucceeded(queued);
		setTestDetail(
			queued
				? testedChannelsDetail(enabledCount)
				: "The test notification could not be sent. Try again.",
		);
	});

	const toggleChannel = useEffectEvent(async (id: string, isDisabled: boolean) => {
		setPendingChannelId(id);
		setTestDetail(undefined);
		setDeleteFailedId(undefined);
		await runtime.runPromise(
			Effect.flatMap(NotificationsApi, (api) =>
				api.updateChannel(scope, {
					payload: { isDisabled },
					params: { channelId: NotificationChannelId.make(id) },
				}),
			).pipe(Effect.match({ onFailure: () => undefined, onSuccess: () => undefined })),
			{ signal: controller.current.signal },
		);
		setPendingChannelId(undefined);
		await reload(limit);
	});

	const deleteChannel = useEffectEvent(async (id: string) => {
		setPendingChannelId(id);
		setDeleteFailedId(undefined);
		const removed = await runtime.runPromise(
			Effect.flatMap(NotificationsApi, (api) =>
				api.deleteChannel(scope, { params: { channelId: NotificationChannelId.make(id) } }),
			).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
			{ signal: controller.current.signal },
		);
		setPendingChannelId(undefined);
		if (!removed) {
			setDeleteFailedId(id);
			return;
		}
		setTestDetail(undefined);
		await reload(limit);
	});

	const wizard = useSearchParamModal({
		isOpen: create === true,
		open: () => void navigate({ search: { create: true } }),
		onCompleted: () => void reload(NOTIFICATION_CHANNELS_PAGE_SIZE),
		close: () => void navigate({ replace: true, search: { create: undefined } }),
	});

	return (
		<NotificationChannelsFrame>
			<NotificationChannelsView
				state={state}
				nowMs={Date.now()}
				onAdd={wizard.open}
				isTesting={isTesting}
				testDetail={testDetail}
				enabledCount={enabledCount}
				isLoadingMore={isLoadingMore}
				testSucceeded={testSucceeded}
				deleteFailedId={deleteFailedId}
				onSendTest={() => void sendTest()}
				pendingChannelId={pendingChannelId}
				onDelete={(id) => void deleteChannel(id)}
				onRetry={() => void reload(limit)}
				onToggle={(id, isDisabled) => void toggleChannel(id, isDisabled)}
				onShowMore={() => void reload(limit + NOTIFICATION_CHANNELS_PAGE_SIZE)}
			/>
			{create === true && (
				<NotificationChannelCreateWizard
					onClose={wizard.close}
					onCreated={wizard.markCompleted}
					smtpEnabled={loaded.smtpEnabled}
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

function NotificationChannelsLoadError() {
	const router = useRouter();
	return (
		<NotificationChannelsFrame>
			<LoadErrorState
				onRetry={() => void router.invalidate()}
				title={NOTIFICATION_CHANNELS_LOAD_ERROR.title}
				detail={NOTIFICATION_CHANNELS_LOAD_ERROR.detail}
			/>
		</NotificationChannelsFrame>
	);
}
