import { Redirect, Stack, useUnstableGlobalHref } from "expo-router";
import { Text, View } from "react-native";

import { useAuthClient } from "@/lib/auth";
import { getGateHref, getSafeRedirectTo } from "@/lib/redirect";
import { useServerUrl } from "@/lib/store/server";

export default function AppLayout() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const currentHref = useUnstableGlobalHref();
	const redirectTo = getSafeRedirectTo(currentHref);
	const { data: session, isPending } = client.useSession();

	if (!serverUrl) {
		return <Redirect href={getGateHref("/onboarding", redirectTo)} />;
	}
	if (isPending) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<Text className="font-ui text-text-muted">Restoring your session...</Text>
			</View>
		);
	}
	if (!session) {
		return <Redirect href={getGateHref("/auth", redirectTo)} />;
	}

	return <Stack screenOptions={{ headerShown: false }} />;
}
