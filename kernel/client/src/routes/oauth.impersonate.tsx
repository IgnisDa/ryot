import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	const t = useT();
	const { url, ticket, runtime } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const started = useRef(false);
	const [error, setError] = useState<Message>();

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
				Effect.catch((failure) => Effect.sync(() => setError(failure.reason))),
			),
		);
	}, [auth, runtime, ticket, url]);

	const message =
		error ??
		(ticket === null
			? kernelMessage("client.route.oauth-impersonate.invalid-detail")
			: kernelMessage("client.route.oauth-impersonate.continuing-detail"));

	return (
		<AuthStatus
			message={t(message)}
			title={t(
				error || ticket === null
					? kernelMessage("client.route.oauth-impersonate.failed-title")
					: kernelMessage("client.route.oauth-impersonate.starting-title"),
			)}
		/>
	);
}
