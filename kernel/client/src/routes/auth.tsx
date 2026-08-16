import type { SystemConfigResponse } from "@ryot/contract/modules/system/contract";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { ServerOrigin } from "../api/origin";
import { fetchSystemConfig } from "../api/public";
import { getAuthClient } from "../modules/auth/client";
import { deriveAuthMethods } from "../modules/auth/config";
import {
	type AuthMode,
	authDestination,
	authErrorMessage,
	availableTwoFactorMethods,
	isTwoFactorRedirect,
	type TwoFactorMethod,
} from "../modules/auth/flow";
import { registrationName, type CredentialsValues } from "../modules/auth/form-values";
import { CredentialsForm, TwoFactorForm } from "../modules/auth/forms";
import { decideAuthRoute, type AuthSessionState } from "../modules/auth/route-gates";
import { changeSelectedServer } from "../modules/auth/server-change";
import { sanitizeRedirect } from "../modules/server/redirect";
import { getServerSelection } from "../persistence/storage";

type ConfigState =
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "ready"; config: SystemConfigResponse };

export const Route = createFileRoute("/auth")({
	component: AuthDestination,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
});

function AuthDestination() {
	const server = getServerSelection();
	return server === null ? <MissingServer /> : <ConnectedAuth server={server} />;
}

