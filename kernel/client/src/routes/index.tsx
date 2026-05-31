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
		<main className="mx-auto min-h-screen w-[min(100%,1040px)] px-5 pt-[max(88px,calc(env(safe-area-inset-top)+72px))] pb-[max(32px,env(safe-area-inset-bottom))]">
			<header className="flex flex-col gap-6 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
				<div>
					<p className="ui-overline">Ryot kernel</p>
					<h1 className="ui-heading">Your library</h1>
				</div>
				<nav aria-label="Session controls" className="flex flex-wrap gap-2.5">
					<button
						type="button"
						onClick={() => void changeServer()}
						disabled={pendingAction !== undefined}
						className="ui-button-secondary"
					>
						{pendingAction === "server" ? "Changing..." : "Change server"}
					</button>
					<button
						type="button"
						onClick={() => void signOut()}
						disabled={pendingAction !== undefined}
						className="ui-button-primary"
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
