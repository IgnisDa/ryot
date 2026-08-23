import { createRyotMutation, RyotProvider, useRyotMutation } from "@ryot/client-sdk/react";
import { Button } from "@ryot/client-ui-sdk";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ServerOrigin } from "#/api/origin";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import { protectedRouteGuard } from "#/modules/auth/route-gates";
import { AuthService } from "#/modules/auth/service";
import type { ClientRuntime } from "#/runtime";

type SignOutInput = {
	readonly server: ServerOrigin;
	readonly runtime: ClientRuntime;
	readonly auth: AuthService["Service"];
};

const signOutMutation = createRyotMutation<SignOutInput, void>(({ input, signal }) =>
	input.runtime.runPromise(input.auth.signOut(input.server), { signal }),
);

export const Route = createFileRoute("/")({
	component: KernelDestination,
	beforeLoad: ({ context }) => protectedRouteGuard(context, "/"),
});

function KernelDestination() {
	const { runtime, server, scope, theme } = Route.useRouteContext();
	const auth = runtime.runSync(AuthService);
	const store = auth.session(server);
	const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const email = session.status === "authenticated" ? session.user.email : "Signed-in user";
	const ryot = useMemo(
		() => createKernelRyotClient(runtime, scope, theme),
		[runtime, scope, theme],
	);
	return (
		<RyotProvider client={ryot}>
			<KernelShell server={server} scope={scope} email={email} />
		</RyotProvider>
	);
}

function KernelShell(props: { email: string; scope: ApiScope; server: ServerOrigin }) {
	const { runtime } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const auth = runtime.runSync(AuthService);
	const signOutAction = useRyotMutation(signOutMutation);
	const actionController = useRef(new AbortController());
	const [changingServer, setChangingServer] = useState(false);
	useEffect(() => () => actionController.current.abort(), []);

	async function signOut() {
		const signedOut = await signOutAction.mutateAsync({ auth, runtime, server: props.server }).then(
			() => true,
			() => false,
		);
		if (!signedOut) {
			return;
		}
		await navigate({ replace: true, to: "/auth", search: { redirect: undefined } });
	}

	async function changeServer() {
		setChangingServer(true);
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
					<Button
						type="button"
						variant="secondary"
						onClick={() => void changeServer()}
						disabled={changingServer || signOutAction.isPending}
					>
						{changingServer ? "Changing..." : "Change server"}
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void signOut()}
						disabled={changingServer || signOutAction.isPending}
					>
						{signOutAction.isPending ? "Signing out..." : "Sign out"}
					</Button>
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
