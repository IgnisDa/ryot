import type { SandboxHost } from "@ryot/sandbox-sdk";

export type MetronHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export type UnknownRecord = Record<string, unknown>;

export type RoleRelatedEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
	relationshipProperties: { roles: string[] };
};

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const getIdentifier = (value: unknown) => {
	const numeric = numberValue(value);
	if (numeric !== null) {
		return String(Math.trunc(numeric));
	}
	return stringValue(value);
};

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("Metron returned invalid JSON");
	}
};

export const getMetronCredentials = (host: MetronHost) =>
	host.getAppConfigValue("providers.metronUsername").then((usernameResponse) => {
		if (!usernameResponse.success) {
			throw new Error(usernameResponse.error || "Could not load Metron username");
		}
		return host.getAppConfigValue("providers.metronPassword").then((passwordResponse) => {
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
				return parseJsonResponse(response.data.body);
			}),
	);
