import { Button } from "@ryot/client-ui-sdk";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { OAuthLauncher, type OAuthLaunchPlan } from "#/modules/auth/oauth-launcher";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";
import { sanitizeRedirect } from "#/modules/server/redirect";

export const Route = createFileRoute("/auth")({
	component: OAuthLaunch,
	pendingComponent: () => (
		<AuthStatus
			title="Preparing sign-in"
			message="Restoring your session and contacting the server..."
		/>
	),
	errorComponent: OAuthLaunchUnavailable,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
	beforeLoad: async ({ context, search }) => {
		const result = await context.runtime.runPromise(
			Effect.flatMap(OAuthLauncher, (launcher) => launcher.prepare(search.redirect)),
		);
		if (result._tag === "MissingServer") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
		}
		if (result._tag === "Authenticated") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: result.destination, search: { redirect: undefined } });
		}
		return { plan: result.plan };
	},
});

function OAuthLaunchUnavailable({ error }: { error: Error }) {
	const router = useRouter();
	const reason = "reason" in error ? error.reason : undefined;
	const message =
		reason === "unknown-native-application"
			? "This native application identifier is not registered for Ryot sign-in."
			: "The server could not prepare a secure sign-in request.";
	return (
		<AuthStatus
			title="Could not start sign-in"
			message={message}
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

function OAuthLaunch() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { plan, runtime } = Route.useRouteContext();
	const launcher = runtime.runSync(OAuthLauncher);
	const auth = runtime.runSync(AuthService);
	const launched = useRef(false);
	const [failedPlan, setFailedPlan] = useState<OAuthLaunchPlan>();

	function launch(target: OAuthLaunchPlan) {
		setFailedPlan(undefined);
		void runtime.runPromise(launcher.launch(target)).catch(() => setFailedPlan(target));
	}
	const launchAuth = useEffectEvent(launch);

	useEffect(() => {
		if (!launched.current) {
			launched.current = true;
			launchAuth(plan);
		}
	}, [plan]);

	async function changeServer() {
		await runtime.runPromise(auth.changeServer(plan.pending.serverOrigin));
		await navigate({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
	}

	if (failedPlan) {
		return (
			<AuthStatus
				title="Could not open sign-in"
				message="The browser could not be opened. Try again or select another server."
				actions={
					<>
						<Button
							type="button"
							variant="primary"
							className="w-full"
							onClick={() => launch(failedPlan)}
						>
							Try again
						</Button>
						{plan.isNative && (
							<Button type="button" variant="text" onClick={() => void changeServer()}>
								Change server
							</Button>
						)}
					</>
				}
			/>
		);
	}

	return (
		<AuthStatus
			title="Opening sign-in"
			message={`Continuing with ${new URL(plan.pending.serverOrigin).hostname}...`}
		/>
	);
}
