import type { ContractSuccess } from "@ryot/contract/client";
import clsx from "clsx";
import { router } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { getNameFromEmail } from "@/modules/auth/user-name";
import { getRedirectDestination, type SafeRedirectTo } from "@/modules/navigation/redirect";

type AuthMode = "login" | "signup";
type TwoFactorMethod = "totp" | "backupCode";
type AuthConfig = ContractSuccess<"system", "config">["auth"];

const content = {
	login: {
		action: "Sign in",
		title: "Welcome back",
		pending: "Signing in...",
		subtitle: "Pick up where you left off.",
	},
	signup: {
		title: "Make it yours",
		action: "Create account",
		pending: "Creating account...",
		subtitle: "Start a library shaped around you.",
	},
} as const;

export function AuthUnavailable(props: { onRetry?: () => void; onChangeServer: () => void }) {
	return (
		<View className="flex-1 items-center justify-center bg-bg px-6">
			<View className="w-full max-w-md gap-4 rounded-xl border border-border bg-surface p-6">
				<Text className="font-display-semibold text-2xl text-text">
					Could not reach this server
				</Text>
				<Text className="font-ui text-sm leading-5 text-text-muted">
					Authentication settings could not be loaded. Check the server and try again.
				</Text>
				{props.onRetry && (
					<Pressable accessibilityRole="button" onPress={props.onRetry}>
						<Text className="font-ui-medium text-accent-text">Try again</Text>
					</Pressable>
				)}
				<Pressable accessibilityRole="button" onPress={props.onChangeServer}>
					<Text className="font-ui-medium text-text-muted">Change server</Text>
				</Pressable>
			</View>
		</View>
	);
}

