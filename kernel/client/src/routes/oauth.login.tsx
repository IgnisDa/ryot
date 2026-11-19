import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { browserServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { deriveAuthMethods } from "#/modules/auth/config";
import type { AuthMode, TwoFactorMethod } from "#/modules/auth/flow";
import type { CredentialsValues } from "#/modules/auth/form-values";
import { CredentialsForm, TwoFactorForm } from "#/modules/auth/forms";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/oauth/login")({
	component: OAuthLogin,
	pendingComponent: OAuthLoginPending,
	errorComponent: OAuthLoginUnavailable,
	beforeLoad: ({ context }) =>
		context.runtime.runPromise(Effect.map(browserServerOrigin, (server) => ({ server }))),
	loader: ({ context, abortController }) =>
		context.runtime.runPromise(
			Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)),
			{ signal: abortController.signal },
		),
});

function OAuthLoginFrame(props: { readonly children: ReactNode }) {
	const t = useT();
	usePageTitle(t(kernelMessage("common.action.sign-in")));
	return (
		<main {...mainContentProps} className="ui-page">
			{props.children}
		</main>
	);
}

function OAuthLoginPending() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.oauth-shared.options-loading-title"))}
			message={t(kernelMessage("client.route.oauth-shared.options-loading-detail"))}
		/>
	);
}

function OAuthLoginUnavailable() {
	const t = useT();
	const router = useRouter();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.oauth-shared.server-unreachable-title"))}
			message={t(kernelMessage("client.route.oauth-shared.server-unreachable-detail"))}
			actions={
				<Button
					type="button"
					variant="primary"
					className="w-full"
					onClick={() => void router.invalidate()}
				>
					{t(kernelMessage("common.action.try-again"))}
				</Button>
			}
		/>
	);
}

function OAuthLogin() {
	const t = useT();
	const config = Route.useLoaderData();
	const { server, runtime, hostedOAuthQuery } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const controller = useRef(new AbortController());
	const oidcAutoLaunched = useRef(false);
	const [mode, setMode] = useState<AuthMode>("login");
	const [oidcError, setOidcError] = useState<Message>();
	const [oidcPending, setOidcPending] = useState(false);
	const [twoFactorMethods, setTwoFactorMethods] = useState<readonly TwoFactorMethod[]>();
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
	useEffect(() => () => controller.current.abort(), []);

	const methods = deriveAuthMethods(config);

	function submitCredentials(values: CredentialsValues) {
		return auth.submitCredentials({ mode, values, oauthQuery: hostedOAuthQuery() }).pipe(
			Effect.match({
				onFailure: (error) => error.reason,
				onSuccess: (result) => {
					if (result._tag === "TwoFactor") {
						setTwoFactorMethods(result.methods);
						setTwoFactorMethod(result.methods[0]);
					}
					return undefined;
				},
			}),
		);
	}

	function submitTwoFactor(code: string) {
		return auth
			.verifyTwoFactor(twoFactorMethod, code, hostedOAuthQuery())
			.pipe(Effect.match({ onSuccess: () => undefined, onFailure: (error) => error.reason }));
	}

	function signInWithOidc() {
		if (oidcPending) {
			return;
		}
		setOidcError(undefined);
		setOidcPending(true);
		runtime.runFork(
			auth.signInWithOidc(hostedOAuthQuery()).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						setOidcError(failure.reason);
						setOidcPending(false);
					}),
				),
			),
			{ signal: controller.current.signal },
		);
	}

	const launchOidc = useEffectEvent(signInWithOidc);
	useEffect(() => {
		if (
			config.frontendOrigin === server &&
			methods.oidc &&
			!methods.emailSignIn &&
			!oidcAutoLaunched.current
		) {
			oidcAutoLaunched.current = true;
			launchOidc();
		}
	}, [config.frontendOrigin, methods.emailSignIn, methods.oidc, server]);

	if (config.frontendOrigin !== server) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.oauth-shared.config-mismatch-title"))}
				message={t(
					kernelMessage("client.route.oauth-login.mismatch-detail", {
						origin: config.frontendOrigin,
					}),
				)}
			/>
		);
	}

	if (!methods.emailSignIn && !methods.oidc) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.oauth-login.auth-unavailable-title"))}
				message={t(kernelMessage("client.route.oauth-login.auth-unavailable-detail"))}
			/>
		);
	}

	return (
		<OAuthLoginFrame>
			<section
				aria-labelledby="auth-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				{twoFactorMethods ? (
					<TwoFactorForm
						method={twoFactorMethod}
						methods={twoFactorMethods}
						onSubmit={submitTwoFactor}
						onMethodChange={setTwoFactorMethod}
						onBack={() => setTwoFactorMethods(undefined)}
					/>
				) : (
					<>
						{!methods.emailSignIn && (
							<div>
								<h1 id="auth-title" className="ui-heading">
									{t(kernelMessage("client.auth.mode.login.title"))}
								</h1>
								<p className="ui-subtitle">
									{t(kernelMessage("client.route.oauth-login.welcome-detail"))}
								</p>
							</div>
						)}
						{methods.emailSignIn && (
							<CredentialsForm
								mode={mode}
								disabled={oidcPending}
								onModeChange={setMode}
								onSubmit={submitCredentials}
								signupAllowed={methods.emailSignUp}
							/>
						)}
						{methods.oidc && (
							<div className="ui-stack">
								{methods.emailSignIn && (
									<p className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-text-subtle uppercase before:h-px before:bg-border before:content-[''] after:h-px after:bg-border after:content-['']">
										{t(kernelMessage("client.route.oauth-login.or"))}
									</p>
								)}
								{oidcError && (
									<p role="alert" className="ui-field-error">
										{t(oidcError)}
									</p>
								)}
								<Button
									type="button"
									className="w-full"
									variant="secondary"
									disabled={oidcPending}
									onClick={signInWithOidc}
								>
									{oidcPending
										? t(kernelMessage("client.route.oauth-login.opening-provider"))
										: (methods.oidc.buttonLabel ??
											t(kernelMessage("client.route.oauth-login.provider-default")))}
								</Button>
							</div>
						)}
						<p className="text-center text-xs text-text-subtle">
							{t(
								kernelMessage("client.route.oauth-login.server", {
									hostname: new URL(server).hostname,
								}),
							)}
						</p>
					</>
				)}
			</section>
		</OAuthLoginFrame>
	);
}
