import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { randomUUID } from "expo-crypto";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clearGodModeSession, godModeUsersAtom } from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import { TokenForm } from "@/modules/god-mode/token-form";
import { GodModeUserList } from "@/modules/god-mode/user-list";
import { useServerUrl } from "@/modules/server/state";

function UserManagement(props: {
	serverUrl: string;
	sessionId: string;
	adminToken: string;
	onUnauthorized: () => void;
}) {
	const onUnauthorized = props.onUnauthorized;
	const usersAtom = godModeUsersAtom(props);
	const users = useAtomValue(usersAtom);
	const refreshUsers = useAtomRefresh(usersAtom);
	const unauthorized = AsyncResult.isFailure(users) && isUnauthorizedCause(users.cause);

	useEffect(() => {
		if (unauthorized) {
			onUnauthorized();
		}
	}, [onUnauthorized, unauthorized]);

	if (unauthorized) {
		return null;
	}

	if (users.waiting) {
		return (
			<View className="items-center gap-2 py-12">
				<ActivityIndicator accessibilityLabel="Loading users" />
				<Text className="font-ui text-sm text-text-muted">Loading users...</Text>
			</View>
		);
	}

	if (AsyncResult.isFailure(users)) {
		return (
			<View className="items-center gap-3 rounded-xl border border-border bg-surface p-6">
				<Text className="text-center font-ui text-sm text-danger">
					Could not load users. Check the server and try again.
				</Text>
				<Pressable
					onPress={refreshUsers}
					accessibilityRole="button"
					className="rounded-lg border border-border-strong px-4 py-2"
				>
					<Text className="font-ui-medium text-sm text-text">Retry</Text>
				</Pressable>
			</View>
		);
	}

	if (!AsyncResult.isSuccess(users)) {
		return null;
	}

	return (
		<GodModeUserList
			users={users.value.users}
			serverUrl={props.serverUrl}
			adminToken={props.adminToken}
			sessionId={props.sessionId}
			onUnauthorized={onUnauthorized}
		/>
	);
}

export default function GodMode() {
	const serverUrl = useServerUrl();
	const insets = useSafeAreaInsets();
	const [token, setToken] = useState("");
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [submittedToken, setSubmittedToken] = useState<{
		token: string;
		sessionId: string;
	} | null>(null);

	function handleSubmit() {
		const submitted = token.trim();
		setTokenError(null);
		setSubmittedToken({ token: submitted, sessionId: randomUUID() });
	}

	function handleUnauthorized() {
		if (serverUrl && submittedToken) {
			clearGodModeSession({
				serverUrl,
				sessionId: submittedToken.sessionId,
			});
		}
		setToken("");
		setSubmittedToken(null);
		setTokenError("That admin access token is invalid.");
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
						error={tokenError}
						onSubmit={handleSubmit}
						onTokenChange={(value) => {
							setToken(value);
							setTokenError(null);
						}}
					/>
				</ScrollView>
			) : (
				<ScrollView contentContainerClassName="w-full max-w-3xl self-center px-4 pb-10">
					<View style={{ paddingTop: insets.top + 16 }} className="gap-1 pb-4">
						<Text className="font-display-semibold text-3xl text-text">God Mode</Text>
						<Text className="font-ui text-sm text-text-muted">Server admin user management</Text>
					</View>
					<UserManagement
						serverUrl={serverUrl}
						adminToken={submittedToken.token}
						onUnauthorized={handleUnauthorized}
						sessionId={submittedToken.sessionId}
					/>
				</ScrollView>
			)}
		</KeyboardAvoidingView>
	);
}
