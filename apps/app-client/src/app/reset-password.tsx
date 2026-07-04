import clsx from "clsx";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { useServerUrl } from "@/modules/server/state";

export default function ResetPassword() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const [done, setDone] = useState(false);
	const confirmRef = useRef<TextInput>(null);
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const { token } = useLocalSearchParams<{ token?: string | string[] }>();

	const resetToken = Array.isArray(token) ? token[0] : token;

	async function handleReset() {
		setError(null);
		if (!resetToken) {
			setError("This reset link is missing its token.");
			return;
		}
		if (password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}
		if (password !== confirmation) {
			setError("Passwords do not match.");
			return;
		}

		setPending(true);
		try {
			const result = await client.resetPassword({ token: resetToken, newPassword: password });
			if (result.error) {
				setError(result.error.message ?? "Could not reset your password.");
				return;
			}
			setDone(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not reset your password.");
		} finally {
			setPending(false);
		}
	}

	if (!resetToken) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<View className="w-full max-w-md items-center gap-4 rounded-xl border border-border bg-surface p-6">
					<Text className="font-display-semibold text-2xl text-text">Invalid reset link</Text>
					<Text className="text-center font-ui text-sm leading-5 text-text-muted">
						This password reset link is missing its token. Ask your administrator for a new link.
					</Text>
					<Pressable accessibilityRole="button" onPress={() => router.replace("/auth")}>
						<Text className="font-ui-medium text-accent-text">Back to sign in</Text>
					</Pressable>
				</View>
			</View>
		);
	}
	if (!serverUrl) {
		return (
			<Redirect
				href={{
					pathname: "/onboarding",
					params: { redirectTo: `/reset-password?token=${encodeURIComponent(resetToken)}` },
				}}
			/>
		);
	}

	if (done) {
		return (
			<View className="flex-1 items-center justify-center bg-bg px-6">
				<View className="w-full max-w-md items-center gap-4 rounded-xl border border-border bg-surface p-6">
					<Text className="font-display-semibold text-2xl text-text">Password updated</Text>
					<Text className="text-center font-ui text-sm text-text-muted">
						Sign in with your new password to continue.
					</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => router.replace("/auth")}
						className="w-full items-center rounded-lg bg-accent px-4 py-3"
					>
						<Text className="font-ui-semibold text-base text-accent-ink">Sign in</Text>
					</Pressable>
				</View>
			</View>
		);
	}

	return (
		<KeyboardAvoidingView
			className="flex-1 bg-bg"
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<View className="flex-1 items-center justify-center px-6 py-10">
				<View className="w-full max-w-md gap-5 rounded-xl border border-border bg-surface p-6">
					<View className="gap-2">
						<Text className="font-display-semibold text-3xl text-text">Choose a new password</Text>
						<Text className="font-ui text-sm text-text-muted">Use at least 8 characters.</Text>
					</View>
					<TextInput
						secureTextEntry
						value={password}
						returnKeyType="next"
						placeholder="New password"
						onChangeText={setPassword}
						autoComplete="new-password"
						accessibilityLabel="New password"
						onSubmitEditing={() => confirmRef.current?.focus()}
						className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text"
					/>
					<TextInput
						secureTextEntry
						ref={confirmRef}
						returnKeyType="go"
						value={confirmation}
						autoComplete="new-password"
						placeholder="Confirm password"
						onChangeText={setConfirmation}
						accessibilityLabel="Confirm password"
						onSubmitEditing={() => void handleReset()}
						className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text"
					/>
					{error && <Text className="font-ui text-sm text-danger">{error}</Text>}
					<Pressable
						disabled={pending}
						accessibilityRole="button"
						onPress={() => void handleReset()}
						className={clsx("items-center rounded-lg bg-accent px-4 py-3", pending && "opacity-50")}
					>
						<Text className="font-ui-semibold text-base text-accent-ink">
							{pending ? "Updating..." : "Update password"}
						</Text>
					</Pressable>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}