export function AuthForm(props: {
	config: AuthConfig;
	onChangeServer: () => void;
	redirectTo?: SafeRedirectTo;
}) {
	const client = useAuthClient();
	const oidcAutoLaunched = useRef(false);
	const [email, setEmail] = useState("");
	const passwordRef = useRef<TextInput>(null);
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [mode, setMode] = useState<AuthMode>("login");
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [step, setStep] = useState<"credentials" | "twoFactor">("credentials");
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");

	const modeContent = content[mode];
	const destination = getRedirectDestination(props.redirectTo, "/");
	const oidcButtonLabel = props.config.oidcButtonLabel ?? "Sign in with OpenID Connect";

	function resetTwoFactor() {
		setError(null);
		setStep("credentials");
		setTwoFactorCode("");
		setTwoFactorMethod("totp");
	}

	async function handleCredentials() {
		const normalizedEmail = email.trim().toLowerCase();
		setError(null);
		if (!normalizedEmail.includes("@")) {
			setError("Enter a valid email address.");
			return;
		}
		if (password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}

		setPending(true);
		try {
			if (mode === "signup") {
				const signup = await client.signUp.email({
					password,
					email: normalizedEmail,
					name: getNameFromEmail(normalizedEmail),
				});
				if (signup.error) {
					setError(signup.error.message ?? "Could not create your account.");
					return;
				}
			}

			const signin = await client.signIn.email(
				{ email: normalizedEmail, password },
				{
					onSuccess(context) {
						if (context.data.twoFactorRedirect) {
							const methods = context.data.twoFactorMethods ?? [];
							setTwoFactorMethod(methods.includes("totp") ? "totp" : "backupCode");
							setStep("twoFactor");
							return;
						}
						router.replace(destination);
					},
				},
			);
			if (signin.error) {
				setError(signin.error.message ?? "The email or password is incorrect.");
				return;
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not contact the server.");
		} finally {
			setPending(false);
		}
	}

	async function handleTwoFactor() {
		const code = twoFactorCode.trim();
		if (!code || pending) {
			return;
		}

		setError(null);
		setPending(true);
		try {
			const result =
				twoFactorMethod === "backupCode"
					? await client.twoFactor.verifyBackupCode({ code })
					: await client.twoFactor.verifyTotp({ code });
			if (result.error) {
				setError(result.error.message ?? "That code could not be verified.");
				setTwoFactorCode("");
				return;
			}
			router.replace(destination);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not verify that code.");
		} finally {
			setPending(false);
		}
	}

	async function handleOidcSignIn() {
		if (pending) {
			return;
		}
		setError(null);
		setPending(true);
		try {
			const result = await client.signIn.oauth2({ providerId: "oidc", callbackURL: destination });
			if (result.error) {
				setError(result.error.message ?? "OpenID Connect sign-in failed.");
				return;
			}
			router.replace(destination);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "OpenID Connect sign-in failed.");
		} finally {
			setPending(false);
		}
	}

	const autoLaunchOidc = useEffectEvent(handleOidcSignIn);

	useEffect(() => {
		if (props.config.oidcEnabled && props.config.localAuthDisabled && !oidcAutoLaunched.current) {
			oidcAutoLaunched.current = true;
			void autoLaunchOidc();
		}
	}, [props.config.localAuthDisabled, props.config.oidcEnabled]);

	useEffect(() => {
		if (!props.config.signupAllowed && mode === "signup") {
			setMode("login");
		}
	}, [mode, props.config.signupAllowed]);

	if (step === "twoFactor") {
		const usingBackupCode = twoFactorMethod === "backupCode";
		return (
			<View className="w-full max-w-md gap-6 rounded-xl border border-border bg-surface p-6 shadow-card">
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">One more step</Text>
					<Text className="font-ui text-sm leading-5 text-text-muted">
						{usingBackupCode
							? "Enter one of your saved backup codes."
							: "Enter the 6-digit code from your authenticator app."}
					</Text>
				</View>
				<TextInput
					autoFocus
					returnKeyType="go"
					autoCorrect={false}
					autoCapitalize="none"
					value={twoFactorCode}
					onChangeText={setTwoFactorCode}
					maxLength={usingBackupCode ? undefined : 6}
					onSubmitEditing={() => void handleTwoFactor()}
					placeholder={usingBackupCode ? "Backup code" : "000000"}
					keyboardType={usingBackupCode ? "default" : "number-pad"}
					accessibilityLabel={usingBackupCode ? "Backup code" : "Authenticator code"}
					className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-lg text-text"
				/>
				{error && <Text className="font-ui text-sm text-danger">{error}</Text>}
				<Pressable
					accessibilityRole="button"
					onPress={() => void handleTwoFactor()}
					disabled={pending || !twoFactorCode.trim()}
					className={clsx(
						"items-center rounded-lg bg-accent px-4 py-3",
						(pending || !twoFactorCode.trim()) && "opacity-50",
					)}
				>
					<Text className="font-ui-semibold text-base text-accent-ink">
						{pending ? "Verifying..." : "Verify"}
					</Text>
				</Pressable>
				<Pressable
					disabled={pending}
					accessibilityRole="button"
					onPress={() => {
						setError(null);
						setTwoFactorCode("");
						setTwoFactorMethod(usingBackupCode ? "totp" : "backupCode");
					}}
				>
					<Text className="text-center font-ui-medium text-sm text-text-muted">
						{usingBackupCode ? "Use an authenticator code" : "Use a backup code"}
					</Text>
				</Pressable>
				<Pressable accessibilityRole="button" disabled={pending} onPress={resetTwoFactor}>
					<Text className="text-center font-ui-medium text-sm text-text-muted">
						Back to sign in
					</Text>
				</Pressable>
			</View>
		);
	}

	if (props.config.localAuthDisabled && !props.config.oidcEnabled) {
		return <AuthUnavailable onChangeServer={props.onChangeServer} />;
	}

	return (
		<View className="w-full max-w-md gap-6 rounded-xl border border-border bg-surface p-6 shadow-card">
			<View className="gap-2">
				<Text className="font-display-semibold text-3xl text-text">{modeContent.title}</Text>
				<Text className="font-ui text-base text-text-muted">{modeContent.subtitle}</Text>
			</View>

			{!props.config.localAuthDisabled && (
				<View className="gap-4">
					{props.config.signupAllowed && (
						<View className="flex-row rounded-lg bg-surface-2 p-1">
							{(["login", "signup"] as const).map((option) => (
								<Pressable
									key={option}
									accessibilityRole="tab"
									accessibilityState={{ selected: mode === option }}
									className={clsx(
										"flex-1 items-center rounded-md py-2",
										mode === option && "bg-raised shadow-sm",
									)}
									onPress={() => {
										setMode(option);
										setPassword("");
										resetTwoFactor();
									}}
								>
									<Text
										className={clsx(
											"font-ui-medium text-sm",
											mode === option ? "text-text" : "text-text-muted",
										)}
									>
										{option === "login" ? "Sign in" : "Sign up"}
									</Text>
								</Pressable>
							))}
						</View>
					)}

					<TextInput
						value={email}
						autoCorrect={false}
						returnKeyType="next"
						autoComplete="email"
						autoCapitalize="none"
						onChangeText={setEmail}
						keyboardType="email-address"
						placeholder="you@example.com"
						accessibilityLabel="Email address"
						onSubmitEditing={() => passwordRef.current?.focus()}
						className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text"
					/>
					<TextInput
						secureTextEntry
						value={password}
						ref={passwordRef}
						returnKeyType="go"
						placeholder="Password"
						onChangeText={setPassword}
						accessibilityLabel="Password"
						onSubmitEditing={() => void handleCredentials()}
						autoComplete={mode === "login" ? "current-password" : "new-password"}
						className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text"
					/>
					{error && <Text className="font-ui text-sm text-danger">{error}</Text>}
					<Pressable
						disabled={pending}
						accessibilityRole="button"
						onPress={() => void handleCredentials()}
						className={clsx("items-center rounded-lg bg-accent px-4 py-3", pending && "opacity-50")}
					>
						<Text className="font-ui-semibold text-base text-accent-ink">
							{pending ? modeContent.pending : modeContent.action}
						</Text>
					</Pressable>
				</View>
			)}

			{props.config.oidcEnabled && (
				<View className="gap-3">
					{!props.config.localAuthDisabled && (
						<View className="flex-row items-center gap-3">
							<View className="h-px flex-1 bg-border" />
							<Text className="font-ui text-xs text-text-subtle">OR</Text>
							<View className="h-px flex-1 bg-border" />
						</View>
					)}
					{props.config.localAuthDisabled && error && (
						<Text className="font-ui text-sm text-danger">{error}</Text>
					)}
					<Pressable
						disabled={pending}
						accessibilityRole="button"
						onPress={() => void handleOidcSignIn()}
						className={clsx(
							"items-center rounded-lg border border-border-strong px-4 py-3",
							pending && "opacity-50",
						)}
					>
						<Text className="font-ui-medium text-base text-text">
							{pending ? "Opening provider..." : oidcButtonLabel}
						</Text>
					</Pressable>
				</View>
			)}

			<Pressable accessibilityRole="button" disabled={pending} onPress={props.onChangeServer}>
				<Text className="text-center font-ui-medium text-sm text-text-muted">Change server</Text>
			</Pressable>
		</View>
	);
}
