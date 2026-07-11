import { Button } from "@ryot/client-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { PublicApi } from "#/api/public";
import { deriveAuthMethods } from "#/modules/auth/config";
import type { AuthMode, TwoFactorMethod } from "#/modules/auth/flow";
import type { CredentialsValues } from "#/modules/auth/form-values";
import { CredentialsForm, TwoFactorForm } from "#/modules/auth/forms";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";

const ROUTE_ABORTED = { _tag: "RouteAborted" } as const;

export const Route = createFileRoute("/oauth/login")({
	component: OAuthLogin,
	errorComponent: OAuthLoginUnavailable,
	beforeLoad: () => ({ server: window.location.origin }),
	pendingComponent: () => (
		<AuthStatus title="Loading sign-in options" message="Reading this server's settings..." />
	),
	loader: ({ abortController, context }) =>
		context.runtime.runPromise(
			Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)),
			{ signal: abortController.signal },
		),
});

function OAuthLoginUnavailable() {
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

function OAuthLogin() {
	const config = Route.useLoaderData();
	const { runtime, server } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const controller = useRef(new AbortController());
	const oidcAutoLaunched = useRef(false);
	const [mode, setMode] = useState<AuthMode>("login");
	const [oidcError, setOidcError] = useState<string>();
	const [oidcPending, setOidcPending] = useState(false);
	const [twoFactorMethods, setTwoFactorMethods] = useState<readonly TwoFactorMethod[]>();
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
	useEffect(() => () => controller.current.abort(), []);

	const methods = deriveAuthMethods(config);

	async function submitCredentials(values: CredentialsValues) {
		const outcome = await runtime
			.runPromise(
				auth.submitCredentials({ mode, values }).pipe(
					Effect.match({
						onFailure: (error) => ({ error }) as const,
						onSuccess: (result) => ({ result }) as const,
					}),
				),
				{ signal: controller.current.signal },
			)
			.then(
				(result) => result,
				() => ROUTE_ABORTED,
			);
		if ("_tag" in outcome) {
			return undefined;
		}
		if ("error" in outcome) {
			return outcome.error.message;
		}
		if (outcome.result._tag === "TwoFactor") {
			setTwoFactorMethods(outcome.result.methods);
			setTwoFactorMethod(outcome.result.methods[0]);
		}
		return undefined;
	}

	async function submitTwoFactor(code: string) {
		return runtime
			.runPromise(
				auth
					.verifyTwoFactor(twoFactorMethod, code)
					.pipe(Effect.match({ onSuccess: () => undefined, onFailure: (error) => error.message })),
				{ signal: controller.current.signal },
			)
			.then(
				(result) => result,
				() => undefined,
			);
	}

	async function signInWithOidc() {
		if (oidcPending) {
			return;
		}
		setOidcError(undefined);
		setOidcPending(true);
		const error = await runtime
			.runPromise(
				auth
					.signInWithOidc()
					.pipe(
						Effect.match({ onSuccess: () => undefined, onFailure: (failure) => failure.message }),
					),
				{ signal: controller.current.signal },
			)
			.then(
				(result) => result,
				() => undefined,
			);
		if (error) {
			setOidcError(error);
			setOidcPending(false);
		}
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
			void launchOidc();
		}
	}, [config.frontendOrigin, methods.emailSignIn, methods.oidc, server]);

	if (config.frontendOrigin !== server) {
		return (
			<AuthStatus
				title="Server configuration mismatch"
				message={`This server is configured for ${config.frontendOrigin}. Open that address to sign in.`}
			/>
		);
	}

	if (!methods.emailSignIn && !methods.oidc) {
		return (
			<AuthStatus
				title="Authentication unavailable"
				message="This server has no browser sign-in method enabled."
			/>
		);
	}

	return (
		<main className="ui-page">
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
									Welcome back
								</h1>
								<p className="ui-subtitle">Continue with this server's identity provider.</p>
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
										or
									</p>
								)}
								{oidcError && (
									<p role="alert" className="ui-field-error">
										{oidcError}
									</p>
								)}
								<Button
									type="button"
									className="w-full"
									variant="secondary"
									disabled={oidcPending}
									onClick={() => void signInWithOidc()}
								>
									{oidcPending
										? "Opening provider..."
										: (methods.oidc.buttonLabel ?? "Sign in with OpenID Connect")}
								</Button>
							</div>
						)}
						<p className="text-center text-xs text-text-subtle">
							Server: {new URL(server).hostname}
						</p>
					</>
				)}
			</section>
		</main>
	);
}
