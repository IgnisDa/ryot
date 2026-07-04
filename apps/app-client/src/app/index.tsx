import { Redirect } from "expo-router";
import { Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { useServerUrl } from "@/modules/server/state";

function SessionRedirect() {
	const client = useAuthClient();
	const { data: session, isPending } = client.useSession();

	if (isPending) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<Text className="font-ui text-text-muted">Opening Ryot...</Text>
			</View>
		);
	}

	return <Redirect href={session ? "/(app)" : "/auth"} />;
}

export default function Index() {
	const serverUrl = useServerUrl();
	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}
	return <SessionRedirect />;
}
