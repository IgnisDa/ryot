import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { Cause, Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { appQueryClient } from "@/api/query-client";
import { useAuthClient } from "@/modules/auth/client";

const createSavedViewAtom = appQueryClient.mutation("savedViews", "create");
const notificationChannelsAtom = appQueryClient.query("notifications", "listChannels", {});
const savedViewsAtom = appQueryClient.query("savedViews", "list", {
	query: { includeDisabled: true },
});

export default function AppHome() {
	const client = useAuthClient();
	const { data: session } = client.useSession();
	const savedViews = useAtomValue(savedViewsAtom);
	const refreshSavedViews = useAtomRefresh(savedViewsAtom);
	const createSavedViewResult = useAtomValue(createSavedViewAtom);
	const notificationChannels = useAtomValue(notificationChannelsAtom);
	const createSavedView = useAtomSet(createSavedViewAtom, { mode: "promiseExit" });
	const savedViewTemplate = AsyncResult.isSuccess(savedViews) ? savedViews.value[0] : undefined;

	async function handleCreateSavedView() {
		if (!savedViewTemplate) {
			return;
		}

		const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const accentColor = `#${Math.floor(Math.random() * 0xffffff)
			.toString(16)
			.padStart(6, "0")}`;
		const result = await createSavedView({
			payload: {
				accentColor,
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
					<Text className="font-ui-semibold text-base text-text">GET /api/saved-views</Text>
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
						.onInitial(() => <Text className="font-ui text-text-muted">Loading...</Text>)
						.onFailure((cause) => (
							<Text selectable className="font-mono text-sm text-danger">
								{JSON.stringify({ error: Cause.pretty(cause) }, null, 2)}
							</Text>
						))
						.onSuccess((response) => (
							<Text selectable className="font-mono text-sm text-text">
								{JSON.stringify(response, null, 2)}
							</Text>
						))
						.render()}
				</View>

				<View className="gap-3 rounded-xl border border-border bg-surface p-5">
					<Text className="font-ui-semibold text-base text-text">
						GET /api/notifications/channels
					</Text>
					{AsyncResult.builder(notificationChannels)
						.onInitial(() => <Text className="font-ui text-text-muted">Loading...</Text>)
						.onFailure((cause) => (
							<Text selectable className="font-mono text-sm text-danger">
								{JSON.stringify({ error: Cause.pretty(cause) }, null, 2)}
							</Text>
						))
						.onSuccess((response) => (
							<Text selectable className="font-mono text-sm text-text">
								{JSON.stringify(response, null, 2)}
							</Text>
						))
						.render()}
				</View>

				<Pressable accessibilityRole="button" onPress={() => void handleSignOut()}>
					<Text className="font-ui-medium text-accent-text">Sign out</Text>
				</Pressable>
			</View>
		</View>
	);
}
