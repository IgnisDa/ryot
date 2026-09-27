import { createRyotMutation } from "@ryot-app/client-sdk/react";
import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	OAUTH_CONNECTION_RETURN_PATH,
	OAuthConnectionReturnFragment,
} from "@ryot-app/contract/modules/oauth-connections/schemas";
import type { OAuthConnectionId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Option, Schema } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import type { KernelHostServices } from "#/host-services";

type ReturnLocation = Pick<Location, "hash" | "pathname" | "search">;

type ReturnHistory = Pick<History, "replaceState" | "state">;

const decodeFragment = Schema.decodeUnknownOption(OAuthConnectionReturnFragment);

export const decodeOAuthReturnFragment = (hash: string) =>
	decodeFragment(Object.fromEntries(new URLSearchParams(hash.replace(/^#/, ""))));

export const captureOAuthReturnFragment = (location: ReturnLocation, history: ReturnHistory) => {
	if (location.pathname !== OAUTH_CONNECTION_RETURN_PATH || location.hash === "") {
		return Option.none<OAuthConnectionReturnFragment>();
	}
	const fragment = decodeOAuthReturnFragment(location.hash);
	history.replaceState(history.state, "", `${location.pathname}${location.search}`);
	return fragment;
};

export const makeOAuthReturnCapture = (closeWindow: () => void) => {
	let captured = Option.none<OAuthConnectionReturnFragment>();
	return {
		closeWindow: Effect.sync(closeWindow),
		take: Effect.sync(() => {
			const fragment = captured;
			captured = Option.none();
			return fragment;
		}),
		record: (fragment: Option.Option<OAuthConnectionReturnFragment>) =>
			Effect.sync(() => {
				captured = fragment;
			}),
	};
};

export class OAuthReturnCapture extends Context.Service<
	OAuthReturnCapture,
	ReturnType<typeof makeOAuthReturnCapture>
>()("OAuthReturnCapture") {
	static readonly layer = Layer.sync(this, () => makeOAuthReturnCapture(() => window.close()));
}

export const completeOAuthConnectionMutation = createRyotMutation<
	{ readonly connectionId: OAuthConnectionId; readonly secret: string },
	ContractSuccess<"oauthConnections", "complete">,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, hostServices }) =>
	hostServices.runtime
		.runSync(OAuthConnectionsApi)
		.complete(hostServices.scope, {
			payload: { secret: input.secret },
			params: { connectionId: input.connectionId },
		}),
);
