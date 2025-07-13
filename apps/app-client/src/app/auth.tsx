import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { router } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { z } from "zod";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api";
import { CLOUD_URL, serverUrlAtom } from "@/lib/atoms";
import { authClientAtom } from "@/lib/auth";
import { useAppForm } from "@/lib/forms";

type AuthMode = "login" | "signup";

const modes = {
	login: {
		title: "Welcome back",
		actionLabel: "Log in",
		pendingLabel: "Signing in...",
		subtitle: "Sign in to your account",
		passwordAutoComplete: "current-password" as const,
	},
	signup: {
		actionLabel: "Sign up",
		title: "Create account",
		pendingLabel: "Creating account...",
		subtitle: "Start tracking your life",
		passwordAutoComplete: "new-password" as const,
	},
} as const;

const schema = z.object({
	email: z.email("Enter a valid email"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

function getNameFromEmail(email: string) {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) {
		return "New User";
	}
	return normalized
		.split(/\s+/)
		.map((s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s))
		.join(" ");
}

export default function Auth() {
	const serverUrl = useAtomValue(serverUrlAtom);
	const setServerUrl = useSetAtom(serverUrlAtom);
	const authClient = useAtomValue(authClientAtom);
	const [mode, setMode] = useState<AuthMode>("login");

	const modeContent = modes[mode];
	const apiClient = createApiClient((serverUrl ?? CLOUD_URL) as string);

	const authMutation = useMutation({
		mutationFn: async ({ email, password }: z.infer<typeof schema>) => {
			if (mode === "signup") {
				const { error } = await apiClient.POST("/authentication/email", {
					body: { email, password, name: getNameFromEmail(email) },
				});
				if (error) {
					throw new Error(error.error.message);
				}
			}
			const { error } = await authClient.signIn.email({ email, password });
			if (error) {
				throw new Error(error.message ?? "Invalid email or password");
			}
		},
		onSuccess: () => router.replace("/(app)"),
	});

	const form = useAppForm({
		validators: { onChange: schema },
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			await authMutation.mutateAsync(value);
		},
	});

	function switchMode(next: AuthMode) {
		setMode(next);
		authMutation.reset();
		form.setFieldValue("password", "");
	}

	async function handleChangeServer() {
		await authClient.signOut().catch(() => {});
		setServerUrl(null);
		router.replace("/onboarding");
	}

	return (
		<KeyboardAvoidingView
			style={{ flex: 1 }}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background justify-center items-center">
				<Box className="w-full max-w-md px-6 gap-8">
					<Box className="items-center gap-3">
						<Box className="items-center gap-1">
							<Text className="text-xl font-semibold text-foreground">
								{modeContent.title}
							</Text>
							<Text className="text-muted-foreground text-sm text-center">
								{modeContent.subtitle}
							</Text>
						</Box>
					</Box>
					<Box className="gap-4">
						<Box className="flex-row rounded-lg border border-border overflow-hidden">
							{(["login", "signup"] as const).map((m) => (
								<Pressable
									key={m}
									onPress={() => switchMode(m)}
									className={clsx(
										"flex-1 py-2 items-center",
										mode === m ? "bg-primary" : "bg-transparent",
									)}
								>
									<Text
										className={clsx(
											"text-sm font-medium",
											mode === m
												? "text-primary-foreground"
												: "text-muted-foreground",
										)}
									>
										{m === "login" ? "Log in" : "Sign up"}
									</Text>
								</Pressable>
							))}
						</Box>
						<form.AppForm>
							<Box className="gap-3">
								<form.AppField name="email">
									{(field) => (
										<field.TextField
											autoCorrect={false}
											autoCapitalize="none"
											keyboardType="email-address"
											placeholder="you@example.com"
										/>
									)}
								</form.AppField>
								<form.AppField name="password">
									{(field) => (
										<field.TextField
											secureTextEntry
											returnKeyType="go"
											placeholder="Password"
											autoComplete={modeContent.passwordAutoComplete}
											onSubmitEditing={() => void form.handleSubmit()}
										/>
									)}
								</form.AppField>
								{authMutation.error && (
									<Text className="text-destructive text-sm">
										{authMutation.error.message}
									</Text>
								)}
								<form.SubmitButton
									label={modeContent.actionLabel}
									pendingLabel={modeContent.pendingLabel}
								/>
							</Box>
						</form.AppForm>
					</Box>
					<Box className="items-center">
						<Pressable onPress={handleChangeServer}>
							<Text className="text-muted-foreground text-sm">
								Change server
							</Text>
						</Pressable>
					</Box>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
