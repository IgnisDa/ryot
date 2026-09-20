import { Button } from "@ryot-app/client-ui-sdk";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Effect, Schedule } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";

export const Route = createFileRoute("/oauth/initializing")({ component: OAuthInitializing });

function OAuthInitializing() {
	const navigate = useNavigate();
	const { runtime } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const controller = useRef(new AbortController());
	const [error, setError] = useState<string>();
	const [signingOut, setSigningOut] = useState(false);
	function watchInitialization(signal: AbortSignal) {
		runtime.runFork(
			auth.initializationStatus.pipe(
				Effect.repeat({
					schedule: Schedule.spaced("2 seconds"),
					while: ({ status }) => status === "initializing",
				}),
				Effect.andThen(auth.continueAfterInitialization),
				Effect.catch((failure) => Effect.sync(() => setError(failure.message))),
			),
			{ signal },
		);
	}
	const watchOnMount = useEffectEvent(watchInitialization);

	useEffect(() => {
		watchOnMount(controller.current.signal);
		return () => controller.current.abort();
	}, []);

	function tryAgain() {
		controller.current.abort();
		controller.current = new AbortController();
		setError(undefined);
		watchInitialization(controller.current.signal);
	}

	function signOut() {
		if (signingOut) {
			return;
		}
		setSigningOut(true);
		runtime.runFork(
			auth.signOutHosted.pipe(
				Effect.tap(() =>
					Effect.promise(() =>
						navigate({ to: "/auth", replace: true, search: { redirect: undefined } }),
					),
				),
				Effect.catch((failure) =>
					Effect.sync(() => {
						setError(failure.message);
						setSigningOut(false);
					}),
				),
			),
		);
	}

	return (
		<AuthStatus
			title={error ? "Account initialization paused" : "Preparing your account"}
			message={
				error ??
				"Your account is secure. Ryot is preparing your workspace and will continue automatically."
			}
			actions={
				<div className="grid gap-2">
					{error && (
						<Button type="button" variant="primary" className="w-full" onClick={tryAgain}>
							Try again
						</Button>
					)}
					<Button
						type="button"
						onClick={signOut}
						className="w-full"
						variant="secondary"
						disabled={signingOut}
					>
						{signingOut ? "Signing out..." : "Sign out"}
					</Button>
				</div>
			}
		/>
	);
}
