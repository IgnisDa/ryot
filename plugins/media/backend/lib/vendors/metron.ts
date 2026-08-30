import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "../failures";
import { decodeJsonResponse, numberValue, stringValue } from "../records";

export type MetronHost = SandboxHost<readonly ["httpCall", "getPluginConfig"]>;

export const getIdentifier = (value: unknown) => {
	const numeric = numberValue(value);
	if (numeric !== null) {
		return String(Math.trunc(numeric));
	}
	return stringValue(value);
};

export const getMetronCredentials = (host: MetronHost) =>
	Effect.gen(function* () {
		const { metronUsername: usernameValue, metronPassword: passwordValue } = yield* host
			.getPluginConfig(["metronUsername", "metronPassword"])
			.pipe(
				Effect.mapError((error) => ({
					...error,
					message: error.message || "Could not load Metron username",
				})),
			);
		const username = stringValue(usernameValue);
		const password = stringValue(passwordValue);
		if (!username || !password) {
			return yield* new MediaSandboxError({
				message:
					"Metron credentials are not configured. Set RYOT_PLUGIN_MEDIA_METRON_USERNAME and RYOT_PLUGIN_MEDIA_METRON_PASSWORD.",
			});
		}
		return { username, password };
	});

export const loadMetronJson = (host: MetronHost, url: string, failureMessage: string) =>
	getMetronCredentials(host).pipe(
		Effect.flatMap((credentials) =>
			host
				.httpCall("GET", url, {
					headers: {
						Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
					},
				})
				.pipe(
					Effect.mapError((error) => ({ ...error, message: error.message || failureMessage })),
					Effect.flatMap((response) => decodeJsonResponse(response.body, "Metron")),
				),
		),
	);
