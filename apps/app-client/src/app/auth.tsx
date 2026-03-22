import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, type TextInputProps } from "react-native";
import { z } from "zod";

import { OtpInput } from "@/components/otp-input";
import { Box } from "@/components/ui/box";
import { Button, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useSystemConfig } from "@/lib/api-client";
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

type TwoFactorMethod = "totp" | "backupCode";

function isTwoFactorRedirectData(
	data: unknown,
): data is { twoFactorMethods?: string[]; twoFactorRedirect: true } {
	return Boolean(data && typeof data === "object" && "twoFactorRedirect" in data);
}

export default function Auth() {
	const authClient = useAuthClient();
	const configQuery = useSystemConfig();
	const setServerUrl = useSetServerUrl();
	const oidcAutoLaunched = useRef(false);
	const [otpResetKey, setOtpResetKey] = useState(0);
	const [mode, setMode] = useState<AuthMode>("login");
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [oidcError, setOidcError] = useState<string | null>(null);
	const [step, setStep] = useState<"credentials" | "twoFactor">("credentials");
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
	const passwordInputRef = useRef<(TextInputProps & { focus: () => void }) | null>(null);

	const authConfig = configQuery.data?.auth;
	const oidcEnabled = authConfig?.oidcEnabled ?? false;
	const signupAllowed = authConfig?.signupAllowed ?? true;
	const localAuthDisabled = authConfig?.localAuthDisabled ?? false;
	const oidcButtonLabel = authConfig?.oidcButtonLabel ?? "Sign in with OIDC";

	const modeContent = modes[mode];

	const authMutation = useMutation({
		mutationFn: async ({ email, password }: z.infer<typeof schema>) => {
			if (mode === "signup") {
				const { error } = await authClient.signUp.email({
					email,
					password,
					name: getNameFromEmail(email),
				});
				if (error) {
					throw new Error(error.message ?? "Could not create account");
				}
			}
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				throw new Error(result.error.message ?? "Invalid email or password");
			}

			return result;
		},
		onSuccess: (result) => {
			if (isTwoFactorRedirectData(result.data)) {
				const availableMethods = result.data.twoFactorMethods ?? [];
				setTwoFactorMethod(availableMethods.includes("totp") ? "totp" : "backupCode");
				setTwoFactorCode("");
				setStep("twoFactor");
				return;
			}

			router.replace("/(app)");
		},
	});

	const twoFactorMutation = useMutation({
		onSuccess: () => router.replace("/(app)"),
		onError: () => setOtpResetKey((k) => k + 1),
		mutationFn: async (code: string) => {
			if (twoFactorMethod === "backupCode") {
				const { error } = await authClient.twoFactor.verifyBackupCode({ code });
				if (error) {
					throw new Error(error.message ?? "Could not verify the backup code");
				}
				return;
			}

			const { error } = await authClient.twoFactor.verifyTotp({ code });
			if (error) {
				throw new Error(error.message ?? "Could not verify the code");
			}
		},
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
		router.replace("/(app)");
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

	function resetTwoFactorFlow() {
		setStep("credentials");
		setTwoFactorCode("");
		setTwoFactorMethod("totp");
		authMutation.reset();
		twoFactorMutation.reset();
	}

	function switchMode(next: AuthMode) {
		setMode(next);
		resetTwoFactorFlow();
		form.setFieldValue("password", "");
	}

	async function handleTwoFactorSubmit() {
		if (twoFactorMutation.isPending) {
			return;
		}

		const code = twoFactorCode.trim();
		if (!code) {
			return;
		}

		await twoFactorMutation.mutateAsync(code);
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

	if (step === "twoFactor") {
		const isBackupCode = twoFactorMethod === "backupCode";

		return (
			<KeyboardAvoidingView
				className="flex-1"
				behavior={Platform.OS === "ios" ? "padding" : "height"}
			>
				<Box className="flex-1 bg-background justify-center items-center">
					<Box className="w-full max-w-md px-6 gap-6">
						<Box className="items-center gap-1">
							<Text className="text-xl font-semibold text-foreground">
								Two-factor authentication
							</Text>
							<Text className="text-muted-foreground text-sm text-center">
								{isBackupCode
									? "Enter one of your backup codes."
									: "Enter the 6-digit code from your authenticator app."}
							</Text>
						</Box>
						{isBackupCode ? (
							<Box className="gap-4">
								<Input>
									<InputField
										autoFocus
										returnKeyType="go"
										autoCorrect={false}
										value={twoFactorCode}
										autoCapitalize="none"
										submitBehavior="submit"
										placeholder="Backup code"
										onChangeText={setTwoFactorCode}
										onSubmitEditing={() => void handleTwoFactorSubmit()}
									/>
								</Input>
								{twoFactorMutation.error && (
									<Text className="text-destructive text-sm">
										{twoFactorMutation.error.message}
									</Text>
								)}
								<Button
									disabled={twoFactorMutation.isPending || !twoFactorCode.trim()}
									onPress={() => void handleTwoFactorSubmit()}
								>
									<ButtonText>
										{twoFactorMutation.isPending ? "Verifying..." : "Verify backup code"}
									</ButtonText>
								</Button>
							</Box>
						) : (
							<Box className="gap-4 items-center">
								<OtpInput
									key={otpResetKey}
									disabled={twoFactorMutation.isPending}
									onComplete={(code) => {
										if (!twoFactorMutation.isPending) {
											void twoFactorMutation.mutateAsync(code);
										}
									}}
								/>
								{twoFactorMutation.error && (
									<Text className="text-destructive text-sm">
										{twoFactorMutation.error.message}
									</Text>
								)}
							</Box>
						)}
						<Box className="items-center gap-3">
							<Pressable
								disabled={twoFactorMutation.isPending}
								className={clsx(twoFactorMutation.isPending && "opacity-50")}
								onPress={() => {
									setTwoFactorMethod(isBackupCode ? "totp" : "backupCode");
									setTwoFactorCode("");
									twoFactorMutation.reset();
								}}
							>
								<Text className="text-muted-foreground text-sm">
									{isBackupCode ? "Use authenticator app instead" : "Use a backup code instead"}
								</Text>
							</Pressable>
							<Pressable
								onPress={() => resetTwoFactorFlow()}
								disabled={twoFactorMutation.isPending}
								className={clsx(twoFactorMutation.isPending && "opacity-50")}
							>
								<Text className="text-muted-foreground text-sm">Back to login</Text>
							</Pressable>
						</Box>
					</Box>
				</Box>
			</KeyboardAvoidingView>
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
			className="flex-1"
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
