import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
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

type OAuthReturnState = "empty" | "failed" | "connected" | "completing";

function OAuthReturnRoute() {
	const t = useT();
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
		<SettingsFrame
			backFallbackHref="/settings/integrations"
			title={t(kernelMessage("client.route.settings.oauth-return.title"))}
		>
			{Match.value(state).pipe(
				Match.when("completing", () => (
					<StatusState
						className="py-16"
						detail={t(kernelMessage("client.route.settings.oauth-return.completing"))}
					/>
				)),
				Match.when("connected", () => (
					<StatusState
						className="py-16"
						title={t(kernelMessage("client.route.settings.oauth-return.connected-title"))}
						detail={t(kernelMessage("client.route.settings.oauth-return.connected-detail"))}
					/>
				)),
				Match.when("failed", () => (
					<StatusState
						className="py-16"
						detailTone="danger"
						title={t(kernelMessage("client.route.settings.oauth-return.failed-title"))}
						detail={t(kernelMessage("client.route.settings.oauth-return.failed-detail"))}
					/>
				)),
				Match.when("empty", () => (
					<StatusState
						className="py-16"
						title={t(kernelMessage("client.route.settings.oauth-return.empty-title"))}
						detail={t(kernelMessage("client.route.settings.oauth-return.empty-detail"))}
					/>
				)),
				Match.exhaustive,
			)}
		</SettingsFrame>
	);
}
