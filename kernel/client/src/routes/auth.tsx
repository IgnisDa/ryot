import { Button } from "@ryot/client-ui-sdk";
import type { SystemConfigResponse } from "@ryot/contract/modules/system/contract";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { deriveAuthMethods } from "#/modules/auth/config";
import { type AuthMode, authDestination, type TwoFactorMethod } from "#/modules/auth/flow";
import type { CredentialsValues } from "#/modules/auth/form-values";
import { CredentialsForm, TwoFactorForm } from "#/modules/auth/forms";
import { decideAuthRoute } from "#/modules/auth/route-gates";
import { AuthService, toAuthSessionState } from "#/modules/auth/service";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";

type ConfigState =
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "ready"; config: SystemConfigResponse };

const ROUTE_ABORTED = { _tag: "RouteAborted" } as const;

export const Route = createFileRoute("/auth")({
	component: AuthDestination,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
	beforeLoad: async ({ context, search }) => {
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
		}
		const session = await context.runtime.runPromise(
			Effect.flatMap(AuthService, (service) => service.settledSession(server)),
		);
		const decision = decideAuthRoute(server, toAuthSessionState(session), search.redirect);
		if (decision.action === "redirect") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: decision.to, search: { redirect: undefined } });
		}
		return { server };
	},
});

function AuthDestination() {
	const { server } = Route.useRouteContext();
	const search = Route.useSearch();
	return <AuthGate redirectTo={search.redirect} server={server} />;
}

function AuthGate(props: { server: ServerOrigin; redirectTo?: string }) {
	const { runtime } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const api = runtime.runSync(PublicApi);
	const auth = runtime.runSync(AuthService);
	const destination = authDestination(props.redirectTo);
	const actionController = useRef(new AbortController());
	const oidcAutoLaunched = useRef(false);
	const [retry, setRetry] = useState(0);
	const [mode, setMode] = useState<AuthMode>("login");
	const [configState, setConfigState] = useState<ConfigState>({ status: "loading" });
	const [oidcError, setOidcError] = useState<string>();
	const [oidcPending, setOidcPending] = useState(false);
	const [twoFactorMethods, setTwoFactorMethods] = useState<readonly TwoFactorMethod[]>();
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
	useEffect(() => () => actionController.current.abort(), []);

	useEffect(() => {
		const controller = new AbortController();
		setConfigState({ status: "loading" });
		void runtime.runPromise(api.getSystemConfig(props.server), { signal: controller.signal }).then(
			(config) => setConfigState({ status: "ready", config }),
			() => {
				if (!controller.signal.aborted) {
					setConfigState({ status: "unavailable" });
				}
			},
		);
		return () => controller.abort();
	}, [api, props.server, retry, runtime]);

	async function selectAnotherServer() {
		const changed = await runtime
			.runPromise(auth.changeServer(props.server), { signal: actionController.current.signal })
			.then(
				() => true,
				() => false,
			);
		if (!changed) {
			return;
		}
		await navigate({ replace: true, to: "/onboarding", search: { redirect: props.redirectTo } });
	}

	async function submitCredentials(values: CredentialsValues) {
		const outcome = await runtime
			.runPromise(
				auth.submitCredentials({ mode, origin: props.server, values }).pipe(
					Effect.match({
						onFailure: (error) => ({ error }) as const,
						onSuccess: (result) => ({ result }) as const,
					}),
				),
				{ signal: actionController.current.signal },
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
			return undefined;
		}
		await navigate({ replace: true, to: destination, search: { redirect: undefined } });
		return undefined;
	}

	async function submitTwoFactor(code: string) {
		const error = await runtime
			.runPromise(
				auth.verifyTwoFactor(props.server, twoFactorMethod, code).pipe(
					Effect.match({
						onSuccess: () => undefined,
						onFailure: (failure) => failure.message,
					}),
				),
				{ signal: actionController.current.signal },
			)
			.then(
				(result) => result,
				() => ROUTE_ABORTED,
			);
		if (typeof error === "object") {
			return undefined;
		}
		if (error) {
			return error;
		}
		await navigate({ replace: true, to: destination, search: { redirect: undefined } });
		return undefined;
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
					.signInWithOidc(props.server, destination)
					.pipe(
						Effect.match({ onSuccess: () => undefined, onFailure: (failure) => failure.message }),
					),
				{ signal: actionController.current.signal },
			)
			.then(
				(result) => result,
				() => ROUTE_ABORTED,
			);
		if (typeof error === "object") {
			return;
		}
		if (error) {
			setOidcError(error);
			setOidcPending(false);
		}
	}

	const launchOidc = useEffectEvent(signInWithOidc);
	const methods =
		configState.status === "ready" ? deriveAuthMethods(configState.config) : undefined;

	useEffect(() => {
		if (methods?.oidc && !methods.emailSignIn && !oidcAutoLaunched.current) {
			oidcAutoLaunched.current = true;
			void launchOidc();
		}
	}, [methods]);

	if (configState.status === "loading") {
		return (
			<AuthStatus title="Loading sign-in options" message="Reading this server's settings..." />
		);
	}

	if (configState.status === "unavailable") {
		return (
			<AuthStatus
				title="Could not reach this server"
				message="Authentication settings could not be loaded. Check the server and try again."
				actions={
					<>
						<Button
							type="button"
							variant="primary"
							className="w-full"
							onClick={() => setRetry((value) => value + 1)}
						>
							Try again
						</Button>
						<Button type="button" variant="text" onClick={() => void selectAnotherServer()}>
							Change server
						</Button>
					</>
				}
			/>
		);
	}

	if (!methods?.emailSignIn && !methods?.oidc) {
		return (
			<AuthStatus
				title="Authentication unavailable"
				message="This server has no browser sign-in method enabled."
				actions={
					<Button type="button" variant="text" onClick={() => void selectAnotherServer()}>
						Change server
					</Button>
				}
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
								onSubmit={submitCredentials}
								signupAllowed={methods.emailSignUp}
								onModeChange={(nextMode) => setMode(nextMode)}
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
						<Button
							type="button"
							variant="text"
							className="w-full"
							disabled={oidcPending}
							onClick={() => void selectAnotherServer()}
						>
							Change server
						</Button>
					</>
				)}
			</section>
		</main>
	);
}

function AuthStatus(props: { title: string; message: string; actions?: React.ReactNode }) {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="auth-status-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="auth-status-title" className="ui-heading">
						{props.title}
					</h1>
					<p role="status" className="ui-subtitle">
						{props.message}
					</p>
				</div>
				{props.actions && <div className="ui-stack">{props.actions}</div>}
			</section>
		</main>
	);
}
