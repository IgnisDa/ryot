import { Redirect, Stack } from "expo-router";
import { Text, View } from "react-native";

import { useAuthClient } from "@/lib/auth";
import { useServerUrl } from "@/lib/store/server";

export default function AppLayout() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const { data: session, isPending } = client.useSession();

	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}
	if (isPending) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<Text className="font-ui text-text-muted">Restoring your session...</Text>
			</View>
		);
	}
	if (!session) {
		return <Redirect href="/auth" />;
	}

	return <Stack screenOptions={{ headerShown: false }} />;
}
