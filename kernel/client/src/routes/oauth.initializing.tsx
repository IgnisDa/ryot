import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Effect, Schedule } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";

export const Route = createFileRoute("/oauth/initializing")({ component: OAuthInitializing });

function OAuthInitializing() {
	const t = useT();
	const navigate = useNavigate();
	const { runtime, hostedOAuthQuery } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const controller = useRef(new AbortController());
	const [error, setError] = useState<Message>();
	const [signingOut, setSigningOut] = useState(false);
	function watchInitialization(signal: AbortSignal) {
		runtime.runFork(
			auth.initializationStatus.pipe(
				Effect.repeat({
					schedule: Schedule.spaced("2 seconds"),
					while: ({ status }) => status === "initializing",
				}),
				Effect.andThen(() => auth.continueAfterInitialization(hostedOAuthQuery())),
				Effect.catch((failure) => Effect.sync(() => setError(failure.reason))),
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
						setError(failure.reason);
						setSigningOut(false);
					}),
				),
			),
		);
	}

	return (
		<AuthStatus
			message={t(error ?? kernelMessage("client.route.oauth-initializing.preparing-detail"))}
			title={
				error
					? t(kernelMessage("client.route.oauth-initializing.paused-title"))
					: t(kernelMessage("client.route.oauth-initializing.preparing-title"))
			}
			actions={
				<div className="grid gap-2">
					{error && (
						<Button type="button" variant="primary" className="w-full" onClick={tryAgain}>
							{t(kernelMessage("common.action.try-again"))}
						</Button>
					)}
					<Button
						type="button"
						onClick={signOut}
						className="w-full"
						variant="secondary"
						disabled={signingOut}
					>
						{signingOut
							? t(kernelMessage("client.settings.account.session.signing-out"))
							: t(kernelMessage("common.action.sign-out"))}
					</Button>
				</div>
			}
		/>
	);
}
