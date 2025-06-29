import { useForm } from "@tanstack/react-form";
import { router } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { z } from "zod";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api";
import { CLOUD_URL, serverUrlAtom } from "@/lib/atoms";
import { authClientAtom } from "@/lib/auth";

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

function resolveError(error: unknown): string | undefined {
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return undefined;
}

export default function Auth() {
	const serverUrl = useAtomValue(serverUrlAtom);
	const setServerUrl = useSetAtom(serverUrlAtom);
	const authClient = useAtomValue(authClientAtom);
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const modeContent = modes[mode];
	const apiClient = createApiClient((serverUrl ?? CLOUD_URL) as string);

	const form = useForm({
		validators: { onChange: schema },
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			const { email, password } = value;

			if (mode === "signup") {
				const { error: signupError } = await apiClient.POST(
					"/authentication/email",
					{ body: { email, password, name: getNameFromEmail(email) } },
				);
				if (signupError) {
					setSubmitError(signupError.error.message);
					return;
				}
			}

			const { error: signInError } = await authClient.signIn.email({
				email,
				password,
			});
			if (signInError) {
				setSubmitError(signInError.message ?? "Invalid email or password");
				return;
			}

			router.replace("/(app)");
		},
	});

	function switchMode(next: AuthMode) {
		setMode(next);
		setSubmitError(null);
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
			<Box className="flex-1 bg-background px-6 justify-center gap-8">
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
								className={
									mode === m
										? "flex-1 py-2 items-center bg-primary"
										: "flex-1 py-2 items-center bg-transparent"
								}
							>
								<Text
									className={
										mode === m
											? "text-sm font-medium text-primary-foreground"
											: "text-sm font-medium text-muted-foreground"
									}
								>
									{m === "login" ? "Log in" : "Sign up"}
								</Text>
							</Pressable>
						))}
					</Box>
					<Box className="gap-3">
						<form.Field name="email">
							{(field) => (
								<Box className="gap-1">
									<Input>
										<InputField
											autoCorrect={false}
											autoCapitalize="none"
											value={field.state.value}
											onBlur={field.handleBlur}
											keyboardType="email-address"
											placeholder="you@example.com"
											onChangeText={field.handleChange}
										/>
									</Input>
									{field.state.meta.isTouched &&
										field.state.meta.errors.length > 0 && (
											<Text className="text-destructive text-xs">
												{field.state.meta.errors
													.map(resolveError)
													.filter(Boolean)
													.join(", ")}
											</Text>
										)}
								</Box>
							)}
						</form.Field>
						<form.Field name="password">
							{(field) => (
								<Box className="gap-1">
									<Input>
										<InputField
											secureTextEntry
											placeholder="Password"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChangeText={field.handleChange}
											autoComplete={modeContent.passwordAutoComplete}
										/>
									</Input>
									{field.state.meta.isTouched &&
										field.state.meta.errors.length > 0 && (
											<Text className="text-destructive text-xs">
												{field.state.meta.errors
													.map(resolveError)
													.filter(Boolean)
													.join(", ")}
											</Text>
										)}
								</Box>
							)}
						</form.Field>
						{submitError && (
							<Text className="text-destructive text-sm">{submitError}</Text>
						)}
						<form.Subscribe
							selector={(state) => [state.canSubmit, state.isSubmitting]}
						>
							{([canSubmit, isSubmitting]) => (
								<Button
									disabled={!canSubmit || isSubmitting}
									onPress={() => void form.handleSubmit()}
								>
									{isSubmitting && <ButtonSpinner />}
									<ButtonText>
										{isSubmitting
											? modeContent.pendingLabel
											: modeContent.actionLabel}
									</ButtonText>
								</Button>
							)}
						</form.Subscribe>
					</Box>
				</Box>
				<Box className="items-center">
					<Pressable onPress={handleChangeServer}>
						<Text className="text-muted-foreground text-sm">Change server</Text>
					</Pressable>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
