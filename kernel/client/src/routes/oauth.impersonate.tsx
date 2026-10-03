import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { HostedAuthService } from "#/modules/auth/hosted-service";
import { parseImpersonationHandoff } from "#/modules/auth/impersonation-handoff";
import { AuthStatus } from "#/modules/auth/status";

export const Route = createFileRoute("/oauth/impersonate")({
	component: OAuthImpersonate,
	beforeLoad: () => parseImpersonationHandoff(window.location.href),
});

function OAuthImpersonate() {
	const { url, ticket, runtime } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const started = useRef(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		window.history.replaceState(window.history.state, "", url);
		if (ticket === null) {
			return;
		}
		runtime.runFork(
			auth.redeemImpersonation(ticket).pipe(
				Effect.tap(({ authorizationUrl }) =>
					Effect.sync(() => window.location.assign(authorizationUrl)),
				),
				Effect.catch((failure) => Effect.sync(() => setError(failure.message))),
			),
		);
	}, [auth, runtime, ticket, url]);

	const message =
		error ??
		(ticket === null
			? "This impersonation request is missing or invalid. Start it again from God Mode."
			: "Continuing through the server's secure sign-in flow...");

	return (
		<AuthStatus
			message={message}
			title={error || ticket === null ? "Could not start impersonation" : "Starting secure sign-in"}
		/>
	);
}
