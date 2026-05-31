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
			<main className="grid min-h-screen content-center gap-8 px-5 pt-[max(72px,calc(env(safe-area-inset-top)+56px))] pb-[max(32px,env(safe-area-inset-bottom))]">
				<section
					aria-labelledby="session-title"
					className="mx-auto grid w-[min(100%,480px)] gap-4.5 rounded-xl border border-border bg-surface p-5 shadow-card md:p-6"
				>
					<h1
						id="session-title"
						className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
					>
						Restoring your session
					</h1>
					<p role="status" className="mt-3 text-text-muted">
						Checking your signed-in state...
					</p>
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
					<p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-accent-text uppercase">
						Ryot kernel
					</p>
					<h1 className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight">
						Your library
					</h1>
				</div>
				<nav aria-label="Session controls" className="flex flex-wrap gap-2.5">
					<button
						type="button"
						onClick={() => void changeServer()}
						disabled={pendingAction !== undefined}
						className="min-h-11 cursor-pointer rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text"
					>
						{pendingAction === "server" ? "Changing..." : "Change server"}
					</button>
					<button
						type="button"
						onClick={() => void signOut()}
						disabled={pendingAction !== undefined}
						className="min-h-11 cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink"
					>
						{pendingAction === "signout" ? "Signing out..." : "Sign out"}
					</button>
				</nav>
			</header>
			<section
				aria-labelledby="kernel-ready-title"
				className="mt-8 rounded-xl border border-border bg-surface p-6 shadow-card"
			>
				<p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-accent-text uppercase">
					Authenticated
				</p>
				<h2 id="kernel-ready-title" className="font-display text-2xl">
					Kernel shell ready
				</h2>
				<p className="mt-3">{props.email}</p>
				<p className="text-sm wrap-anywhere text-text-muted">{props.scope.serverUrl}</p>
			</section>
		</main>
	);
}
