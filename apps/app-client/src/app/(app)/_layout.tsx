import { Redirect, Stack, useUnstableGlobalHref } from "expo-router";
import { Text, View } from "react-native";

import { useAuthClient } from "@/lib/auth";
import { getSafeRedirectTo } from "@/lib/redirect";
import { useServerUrl } from "@/lib/store/server";

export default function AppLayout() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const currentHref = useUnstableGlobalHref();
	const { data: session, isPending } = client.useSession();
	const redirectTo = getSafeRedirectTo(currentHref) ?? "/(app)";

	if (!serverUrl) {
		return <Redirect href={{ pathname: "/onboarding", params: { redirectTo } }} />;
	}
	if (isPending) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<Text className="font-ui text-text-muted">Restoring your session...</Text>
			</View>
		);
	}
	if (!session) {
		return <Redirect href={{ pathname: "/auth", params: { redirectTo } }} />;
	}

	return <Stack screenOptions={{ headerShown: false }} />;
}
