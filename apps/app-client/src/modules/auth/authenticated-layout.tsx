import { Redirect, useUnstableGlobalHref } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ApiScopeProvider } from "@/api/scope";
import { useAuthClient } from "@/modules/auth/client";
import { EntityInterestProvider } from "@/modules/entity-interest/provider";
import { getGateHref, getSafeRedirectTo } from "@/modules/navigation/redirect";
import { useServerUrl } from "@/modules/server/state";

export function AuthenticatedLayout(props: { children: ReactNode }) {
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
				<Text className="font-ui text-base text-text-muted">Restoring your session...</Text>
			</View>
		);
	}
	if (!session) {
		return <Redirect href={getGateHref("/auth", redirectTo)} />;
	}

	return (
		<ApiScopeProvider serverUrl={serverUrl} userId={session.user.id}>
			<EntityInterestProvider>{props.children}</EntityInterestProvider>
		</ApiScopeProvider>
	);
}
