import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, type TextInputProps } from "react-native";
import { z } from "zod";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApiClient, useSystemConfig } from "@/lib/api-client";
import { useAuthClient, useSetServerUrl } from "@/lib/atoms";
import { useAppForm } from "@/lib/forms";
import { getNameFromEmail } from "@/lib/user";

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

export default function Auth() {
	const setServerUrl = useSetServerUrl();
	const authClient = useAuthClient();
	const apiClient = useApiClient();
	const [mode, setMode] = useState<AuthMode>("login");
	const [oidcError, setOidcError] = useState<string | null>(null);
	const passwordInputRef = useRef<(TextInputProps & { focus: () => void }) | null>(null);
	const oidcAutoLaunched = useRef(false);

	const configQuery = useSystemConfig();

	const authConfig = configQuery.data?.auth;
	const oidcEnabled = authConfig?.oidcEnabled ?? false;
	const signupAllowed = authConfig?.signupAllowed ?? true;
	const localAuthDisabled = authConfig?.localAuthDisabled ?? false;
	const oidcButtonLabel = authConfig?.oidcButtonLabel ?? "Sign in with OIDC";

	const modeContent = modes[mode];

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
		onSuccess: () => router.replace("/"),
	});

	const form = useAppForm({
		validators: { onChange: schema },
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			await authMutation.mutateAsync(value);
		},
	});

	const handleOidcSignIn = useCallback(async () => {
		setOidcError(null);
		const { error } = await authClient.signIn.oauth2({ providerId: "oidc", callbackURL: "/" });
		if (error) {
			setOidcError(error.message ?? "OIDC sign-in failed");
			return;
		}
		router.replace("/");
	}, [authClient]);

	useEffect(() => {
		if (oidcEnabled && localAuthDisabled && !oidcAutoLaunched.current) {
			oidcAutoLaunched.current = true;
			void handleOidcSignIn();
		}
	}, [oidcEnabled, localAuthDisabled, handleOidcSignIn]);

	useEffect(() => {
		if (!signupAllowed && mode === "signup") {
			setMode("login");
		}
	}, [signupAllowed, mode]);

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

	if (configQuery.isLoading) {
		return (
			<Box className="flex-1 bg-background justify-center items-center">
				<Text className="text-muted-foreground text-sm">Loading...</Text>
			</Box>
		);
	}

	if (configQuery.isError) {
		return (
			<Box className="flex-1 bg-background justify-center items-center px-6">
				<Box className="w-full max-w-md gap-4">
					<Text className="text-foreground text-base font-semibold text-center">
						Could not reach server
					</Text>
					<Text className="text-muted-foreground text-sm text-center">
						{configQuery.error.message}
					</Text>
					<Pressable onPress={() => void configQuery.refetch()} className="items-center mt-2">
						<Text className="text-muted-foreground text-sm">Retry</Text>
					</Pressable>
					<Pressable onPress={() => void handleChangeServer()} className="items-center">
						<Text className="text-muted-foreground text-sm">Change server</Text>
					</Pressable>
				</Box>
			</Box>
		);
	}

	if (localAuthDisabled && !oidcEnabled) {
		return (
			<Box className="flex-1 bg-background justify-center items-center px-6">
				<Box className="w-full max-w-md gap-4">
					<Text className="text-foreground text-base font-semibold text-center">
						Authentication disabled
					</Text>
					<Text className="text-muted-foreground text-sm text-center">
						Both local authentication and OpenID Connect are disabled. Contact your administrator.
					</Text>
					<Pressable onPress={() => void handleChangeServer()} className="items-center mt-2">
						<Text className="text-muted-foreground text-sm">Change server</Text>
					</Pressable>
				</Box>
			</Box>
		);
	}

	return (
		<KeyboardAvoidingView
			style={{ flex: 1 }}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background justify-center items-center">
				<Box className="w-full max-w-md px-6 gap-8">
					{!localAuthDisabled && (
						<>
							<Box className="items-center gap-3">
								<Box className="items-center gap-1">
									<Text className="text-xl font-semibold text-foreground">{modeContent.title}</Text>
									<Text className="text-muted-foreground text-sm text-center">
										{modeContent.subtitle}
									</Text>
								</Box>
							</Box>
							<Box className="gap-4">
								{signupAllowed && (
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
														mode === m ? "text-primary-foreground" : "text-muted-foreground",
													)}
												>
													{m === "login" ? "Log in" : "Sign up"}
												</Text>
											</Pressable>
										))}
									</Box>
								)}
								<form.AppForm>
									<Box className="gap-3">
										<form.AppField name="email">
											{(field) => (
												<field.TextField
													autoCorrect={false}
													returnKeyType="next"
													autoCapitalize="none"
													submitBehavior="submit"
													keyboardType="email-address"
													placeholder="you@example.com"
													onSubmitEditing={() => passwordInputRef.current?.focus()}
												/>
											)}
										</form.AppField>
										<form.AppField name="password">
											{(field) => (
												<field.TextField
													secureTextEntry
													returnKeyType="go"
													placeholder="Password"
													inputRef={passwordInputRef}
													autoComplete={modeContent.passwordAutoComplete}
													onSubmitEditing={() => void form.handleSubmit()}
												/>
											)}
										</form.AppField>
										{authMutation.error && (
											<Text className="text-destructive text-sm">{authMutation.error.message}</Text>
										)}
										<form.SubmitButton
											label={modeContent.actionLabel}
											pendingLabel={modeContent.pendingLabel}
										/>
									</Box>
								</form.AppForm>
							</Box>
						</>
					)}
					{oidcEnabled && (
						<Box className="gap-3">
							{!localAuthDisabled && (
								<Box className="flex-row items-center gap-3">
									<Box className="flex-1 h-px bg-border" />
									<Text className="text-muted-foreground text-xs">OR</Text>
									<Box className="flex-1 h-px bg-border" />
								</Box>
							)}
							{oidcError && <Text className="text-destructive text-sm">{oidcError}</Text>}
							<Pressable
								onPress={() => void handleOidcSignIn()}
								className="w-full py-3 rounded-lg border border-border items-center"
							>
								<Text className="text-sm font-medium text-foreground">{oidcButtonLabel}</Text>
							</Pressable>
						</Box>
					)}
					<Box className="items-center">
						<Pressable onPress={() => void handleChangeServer()}>
							<Text className="text-muted-foreground text-sm">Change server</Text>
						</Pressable>
					</Box>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
