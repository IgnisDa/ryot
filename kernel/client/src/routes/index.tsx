import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { ServerOrigin } from "../api/origin";
import type { ApiScope } from "../api/scope";
import { clearAuthStorage, getAuthClient } from "../modules/auth/client";
import { signOutToAuth } from "../modules/auth/flow";
import { decideProtectedRoute, type AuthSessionState } from "../modules/auth/route-gates";
import { changeSelectedServer } from "../modules/auth/server-change";
import { getServerSelection } from "../persistence/storage";

export const Route = createFileRoute("/")({
	component: KernelDestination,
	beforeLoad: () => {
		if (getServerSelection() === null) {
			return redirect({ to: "/onboarding", search: { redirect: "/" } });
		}
		return undefined;
	},
});

function KernelDestination() {
	const server = getServerSelection();
	return server === null ? null : <ConnectedKernel server={server} />;
}

function ConnectedKernel(props: { server: ServerOrigin }) {
	const navigate = Route.useNavigate();
	const client = getAuthClient(props.server);
	const { data: session, isPending } = client.useSession();
	let sessionState: AuthSessionState = { status: "missing" };
	if (isPending) {
		sessionState = { status: "pending" };
	} else if (session) {
		sessionState = { status: "authenticated", userId: session.user.id };
	}
	const decision = decideProtectedRoute(props.server, sessionState, "/");

	useEffect(() => {
		if (decision.action === "redirect") {
			void navigate({
				replace: true,
				to: decision.to,
				search: { redirect: decision.redirectTo },
			});
		}
	}, [decision, navigate]);

	if (decision.action !== "allow") {
		return (
			<main className="auth-shell">
				<section className="auth-card" aria-labelledby="session-title">
					<h1 id="session-title">Restoring your session</h1>
					<p role="status">Checking your signed-in state...</p>
				</section>
			</main>
		);
	}

	return (
		<KernelShell
			server={props.server}
			scope={decision.scope}
			email={session?.user.email ?? "Signed-in user"}
		/>
	);
}

function KernelShell(props: { email: string; scope: ApiScope; server: ServerOrigin }) {
	const navigate = Route.useNavigate();
	const [pendingAction, setPendingAction] = useState<"server" | "signout">();

	async function signOut() {
		setPendingAction("signout");
		await signOutToAuth({
			clearAuth: clearAuthStorage,
			signOut: () => getAuthClient(props.server).signOut(),
			navigate: () => navigate({ replace: true, to: "/auth", search: { redirect: undefined } }),
		});
	}

	async function changeServer() {
		setPendingAction("server");
		await changeSelectedServer(props.server);
		await navigate({ replace: true, to: "/onboarding", search: { redirect: undefined } });
	}

	return (
		<main className="kernel-shell">
			<header className="kernel-header">
				<div>
					<p className="overline">Ryot kernel</p>
					<h1>Your library</h1>
				</div>
				<nav aria-label="Session controls">
					<button
						type="button"
						className="secondary-button"
						onClick={() => void changeServer()}
						disabled={pendingAction !== undefined}
					>
						{pendingAction === "server" ? "Changing..." : "Change server"}
					</button>
					<button
						type="button"
						className="primary-button"
						onClick={() => void signOut()}
						disabled={pendingAction !== undefined}
					>
						{pendingAction === "signout" ? "Signing out..." : "Sign out"}
					</button>
				</nav>
			</header>
			<section className="kernel-panel" aria-labelledby="kernel-ready-title">
				<p className="overline">Authenticated</p>
				<h2 id="kernel-ready-title">Kernel shell ready</h2>
				<p>{props.email}</p>
				<p className="server-identity">{props.scope.serverUrl}</p>
			</section>
		</main>
	);
}
