import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ServerOrigin } from "../api/origin";
import type { ApiScope } from "../api/scope";
import { decideProtectedRoute, type AuthSessionState } from "../modules/auth/route-gates";
import { AuthService } from "../modules/auth/service";
import { ServerService } from "../modules/server/service";

export const Route = createFileRoute("/")({
	component: KernelDestination,
	beforeLoad: ({ context }) => {
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			return redirect({ to: "/onboarding", search: { redirect: "/" } });
		}
		return undefined;
	},
});

function KernelDestination() {
	const { runtime } = Route.useRouteContext();
	const server = runtime.runSync(Effect.flatMap(ServerService, (service) => service.selected));
	return server === null ? null : <ConnectedKernel server={server} />;
}

function ConnectedKernel(props: { server: ServerOrigin }) {
	const { runtime } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const auth = runtime.runSync(AuthService);
	const store = auth.session(props.server);
	const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	let sessionState: AuthSessionState = { status: "missing" };
	if (session.status === "pending") {
		sessionState = { status: "pending" };
	} else if (session.status === "authenticated") {
		sessionState = { status: "authenticated", userId: session.user.id };
	}
	const decision = decideProtectedRoute(props.server, sessionState, "/");

	useEffect(() => {
		if (decision.action === "redirect") {
			void navigate({ replace: true, to: decision.to, search: { redirect: decision.redirectTo } });
		}
	}, [decision, navigate]);

	if (decision.action !== "allow") {
		return (
			<main className="ui-page">
				<section
					aria-labelledby="session-title"
					className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
				>
					<div>
						<h1 id="session-title" className="ui-heading">
							Restoring your session
						</h1>
						<p role="status" className="ui-subtitle">
							Checking your signed-in state...
						</p>
					</div>
				</section>
			</main>
		);
	}

	return (
		<KernelShell
			server={props.server}
			scope={decision.scope}
			email={session.status === "authenticated" ? session.user.email : "Signed-in user"}
		/>
	);
}

function KernelShell(props: { email: string; scope: ApiScope; server: ServerOrigin }) {
	const { runtime } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const auth = runtime.runSync(AuthService);
	const actionController = useRef(new AbortController());
	const [pendingAction, setPendingAction] = useState<"server" | "signout">();
	useEffect(() => () => actionController.current.abort(), []);

	async function signOut() {
		setPendingAction("signout");
		const signedOut = await runtime
			.runPromise(auth.signOut(props.server), { signal: actionController.current.signal })
			.then(
				() => true,
				() => false,
			);
		if (!signedOut) {
			return;
		}
		await navigate({ replace: true, to: "/auth", search: { redirect: undefined } });
	}

	async function changeServer() {
		setPendingAction("server");
		const changed = await runtime
			.runPromise(auth.changeServer(props.server), { signal: actionController.current.signal })
			.then(
				() => true,
				() => false,
			);
		if (!changed) {
			return;
		}
		await navigate({ replace: true, to: "/onboarding", search: { redirect: undefined } });
	}

	return (
		<main className="mx-auto min-h-screen w-[min(100%,1040px)] px-5 pt-[max(88px,calc(env(safe-area-inset-top)+72px))] pb-[max(32px,env(safe-area-inset-bottom))]">
			<header className="flex flex-col gap-6 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
				<div>
					<p className="ui-overline">Ryot kernel</p>
					<h1 className="ui-heading">Your library</h1>
				</div>
				<nav aria-label="Session controls" className="flex flex-wrap gap-2.5">
					<button
						type="button"
						className="ui-button-secondary"
						onClick={() => void changeServer()}
						disabled={pendingAction !== undefined}
					>
						{pendingAction === "server" ? "Changing..." : "Change server"}
					</button>
					<button
						type="button"
						className="ui-button-primary"
						onClick={() => void signOut()}
						disabled={pendingAction !== undefined}
					>
						{pendingAction === "signout" ? "Signing out..." : "Sign out"}
					</button>
				</nav>
			</header>
			<section
				aria-labelledby="kernel-ready-title"
				className="mt-8 rounded-xl border border-border bg-surface p-6 shadow-card"
			>
				<p className="ui-overline">Authenticated</p>
				<h2 id="kernel-ready-title" className="font-display text-2xl">
					Kernel shell ready
				</h2>
				<p className="mt-3">{props.email}</p>
				<p className="text-sm wrap-anywhere text-text-muted">{props.scope.serverUrl}</p>
			</section>
		</main>
	);
}
