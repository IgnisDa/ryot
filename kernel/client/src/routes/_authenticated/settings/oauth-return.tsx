import { useRyotMutation } from "@ryot-app/client-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Match, Option } from "effect";
import { useEffect, useEffectEvent, useState } from "react";

import {
	completeOAuthConnectionMutation,
	OAuthReturnCapture,
} from "#/modules/integrations/oauth-return";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { StatusState } from "#/modules/ui/status-state";

export const Route = createFileRoute("/_authenticated/settings/oauth-return")({
	component: OAuthReturnRoute,
});

type OAuthReturnState = "completing" | "connected" | "failed" | "empty";

function OAuthReturnRoute() {
	const { runtime } = Route.useRouteContext();
	const complete = useRyotMutation(completeOAuthConnectionMutation);
	const [fragment] = useState(() =>
		runtime.runSync(Effect.flatMap(OAuthReturnCapture, (capture) => capture.take)),
	);
	const [state, setState] = useState<OAuthReturnState>(() => {
		if (Option.isNone(fragment)) {
			return "empty";
		}
		const { secret, connection } = fragment.value;
		return connection !== undefined && secret !== undefined ? "completing" : "failed";
	});

	const finish = useEffectEvent(() => {
		if (Option.isNone(fragment)) {
			return Effect.void;
		}
		const closeWindow = Effect.flatMap(OAuthReturnCapture, (capture) => capture.closeWindow);
		const { secret, connection } = fragment.value;
		if (connection === undefined || secret === undefined) {
			return closeWindow;
		}
		return complete.mutateEffect({ secret, connectionId: connection }).pipe(
			Effect.match({ onFailure: () => "failed" as const, onSuccess: () => "connected" as const }),
			Effect.flatMap((next) => Effect.sync(() => setState(next))),
			Effect.andThen(closeWindow),
		);
	});

	useEffect(() => {
		void runtime.runPromise(finish());
	}, [runtime]);

	return (
		<SettingsFrame title="Connect an account" backFallbackHref="/settings/integrations">
			{Match.value(state).pipe(
				Match.when("completing", () => (
					<StatusState className="py-16" detail="Finishing the connection…" />
				)),
				Match.when("connected", () => (
					<StatusState
						className="py-16"
						title="Connected"
						detail="Connected — you can close this window."
					/>
				)),
				Match.when("failed", () => (
					<StatusState
						className="py-16"
						detailTone="danger"
						title="Couldn't connect"
						detail="The account could not be connected. Close this window and try again."
					/>
				)),
				Match.when("empty", () => (
					<StatusState
						className="py-16"
						title="Nothing to connect"
						detail="There is no account connection waiting to finish."
					/>
				)),
				Match.exhaustive,
			)}
		</SettingsFrame>
	);
}
