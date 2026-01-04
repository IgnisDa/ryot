import type { SandboxHost } from "@ryot/sandbox-sdk";

import { numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type MetronHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export const getIdentifier = (value: unknown) => {
	const numeric = numberValue(value);
	if (numeric !== null) {
		return String(Math.trunc(numeric));
	}
	return stringValue(value);
};

export const getMetronCredentials = (host: MetronHost) =>
	host.getAppConfigValue("comicBooks.metronUsername").then((usernameResponse) => {
		if (!usernameResponse.success) {
			throw new Error(usernameResponse.error || "Could not load Metron username");
		}
		return host.getAppConfigValue("comicBooks.metronPassword").then((passwordResponse) => {
			if (!passwordResponse.success) {
				throw new Error(passwordResponse.error || "Could not load Metron password");
			}
			const username = stringValue(usernameResponse.data);
			const password = stringValue(passwordResponse.data);
			if (!username || !password) {
				throw new Error("Metron credentials are not configured");
			}
			return { username, password };
		});
	});

export const loadMetronJson = (
	host: MetronHost,
	url: string,
	failureMessage: string,
): Promise<unknown> =>
	getMetronCredentials(host).then((credentials) =>
		host
			.httpCall("GET", url, {
				headers: {
					Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
				},
			})
			.then((response) => {
				if (!response.success) {
					throw new Error(response.error || failureMessage);
				}
				return parseJsonResponse(response.data.body, "Metron");
			}),
	);
