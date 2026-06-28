import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Redirect, router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { clearAuthStorage, useAuthClient } from "@/modules/auth/client";
import { AuthForm, AuthUnavailable } from "@/modules/auth/form";
import { getGateHref, getRedirectDestination } from "@/modules/navigation/redirect";
import { useSafeRedirectTo } from "@/modules/navigation/use-safe-redirect-to";
import { systemConfigAtom } from "@/modules/server/api";
import { useServerUrl, useSetServerUrl } from "@/modules/server/state";

function AuthLoading() {
	return (
		<View className="flex-1 items-center justify-center bg-bg px-6">
			<Text className="font-ui text-text-muted">Checking your server...</Text>
		</View>
	);
}

export default function Auth() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const redirectTo = useSafeRedirectTo();
	const setServerUrl = useSetServerUrl();

	const config = useAtomValue(systemConfigAtom);
	const { data: session, isPending } = client.useSession();
	const refreshConfig = useAtomRefresh(systemConfigAtom);

	async function handleChangeServer() {
		await client.signOut().catch(() => undefined);
		await clearAuthStorage();
		setServerUrl(null);
		router.replace(getGateHref("/onboarding", redirectTo));
	}

	if (!serverUrl) {
		return <Redirect href={getGateHref("/onboarding", redirectTo)} />;
	}
	if (isPending) {
		return <AuthLoading />;
	}
	if (session) {
		return <Redirect href={getRedirectDestination(redirectTo, "/(app)")} />;
	}

	return AsyncResult.builder(config)
		.onInitial(() => <AuthLoading />)
		.onFailure(() => (
			<AuthUnavailable onRetry={refreshConfig} onChangeServer={() => void handleChangeServer()} />
		))
		.onSuccess(({ auth }) => (
			<KeyboardAvoidingView
				className="flex-1 bg-bg"
				behavior={Platform.OS === "ios" ? "padding" : "height"}
			>
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerClassName="flex-grow items-center justify-center px-6 py-10"
				>
					<AuthForm
						config={auth}
						redirectTo={redirectTo}
						onChangeServer={() => void handleChangeServer()}
					/>
				</ScrollView>
			</KeyboardAvoidingView>
		))
		.render();
}
