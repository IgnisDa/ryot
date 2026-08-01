import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from "react-native";

import {
	GodModeSessionProvider,
	useGodModeLock,
	useGodModeSession,
} from "@/modules/god-mode/session";
import { TokenForm } from "@/modules/god-mode/token-form";
import { AppIcon } from "@/modules/icons";
import { useServerUrl } from "@/modules/server/state";

export function GodModeLockButton() {
	const { lock } = useGodModeSession();
	return (
		<Pressable
			accessibilityRole="button"
			onPress={() => lock(null)}
			accessibilityLabel="Lock god mode"
			className="min-h-11 flex-row items-center gap-3 rounded-lg px-3"
		>
			<AppIcon className="text-text-muted" name="logout" size={17} />
			<Text className="font-ui text-sm text-text-muted">Lock god mode</Text>
		</Pressable>
	);
}

export function GodModeGate(props: { readonly children: ReactNode }) {
	const serverUrl = useServerUrl();
	const session = useGodModeLock(serverUrl ?? "");

	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}

	if (session.state.status === "locked") {
		const error = session.state.error;
		return (
			<KeyboardAvoidingView
				className="flex-1 bg-bg"
				behavior={Platform.OS === "ios" ? "padding" : "height"}
			>
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerClassName="flex-grow items-center justify-center px-6 py-10"
				>
					<TokenForm
						error={error}
						onSubmit={session.unlock}
						onEdit={() => {
							if (error !== null) {
								session.lock(null);
							}
						}}
					/>
				</ScrollView>
			</KeyboardAvoidingView>
		);
	}

	return (
		<GodModeSessionProvider
			lock={session.lock}
			serverUrl={serverUrl}
			sessionId={session.state.sessionId}
		>
			{props.children}
		</GodModeSessionProvider>
	);
}
