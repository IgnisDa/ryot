import { router } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable } from "react-native";
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
		title: "Create account",
		actionLabel: "Sign up",
		pendingLabel: "Creating account...",
		subtitle: "Start tracking your life",
		passwordAutoComplete: "new-password" as const,
	},
} as const;

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
	const [email, setEmail] = useState("");
	const authClient = useAtomValue(authClientAtom);
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [mode, setMode] = useState<AuthMode>("login");
	const [error, setError] = useState<string | null>(null);

	const modeContent = modes[mode];
	const apiClient = createApiClient((serverUrl ?? CLOUD_URL) as string);

	function switchMode(next: AuthMode) {
		setMode(next);
		setError(null);
		setPassword("");
	}

	async function handleSubmit() {
		setError(null);
		const trimmedEmail = email.trim();

		if (!trimmedEmail || !password) {
			setError("Email and password are required");
			return;
		}
		if (password.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}

		setLoading(true);
		try {
			if (mode === "signup") {
				const { error: signupError } = await apiClient.POST(
					"/authentication/email",
					{
						body: {
							email: trimmedEmail,
							password,
							name: getNameFromEmail(trimmedEmail),
						},
					},
				);
				if (signupError) {
					setError(
						(signupError as { error?: { message?: string } }).error?.message ??
							"Could not create account",
					);
					return;
				}
			}

			const { error: signInError } = await authClient.signIn.email({
				email: trimmedEmail,
				password,
			});
			if (signInError) {
				setError(signInError.message ?? "Invalid email or password");
				return;
			}

			router.replace("/(app)");
		} finally {
			setLoading(false);
		}
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
						<Input>
							<InputField
								value={email}
								autoCorrect={false}
								autoCapitalize="none"
								keyboardType="email-address"
								placeholder="you@example.com"
								onChangeText={(text) => {
									setEmail(text);
									setError(null);
								}}
							/>
						</Input>
						<Input>
							<InputField
								value={password}
								secureTextEntry
								placeholder="Password"
								autoComplete={modeContent.passwordAutoComplete}
								onChangeText={(text) => {
									setPassword(text);
									setError(null);
								}}
							/>
						</Input>
						{error && <Text className="text-destructive text-sm">{error}</Text>}
						<Button disabled={loading} onPress={handleSubmit}>
							{loading && <ButtonSpinner />}
							<ButtonText>
								{loading ? modeContent.pendingLabel : modeContent.actionLabel}
							</ButtonText>
						</Button>
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
