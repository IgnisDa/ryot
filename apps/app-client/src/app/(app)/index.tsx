import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useAuthClient } from "@/lib/auth";

export default function AppHome() {
	const client = useAuthClient();
	const { data: session } = client.useSession();

	async function handleSignOut() {
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<View className="flex-1 items-center justify-center bg-bg px-6">
			<View className="w-full max-w-md gap-5 rounded-xl border border-border bg-surface p-6">
				<Text className="font-display-semibold text-3xl text-text">You're in.</Text>
				<Text className="font-ui text-base leading-6 text-text-muted">
					Signed in as {session?.user.email}. The library tracer bullet comes next.
				</Text>
				<Pressable accessibilityRole="button" onPress={() => void handleSignOut()}>
					<Text className="font-ui-medium text-accent-text">Sign out</Text>
				</Pressable>
			</View>
		</View>
	);
}
