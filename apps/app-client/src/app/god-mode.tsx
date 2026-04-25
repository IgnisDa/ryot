import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { randomUUID } from "expo-crypto";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
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
import { AppButton } from "@/modules/ui/button";
import { AppStatusState } from "@/modules/ui/status-state";

function UserManagement(props: {
	serverUrl: string;
	sessionId: string;
	adminToken: string;
	onUnauthorized: () => void;
}) {
	const onUnauthorized = props.onUnauthorized;
	const scope = {
		serverUrl: props.serverUrl,
		sessionId: props.sessionId,
		adminToken: props.adminToken,
	};
	const usersAtom = godModeUsersAtom(scope);
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
			<AppStatusState
				className="py-12"
				detail="Loading users..."
				icon={<ActivityIndicator accessibilityLabel="Loading users" />}
			/>
		);
	}

	if (AsyncResult.isFailure(users)) {
		return (
			<AppStatusState
				detailTone="danger"
				className="rounded-xl border border-border bg-surface p-6"
				action={<AppButton label="Retry" onPress={refreshUsers} />}
				detail="Could not load users. Check the server and try again."
			/>
		);
	}

	if (!AsyncResult.isSuccess(users)) {
		return null;
	}

	return (
		<GodModeUserList scope={scope} users={users.value.users} onUnauthorized={onUnauthorized} />
	);
}

export default function GodMode() {
	const serverUrl = useServerUrl();
	const insets = useSafeAreaInsets();
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [submittedToken, setSubmittedToken] = useState<{
		token: string;
		sessionId: string;
	} | null>(null);

	function handleSubmit(token: string) {
		setTokenError(null);
		setSubmittedToken({ token, sessionId: randomUUID() });
	}

	function handleUnauthorized() {
		if (serverUrl && submittedToken) {
			clearGodModeSession({
				serverUrl,
				sessionId: submittedToken.sessionId,
			});
		}
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
						error={tokenError}
						onEdit={() => setTokenError(null)}
						onSubmit={handleSubmit}
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