function MissingServer() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	useEffect(() => {
		void navigate({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
	}, [navigate, search.redirect]);
	return <AuthStatus title="Selecting a server" message="Returning to server setup..." />;
}

function ConnectedAuth(props: { server: ServerOrigin }) {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const client = getAuthClient(props.server);
	const { data: session, isPending } = client.useSession();
	let sessionState: AuthSessionState = { status: "missing" };
	if (isPending) {
		sessionState = { status: "pending" };
	} else if (session) {
		sessionState = { status: "authenticated", userId: session.user.id };
	}
	const decision = decideAuthRoute(props.server, sessionState, search.redirect);

	useEffect(() => {
		if (decision.action === "redirect") {
			void navigate({ replace: true, to: decision.to, search: { redirect: undefined } });
		}
	}, [decision, navigate]);

	if (decision.action !== "stay") {
		return <AuthStatus title="Restoring your session" message="Checking your signed-in state..." />;
	}

	return <AuthGate redirectTo={decision.redirectTo} server={props.server} />;
}

function AuthGate(props: { server: ServerOrigin; redirectTo?: string }) {
	const navigate = Route.useNavigate();
	const client = getAuthClient(props.server);
	const destination = authDestination(props.redirectTo);
	const oidcAutoLaunched = useRef(false);
	const [retry, setRetry] = useState(0);
	const [mode, setMode] = useState<AuthMode>("login");
	const [configState, setConfigState] = useState<ConfigState>({ status: "loading" });
	const [oidcError, setOidcError] = useState<string>();
	const [oidcPending, setOidcPending] = useState(false);
	const [twoFactorMethods, setTwoFactorMethods] = useState<readonly TwoFactorMethod[]>();
	const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");

	useEffect(() => {
		let active = true;
		setConfigState({ status: "loading" });
		void (async () => {
			try {
				const config = await fetchSystemConfig(props.server);
				if (active) {
					setConfigState({ status: "ready", config });
				}
			} catch {
				if (active) {
					setConfigState({ status: "unavailable" });
				}
			}
		})();
		return () => {
			active = false;
		};
	}, [props.server, retry]);

	async function selectAnotherServer() {
		await changeSelectedServer(props.server);
		await navigate({ replace: true, to: "/onboarding", search: { redirect: props.redirectTo } });
	}

	async function submitCredentials(values: CredentialsValues) {
		try {
			if (mode === "signup") {
				const signup = await client.signUp.email({
					...values,
					name: registrationName(values.email),
				});
				if (signup.error) {
					return authErrorMessage(signup.error, "Could not create your account.");
				}
			}

			const signin = await client.signIn.email(values);
			if (signin.error) {
				return authErrorMessage(signin.error, "Could not sign in.");
			}
			if (isTwoFactorRedirect(signin.data)) {
				const methods = availableTwoFactorMethods(signin.data.twoFactorMethods);
				setTwoFactorMethods(methods);
				setTwoFactorMethod(methods[0]);
				return undefined;
			}
			await navigate({ replace: true, to: destination, search: { redirect: undefined } });
			return undefined;
		} catch (error) {
			return authErrorMessage(
				error,
				mode === "signup" ? "Could not create your account." : "Could not sign in.",
			);
		}
	}

	async function submitTwoFactor(code: string) {
		try {
			const result =
				twoFactorMethod === "backupCode"
					? await client.twoFactor.verifyBackupCode({ code })
					: await client.twoFactor.verifyTotp({ code });
			if (result.error) {
				return authErrorMessage(result.error, "Could not verify that code.");
			}
			await navigate({ replace: true, to: destination, search: { redirect: undefined } });
			return undefined;
		} catch (error) {
			return authErrorMessage(error, "Could not verify that code.");
		}
	}

	async function signInWithOidc() {
		if (oidcPending) {
			return;
		}
		setOidcError(undefined);
		setOidcPending(true);
		try {
			const result = await client.signIn.social({ provider: "oidc", callbackURL: destination });
			if (result.error) {
				setOidcError(authErrorMessage(result.error, "Could not open the identity provider."));
				setOidcPending(false);
			}
		} catch (error) {
			setOidcError(authErrorMessage(error, "Could not open the identity provider."));
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
						<button
							type="button"
							onClick={() => setRetry((value) => value + 1)}
							className="min-h-11 w-full cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink"
						>
							Try again
						</button>
						<button
							type="button"
							onClick={() => void selectAnotherServer()}
							className="min-h-10 cursor-pointer font-semibold text-text-muted"
						>
							Change server
						</button>
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
					<button
						type="button"
						onClick={() => void selectAnotherServer()}
						className="min-h-10 cursor-pointer font-semibold text-text-muted"
					>
						Change server
					</button>
				}
			/>
		);
	}

	return (
		<main className="grid min-h-screen content-center gap-8 px-5 pt-[max(72px,calc(env(safe-area-inset-top)+56px))] pb-[max(32px,env(safe-area-inset-bottom))]">
			<section
				aria-labelledby="auth-title"
				className="mx-auto grid w-[min(100%,480px)] gap-4.5 rounded-xl border border-border bg-surface p-5 shadow-card md:p-6"
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
							<div className="grid gap-4.5">
								<div>
									<h1
										id="auth-title"
										className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
									>
										Welcome back
									</h1>
									<p className="mt-3 text-text-muted">
										Continue with this server's identity provider.
									</p>
								</div>
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
							<div className="grid gap-4.5">
								{methods.emailSignIn && (
									<p className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-text-subtle uppercase before:h-px before:bg-border before:content-[''] after:h-px after:bg-border after:content-['']">
										or
									</p>
								)}
								{oidcError && (
									<p role="alert" className="text-sm font-normal text-danger">
										{oidcError}
									</p>
								)}
								<button
									type="button"
									disabled={oidcPending}
									onClick={() => void signInWithOidc()}
									className="min-h-11 w-full cursor-pointer rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text"
								>
									{oidcPending
										? "Opening provider..."
										: (methods.oidc.buttonLabel ?? "Sign in with OpenID Connect")}
								</button>
							</div>
						)}
						<button
							type="button"
							disabled={oidcPending}
							onClick={() => void selectAnotherServer()}
							className="min-h-10 w-full cursor-pointer font-semibold text-text-muted"
						>
							Change server
						</button>
					</>
				)}
			</section>
		</main>
	);
}

function AuthStatus(props: { title: string; message: string; actions?: React.ReactNode }) {
	return (
		<main className="grid min-h-screen content-center gap-8 px-5 pt-[max(72px,calc(env(safe-area-inset-top)+56px))] pb-[max(32px,env(safe-area-inset-bottom))]">
			<section
				aria-labelledby="auth-status-title"
				className="mx-auto grid w-[min(100%,480px)] gap-4.5 rounded-xl border border-border bg-surface p-5 shadow-card md:p-6"
			>
				<h1
					id="auth-status-title"
					className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
				>
					{props.title}
				</h1>
				<p role="status" className="mt-3 text-text-muted">
					{props.message}
				</p>
				{props.actions && <div className="grid gap-4.5">{props.actions}</div>}
			</section>
		</main>
	);
}
