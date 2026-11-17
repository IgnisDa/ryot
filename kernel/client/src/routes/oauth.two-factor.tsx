import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useState } from "react";

import { browserServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { deriveAuthMethods } from "#/modules/auth/config";
import type { TwoFactorMethod } from "#/modules/auth/flow";
import type { CredentialsValues } from "#/modules/auth/form-values";
import { CredentialsForm, TwoFactorForm } from "#/modules/auth/forms";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";
import { TwoFactorManagement } from "#/modules/auth/two-factor-management";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/oauth/two-factor")({
	component: OAuthTwoFactor,
	pendingComponent: OAuthTwoFactorPending,
	errorComponent: OAuthTwoFactorUnavailable,
	validateSearch: (search) => ({
		from: search.from === "settings" ? ("settings" as const) : undefined,
	}),
	beforeLoad: ({ context }) =>
		context.runtime.runPromise(Effect.map(browserServerOrigin, (server) => ({ server }))),
	loader: ({ context, abortController }) =>
		context.runtime.runPromise(
			Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)),
			{ signal: abortController.signal },
		),
});

type Step =
	| { readonly kind: "sign-in" }
	| { readonly kind: "finished" }
	| { readonly kind: "manage"; readonly enabled: boolean; readonly password: string }
	| {
			readonly password: string;
			readonly kind: "challenge";
			readonly methods: readonly TwoFactorMethod[];
	  };

function OAuthTwoFactorPending() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.oauth-shared.options-loading-title"))}
			message={t(kernelMessage("client.route.oauth-shared.options-loading-detail"))}
		/>
	);
}

function OAuthTwoFactorFrame(props: { readonly children: ReactNode }) {
	const t = useT();
	usePageTitle(t(kernelMessage("client.settings.account.two-factor.title")));
	return (
		<main {...mainContentProps} className="ui-page">
			{props.children}
		</main>
	);
}

function OAuthTwoFactorUnavailable() {
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

function OAuthTwoFactor() {
	const t = useT();
	const config = Route.useLoaderData();
	const { from } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { server, runtime, hostedOAuthQuery } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const [step, setStep] = useState<Step>({ kind: "sign-in" });
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");

	const openManagement = (password: string) =>
		auth.twoFactorSession.pipe(
			Effect.match({
				onFailure: (error) => error.reason,
				onSuccess: (session) => {
					setStep({ password, kind: "manage", enabled: session.twoFactorEnabled });
					return undefined;
				},
			}),
		);

	function submitCredentials(values: CredentialsValues) {
		return auth.submitCredentials({ values, mode: "login", oauthQuery: hostedOAuthQuery() }).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(error.reason),
				onSuccess: (result) => {
					if (result._tag === "TwoFactor") {
						setTwoFactorMethod(result.methods[0]);
						setStep({ kind: "challenge", methods: result.methods, password: values.password });
						return Effect.undefined;
					}
					return openManagement(values.password);
				},
			}),
		);
	}

	function submitTwoFactor(password: string, code: string) {
		return auth
			.verifyTwoFactor(twoFactorMethod, code, hostedOAuthQuery())
			.pipe(
				Effect.matchEffect({
					onSuccess: () => openManagement(password),
					onFailure: (error) => Effect.succeed(error.reason),
				}),
			);
	}

	function finish() {
		runtime.runFork(
			auth.signOutHosted.pipe(
				Effect.ignore,
				Effect.andThen(
					from === "settings"
						? Effect.promise(() => navigate({ replace: true, to: "/settings/account" }))
						: Effect.sync(() => setStep({ kind: "finished" })),
				),
			),
		);
	}

	if (config.frontendOrigin !== server) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.oauth-shared.config-mismatch-title"))}
				message={t(
					kernelMessage("client.route.oauth-two-factor.mismatch-detail", {
						origin: config.frontendOrigin,
					}),
				)}
			/>
		);
	}

	if (!deriveAuthMethods(config).emailSignIn) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.oauth-two-factor.unavailable-title"))}
				message={t(kernelMessage("client.route.oauth-two-factor.unavailable-detail"))}
			/>
		);
	}

	if (step.kind === "finished") {
		return (
			<AuthStatus
				title={t(kernelMessage("client.settings.account.two-factor.title"))}
				message={t(kernelMessage("client.route.oauth-two-factor.finished-detail"))}
			/>
		);
	}

	return (
		<OAuthTwoFactorFrame>
			<section
				aria-labelledby="auth-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				{step.kind === "manage" && (
					<TwoFactorManagement
						actions={auth}
						onDone={finish}
						enabled={step.enabled}
						password={step.password}
					/>
				)}
				{step.kind === "challenge" && (
					<TwoFactorForm
						methods={step.methods}
						method={twoFactorMethod}
						onMethodChange={setTwoFactorMethod}
						onBack={() => setStep({ kind: "sign-in" })}
						onSubmit={(code) => submitTwoFactor(step.password, code)}
					/>
				)}
				{step.kind === "sign-in" && (
					<>
						<CredentialsForm
							mode="login"
							disabled={false}
							signupAllowed={false}
							onSubmit={submitCredentials}
							onModeChange={() => undefined}
						/>
						<p className="text-center text-xs text-text-subtle">
							{t(
								kernelMessage("client.route.oauth-two-factor.sign-in-again", {
									hostname: new URL(server).hostname,
								}),
							)}
						</p>
					</>
				)}
			</section>
		</OAuthTwoFactorFrame>
	);
}
