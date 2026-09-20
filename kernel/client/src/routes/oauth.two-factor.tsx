import { Button } from "@ryot-app/client-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useState } from "react";

import { decodeServerOrigin } from "#/api/origin";
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
	errorComponent: OAuthTwoFactorUnavailable,
	beforeLoad: () => ({ server: decodeServerOrigin(window.location.origin) }),
	validateSearch: (search) => ({
		from: search.from === "settings" ? ("settings" as const) : undefined,
	}),
	pendingComponent: () => (
		<AuthStatus title="Loading sign-in options" message="Reading this server's settings..." />
	),
	loader: ({ context, abortController }) =>
		context.runtime.runPromise(
			Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)),
			{ signal: abortController.signal },
		),
});

type Step =
	| { readonly kind: "sign-in" }
	| { readonly kind: "finished" }
	| { readonly kind: "manage"; readonly enabled: boolean }
	| { readonly kind: "challenge"; readonly methods: readonly TwoFactorMethod[] };

function OAuthTwoFactorUnavailable() {
	const router = useRouter();
	return (
		<AuthStatus
			title="Could not reach this server"
			message="Authentication settings could not be loaded. Check the server and try again."
			actions={
				<Button
					type="button"
					variant="primary"
					className="w-full"
					onClick={() => void router.invalidate()}
				>
					Try again
				</Button>
			}
		/>
	);
}

function OAuthTwoFactor() {
	const config = Route.useLoaderData();
	const { from } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { server, runtime } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const [step, setStep] = useState<Step>({ kind: "sign-in" });
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");

	const openManagement = auth.twoFactorSession.pipe(
		Effect.match({
			onFailure: (error) => error.message,
			onSuccess: (session) => {
				setStep({ kind: "manage", enabled: session.twoFactorEnabled });
				return undefined;
			},
		}),
	);

	function submitCredentials(values: CredentialsValues) {
		return auth.submitCredentials({ values, mode: "login" }).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(error.message),
				onSuccess: (result) => {
					if (result._tag === "TwoFactor") {
						setTwoFactorMethod(result.methods[0]);
						setStep({ kind: "challenge", methods: result.methods });
						return Effect.undefined;
					}
					return openManagement;
				},
			}),
		);
	}

	function submitTwoFactor(code: string) {
		return auth
			.verifyTwoFactor(twoFactorMethod, code)
			.pipe(
				Effect.matchEffect({
					onSuccess: () => openManagement,
					onFailure: (error) => Effect.succeed(error.message),
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
				title="Server configuration mismatch"
				message={`This server is configured for ${config.frontendOrigin}. Open that address to manage two-factor authentication.`}
			/>
		);
	}

	if (!deriveAuthMethods(config).emailSignIn) {
		return (
			<AuthStatus
				title="Two-factor authentication unavailable"
				message="Two-factor authentication management requires password sign-in, which this server has disabled."
			/>
		);
	}

	if (step.kind === "finished") {
		return (
			<AuthStatus
				title="Two-factor authentication"
				message="You can close this window and return to Ryot."
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
					<TwoFactorManagement actions={auth} onDone={finish} enabled={step.enabled} />
				)}
				{step.kind === "challenge" && (
					<TwoFactorForm
						methods={step.methods}
						method={twoFactorMethod}
						onSubmit={submitTwoFactor}
						onMethodChange={setTwoFactorMethod}
						onBack={() => setStep({ kind: "sign-in" })}
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
							Sign in again to manage two-factor authentication on {new URL(server).hostname}.
						</p>
					</>
				)}
			</section>
		</OAuthTwoFactorFrame>
	);
}

function OAuthTwoFactorFrame(props: { readonly children: ReactNode }) {
	usePageTitle("Two-factor authentication");
	return (
		<main {...mainContentProps} className="ui-page">
			{props.children}
		</main>
	);
}
