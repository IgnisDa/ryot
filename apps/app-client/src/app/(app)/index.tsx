import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Cause } from "effect";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppApi } from "@/lib/api";
import { useAuthClient } from "@/lib/auth";

const trackersAtom = AppApi.query("trackers", "list", {
	urlParams: { includeDisabled: false },
});
const notificationChannelsAtom = AppApi.query("notifications", "listChannels", {});

export default function AppHome() {
	const client = useAuthClient();
	const { data: session } = client.useSession();
	const trackers = useAtomValue(trackersAtom);
	const notificationChannels = useAtomValue(notificationChannelsAtom);

	async function handleSignOut() {
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center px-6 py-10">
			<View className="w-full max-w-2xl gap-5">
				<Text className="font-display-semibold text-3xl text-text">You're in.</Text>
				<Text className="font-ui text-base leading-6 text-text-muted">
					Signed in as {session?.user.email}. These responses come from authenticated API requests.
				</Text>

				<View className="gap-3 rounded-xl border border-border bg-surface p-5">
					<Text className="font-ui-semibold text-base text-text">GET /api/trackers</Text>
					{Result.builder(trackers)
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
					{Result.builder(notificationChannels)
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
		</ScrollView>
	);
}
