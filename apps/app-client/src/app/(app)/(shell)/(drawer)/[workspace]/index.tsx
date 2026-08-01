import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { decodeNotificationChannelsResponse } from "@ryot/ryotql-recipes/notification-channels";
import { decodeSavedViewRecordsResponse } from "@ryot/ryotql-recipes/saved-view-records";
import clsx from "clsx";
import { Cause, Exit, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { navigationAtom } from "@/modules/navigation/atoms";
import { notificationChannelsAtom } from "@/modules/notifications/atoms";
import { createSavedViewAtom, savedViewsAtom } from "@/modules/saved-views/atoms";

export default function AppHome() {
	const client = useAuthClient();
	const { data: session } = client.useSession();
	const savedViews = useAtomValue(savedViewsAtom);
	const refreshNavigation = useAtomRefresh(navigationAtom);
	const refreshSavedViews = useAtomRefresh(savedViewsAtom);
	const createSavedViewResult = useAtomValue(createSavedViewAtom);
	const notificationChannels = useAtomValue(notificationChannelsAtom);
	const createSavedView = useAtomSet(createSavedViewAtom, { mode: "promiseExit" });
	const decodedNotificationChannels = AsyncResult.isSuccess(notificationChannels)
		? decodeNotificationChannelsResponse(notificationChannels.value)
		: undefined;
	const decodedSavedViews = AsyncResult.isSuccess(savedViews)
		? decodeSavedViewRecordsResponse(savedViews.value)
		: undefined;
	const savedViewTemplate =
		decodedSavedViews && Result.isSuccess(decodedSavedViews)
			? decodedSavedViews.success.items[0]
			: undefined;

	async function handleCreateSavedView() {
		if (!savedViewTemplate) {
			return;
		}

		const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const result = await createSavedView({
			payload: {
				icon: "star",
				name: `Random view ${randomSuffix}`,
				queryDocument: savedViewTemplate.queryDocument,
				displayConfiguration: savedViewTemplate.displayConfiguration,
				...(savedViewTemplate.pluginSlug === null
					? {}
					: { pluginSlug: savedViewTemplate.pluginSlug }),
			},
		});

		if (Exit.isSuccess(result)) {
			refreshNavigation();
			refreshSavedViews();
		}
	}

	async function handleSignOut() {
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<View className="w-full items-center">
			<View className="w-full max-w-2xl gap-5">
				<Text className="font-display-semibold text-3xl text-text">You're in.</Text>
				<Text className="font-ui text-base leading-6 text-text-muted">
					Signed in as {session?.user.email}. These responses come from authenticated API requests.
				</Text>

				<View className="gap-3 rounded-xl border border-border bg-surface p-5">
					<Text className="font-ui-semibold text-base text-text">RyotQL saved-view records</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => void handleCreateSavedView()}
						disabled={!savedViewTemplate || createSavedViewResult.waiting}
						className={clsx(
							"self-start rounded-lg bg-accent px-4 py-2",
							(!savedViewTemplate || createSavedViewResult.waiting) && "opacity-50",
						)}
					>
						<Text className="font-ui-medium text-sm text-accent-ink">
							{createSavedViewResult.waiting ? "Creating..." : "Create random saved view"}
						</Text>
					</Pressable>
					{AsyncResult.isFailure(createSavedViewResult) && (
						<Text selectable className="font-mono text-sm text-danger">
							{Cause.pretty(createSavedViewResult.cause)}
						</Text>
					)}
					{AsyncResult.builder(savedViews)
						.onInitial(() => <Text className="font-ui text-base text-text-muted">Loading...</Text>)
						.onFailure((cause) => (
							<Text selectable className="font-mono text-sm text-danger">
								{JSON.stringify({ error: Cause.pretty(cause) }, null, 2)}
							</Text>
						))
						.onSuccess(() => {
							if (!decodedSavedViews) {
								return null;
							}
							if (Result.isFailure(decodedSavedViews)) {
								return (
									<Text selectable className="font-mono text-sm text-danger">
										{JSON.stringify({ error: String(decodedSavedViews.failure) }, null, 2)}
									</Text>
								);
							}

							return (
								<View className="gap-2">
									<Text className="font-ui text-sm text-text-muted">
										Showing {decodedSavedViews.success.items.length} of{" "}
										{decodedSavedViews.success.pageInfo.total} saved views
									</Text>
									<Text selectable className="font-mono text-sm text-text">
										{JSON.stringify(
											decodedSavedViews.success.items.map((savedView) => ({
												id: savedView.id,
												icon: savedView.icon,
												name: savedView.name,
												slug: savedView.slug,
												isDisabled: savedView.isDisabled,
											})),
											null,
											2,
										)}
									</Text>
								</View>
							);
						})
						.render()}
				</View>

				<View className="gap-3 rounded-xl border border-border bg-surface p-5">
					<Text className="font-ui-semibold text-base text-text">
						RyotQL notification-channel summary
					</Text>
					{AsyncResult.builder(notificationChannels)
						.onInitial(() => <Text className="font-ui text-base text-text-muted">Loading...</Text>)
						.onFailure((cause) => (
							<Text selectable className="font-mono text-sm text-danger">
								{JSON.stringify({ error: Cause.pretty(cause) }, null, 2)}
							</Text>
						))
						.onSuccess(() => {
							if (!decodedNotificationChannels) {
								return null;
							}
							if (Result.isFailure(decodedNotificationChannels)) {
								return (
									<Text selectable className="font-mono text-sm text-danger">
										{JSON.stringify(
											{ error: String(decodedNotificationChannels.failure) },
											null,
											2,
										)}
									</Text>
								);
							}

							return (
								<View className="gap-2">
									<Text className="font-ui text-sm text-text-muted">
										Showing {decodedNotificationChannels.success.items.length} of{" "}
										{decodedNotificationChannels.success.pageInfo.total} notification channels
									</Text>
									<Text selectable className="font-mono text-sm text-text">
										{JSON.stringify(
											decodedNotificationChannels.success.items.map((channel) => ({
												id: channel.id,
												channel: channel.channel,
												isDisabled: channel.isDisabled,
												description: channel.description,
											})),
											null,
											2,
										)}
									</Text>
								</View>
							);
						})
						.render()}
				</View>

				<Pressable accessibilityRole="button" onPress={() => void handleSignOut()}>
					<Text className="font-ui-medium text-base text-accent-text">Sign out</Text>
				</Pressable>
			</View>
		</View>
	);
}
