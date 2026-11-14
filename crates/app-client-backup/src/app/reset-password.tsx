import { useMutation } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, type TextInputProps } from "react-native";
import { z } from "zod";

import { Box } from "@/components/ui/box";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useServerUrl, useSetServerUrl } from "@/lib/atoms";
import { useAppForm } from "@/lib/forms";

const schema = z
	.object({
		confirmPassword: z.string(),
		password: z.string().min(8, "Password must be at least 8 characters"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		path: ["confirmPassword"],
		message: "Passwords do not match",
	});

export default function ResetPassword() {
	const serverUrl = useServerUrl();
	const setServerUrl = useSetServerUrl();
	const { token } = useLocalSearchParams();
	const [done, setDone] = useState(false);
	const resetToken = Array.isArray(token) ? token[0] : token;
	const confirmRef = useRef<(TextInputProps & { focus: () => void }) | null>(null);
	const inferredWebServerUrl =
		Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
	const resetServerUrl = serverUrl ?? inferredWebServerUrl;
	const authClient = useMemo(
		() => (resetServerUrl ? createAuthClient({ baseURL: resetServerUrl }) : null),
		[resetServerUrl],
	);

	useEffect(() => {
		if (!serverUrl && inferredWebServerUrl) {
			setServerUrl(inferredWebServerUrl);
		}
	}, [serverUrl, inferredWebServerUrl, setServerUrl]);

	const resetMutation = useMutation({
		onSuccess: () => setDone(true),
		mutationFn: async ({ password }: z.infer<typeof schema>) => {
			if (!authClient || !resetToken) {
				throw new Error("This reset link is missing server information");
			}
			const { data, error } = await authClient.resetPassword({
				token: resetToken,
				newPassword: password,
			});
			if (error) {
				throw new Error(error.message ?? "Could not reset password");
			}
			return data;
		},
	});

	const form = useAppForm({
		validators: { onChange: schema },
		defaultValues: { password: "", confirmPassword: "" },
		onSubmit: async ({ value }) => {
			await resetMutation.mutateAsync(value);
		},
	});

	if (!resetToken) {
		return (
			<Box className="flex-1 bg-background justify-center items-center px-6">
				<Box className="w-full max-w-md gap-4 items-center">
					<Text className="text-foreground text-base font-semibold text-center">
						Invalid reset link
					</Text>
					<Text className="text-muted-foreground text-sm text-center">
						This password reset link is missing or invalid. Please ask your administrator for a new
						link.
					</Text>
					<Pressable onPress={() => router.replace("/auth")}>
						<Text className="text-muted-foreground text-sm">Back to sign in</Text>
					</Pressable>
				</Box>
			</Box>
		);
	}

	if (done) {
		return (
			<Box className="flex-1 bg-background justify-center items-center px-6">
				<Box className="w-full max-w-md gap-4 items-center">
					<Text className="text-foreground text-base font-semibold text-center">
						Password reset
					</Text>
					<Text className="text-muted-foreground text-sm text-center">
						Your password has been updated. Sign in with your new password.
					</Text>
					<Button onPress={() => router.replace("/auth")}>
						<ButtonText>Sign in</ButtonText>
					</Button>
				</Box>
			</Box>
		);
	}

	return (
		<KeyboardAvoidingView
			className="flex-1"
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background justify-center items-center">
				<Box className="w-full max-w-md px-6 gap-6">
					<Box className="items-center gap-1">
						<Text className="text-xl font-semibold text-foreground">Reset password</Text>
						<Text className="text-muted-foreground text-sm text-center">
							Choose a new password for your account.
						</Text>
					</Box>
					<form.AppForm>
						<Box className="gap-3">
							<form.AppField name="password">
								{(field) => (
									<field.TextField
										secureTextEntry
										returnKeyType="next"
										placeholder="New password"
										autoComplete="new-password"
										onSubmitEditing={() => confirmRef.current?.focus()}
									/>
								)}
							</form.AppField>
							<form.AppField name="confirmPassword">
								{(field) => (
									<field.TextField
										secureTextEntry
										returnKeyType="go"
										inputRef={confirmRef}
										autoComplete="new-password"
										placeholder="Confirm password"
										onSubmitEditing={() => void form.handleSubmit()}
									/>
								)}
							</form.AppField>
							{resetMutation.error && (
								<Text className="text-destructive text-sm">{resetMutation.error.message}</Text>
							)}
							<form.SubmitButton label="Reset password" pendingLabel="Resetting..." />
						</Box>
					</form.AppForm>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
