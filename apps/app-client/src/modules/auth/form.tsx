import type { ContractSuccess } from "@ryot/contract/client";
import clsx from "clsx";
import { router } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import {
	CredentialsForm,
	type AuthMode,
	type CredentialsValues,
} from "@/modules/auth/credentials-form";
import { reportAuthFailure } from "@/modules/auth/errors";
import { TwoFactorForm, type TwoFactorMethod } from "@/modules/auth/two-factor-form";
import { getNameFromEmail } from "@/modules/auth/user-name";
import { getRedirectDestination, type SafeRedirectTo } from "@/modules/navigation/redirect";
import { FormCard, FormMessage } from "@/modules/ui/form";

type AuthConfig = ContractSuccess<"system", "config">["auth"];

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
				{props.onRetry ? (
					<Pressable accessibilityRole="button" onPress={props.onRetry}>
						<Text className="font-ui-medium text-base text-accent-text">Try again</Text>
					</Pressable>
				) : null}
				<Pressable accessibilityRole="button" onPress={props.onChangeServer}>
					<Text className="font-ui-medium text-base text-text-muted">Change server</Text>
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
	const [authPending, setAuthPending] = useState(false);
	const [credentials, setCredentials] = useState<CredentialsValues>({ email: "", password: "" });
	const [mode, setMode] = useState<AuthMode>("login");
	const [oidcError, setOidcError] = useState<string>();
	const [oidcPending, setOidcPending] = useState(false);
	const [step, setStep] = useState<"credentials" | "twoFactor">("credentials");
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
	const destination = getRedirectDestination(props.redirectTo, "/");
	const oidcButtonLabel = props.config.oidcButtonLabel ?? "Sign in with OpenID Connect";

	function resetTwoFactor() {
		setStep("credentials");
		setTwoFactorMethod("totp");
	}

	async function handleCredentials(values: CredentialsValues) {
		setCredentials(values);
		setAuthPending(true);
		try {
			if (mode === "signup") {
				const signup = await client.signUp.email({
					password: values.password,
					email: values.email,
					name: getNameFromEmail(values.email),
				});
				if (signup.error) {
					return reportAuthFailure("sign-up", signup.error);
				}
			}

			const signin = await client.signIn.email(values, {
				onSuccess(context) {
					if (context.data.twoFactorRedirect) {
						const methods = context.data.twoFactorMethods ?? [];
						setTwoFactorMethod(methods.includes("totp") ? "totp" : "backupCode");
						setStep("twoFactor");
						return;
					}
					router.replace(destination);
				},
			});
			return signin.error ? reportAuthFailure("sign-in", signin.error) : undefined;
		} catch (cause) {
			return reportAuthFailure(mode === "signup" ? "sign-up" : "sign-in", cause);
		} finally {
			setAuthPending(false);
		}
	}

	async function handleTwoFactor(code: string) {
		setAuthPending(true);
		try {
			const result =
				twoFactorMethod === "backupCode"
					? await client.twoFactor.verifyBackupCode({ code })
					: await client.twoFactor.verifyTotp({ code });
			if (result.error) {
				return reportAuthFailure("two-factor", result.error);
			}
			router.replace(destination);
			return undefined;
		} catch (cause) {
			return reportAuthFailure("two-factor", cause);
		} finally {
			setAuthPending(false);
		}
	}

	async function handleOidcSignIn() {
		if (authPending || oidcPending) {
			return;
		}
		setOidcError(undefined);
		setOidcPending(true);
		try {
			const result = await client.signIn.social({ provider: "oidc", callbackURL: destination });
			if (result.error) {
				setOidcError(reportAuthFailure("oidc", result.error));
				return;
			}
			router.replace(destination);
		} catch (cause) {
			setOidcError(reportAuthFailure("oidc", cause));
		} finally {
			setOidcPending(false);
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
		return (
			<TwoFactorForm
				onBack={resetTwoFactor}
				method={twoFactorMethod}
				onSubmit={handleTwoFactor}
				onMethodChange={setTwoFactorMethod}
			/>
		);
	}

	if (props.config.localAuthDisabled && !props.config.oidcEnabled) {
		return <AuthUnavailable onChangeServer={props.onChangeServer} />;
	}

	return (
		<FormCard>
			{props.config.localAuthDisabled ? (
				<View className="gap-2">
					<Text className="font-display-semibold text-3xl text-text">Welcome back</Text>
					<Text className="font-ui text-base text-text-muted">Pick up where you left off.</Text>
				</View>
			) : (
				<CredentialsForm
					mode={mode}
					disabled={oidcPending}
					defaultValues={credentials}
					onSubmit={handleCredentials}
					signupAllowed={props.config.signupAllowed}
					onModeChange={(nextMode) => {
						setMode(nextMode);
						setCredentials((current) => ({ ...current, password: "" }));
						resetTwoFactor();
					}}
				/>
			)}

			{props.config.oidcEnabled ? (
				<View className="gap-3">
					{props.config.localAuthDisabled ? null : (
						<View className="flex-row items-center gap-3">
							<View className="h-px flex-1 bg-border" />
							<Text className="font-ui text-xs text-text-subtle">OR</Text>
							<View className="h-px flex-1 bg-border" />
						</View>
					)}
					{oidcError === undefined ? null : <FormMessage>{oidcError}</FormMessage>}
					<Pressable
						accessibilityRole="button"
						disabled={authPending || oidcPending}
						onPress={() => void handleOidcSignIn()}
						className={clsx(
							"items-center rounded-lg border border-border-strong px-4 py-3",
							(authPending || oidcPending) && "opacity-50",
						)}
					>
						<Text className="font-ui-medium text-base text-text">
							{oidcPending ? "Opening provider..." : oidcButtonLabel}
						</Text>
					</Pressable>
				</View>
			) : null}

			<Pressable
				accessibilityRole="button"
				onPress={props.onChangeServer}
				disabled={authPending || oidcPending}
			>
				<Text className="text-center font-ui-medium text-sm text-text-muted">Change server</Text>
			</Pressable>
		</FormCard>
	);
}
