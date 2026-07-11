import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type MetronHost = SandboxHost<readonly ["httpCall", "getPluginConfigValue"]>;

export const getIdentifier = (value: unknown) => {
	const numeric = numberValue(value);
	if (numeric !== null) {
		return String(Math.trunc(numeric));
	}
	return stringValue(value);
};

export const getMetronCredentials = (host: MetronHost) =>
	Effect.gen(function* () {
		const usernameValue = yield* host
			.getPluginConfigValue("metronUsername")
			.pipe(
				Effect.mapError((error) => new Error(error.message || "Could not load Metron username")),
			);
		const passwordValue = yield* host
			.getPluginConfigValue("metronPassword")
			.pipe(
				Effect.mapError((error) => new Error(error.message || "Could not load Metron password")),
			);
		const username = stringValue(usernameValue);
		const password = stringValue(passwordValue);
		if (!username || !password) {
			throw new Error(
				"Metron credentials are not configured. Set RYOT_PLUGIN_MEDIA_METRON_USERNAME and RYOT_PLUGIN_MEDIA_METRON_PASSWORD.",
			);
		}
		return { username, password };
	});

export const loadMetronJson = (
	host: MetronHost,
	url: string,
	failureMessage: string,
): Effect.Effect<unknown, unknown> =>
	getMetronCredentials(host).pipe(
		Effect.flatMap((credentials) =>
			host
				.httpCall("GET", url, {
					headers: {
						Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
					},
				})
				.pipe(
					Effect.mapError((error) => new Error(error.message || failureMessage)),
					Effect.map((response) => parseJsonResponse(response.body, "Metron")),
				),
		),
	);
