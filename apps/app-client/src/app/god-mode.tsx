import { Redirect } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { sampleGodModeUsers } from "@/modules/god-mode/sample-users";
import { TokenForm } from "@/modules/god-mode/token-form";
import { GodModeUserList } from "@/modules/god-mode/user-list";
import { useServerUrl } from "@/modules/server/state";

export default function GodMode() {
	const serverUrl = useServerUrl();
	const insets = useSafeAreaInsets();
	const [token, setToken] = useState("");
	const [users, setUsers] = useState(sampleGodModeUsers);
	const [submittedToken, setSubmittedToken] = useState<string | null>(null);

	function handleToggleDisabled(userId: string) {
		// TODO: Replace with godMode.setUserDisabled once the admin API is wired up.
		setUsers((current) =>
			current.map((user) =>
				user.id === userId
					? { ...user, disabledAt: user.disabledAt ? null : new Date().toISOString() }
					: user,
			),
		);
	}

	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}

	return (
		<KeyboardAvoidingView
			className="flex-1 bg-bg"
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			{submittedToken === null ? (
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerClassName="flex-grow items-center justify-center px-6 py-10"
				>
					<TokenForm
						token={token}
						onTokenChange={setToken}
						onSubmit={() => setSubmittedToken(token)}
					/>
				</ScrollView>
			) : (
				<ScrollView contentContainerClassName="w-full max-w-3xl self-center px-4 pb-10">
					<View style={{ paddingTop: insets.top + 16 }} className="gap-1 pb-4">
						<Text className="font-display-semibold text-3xl text-text">God Mode</Text>
						<Text className="font-ui text-sm text-text-muted">Server admin user management</Text>
					</View>
					<GodModeUserList
						users={users}
						serverUrl={serverUrl}
						onToggleDisabled={handleToggleDisabled}
					/>
				</ScrollView>
			)}
		</KeyboardAvoidingView>
	);
}
