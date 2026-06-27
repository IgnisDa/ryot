import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk";

export type HardcoverHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export type UnknownRecord = Record<string, unknown>;

const HARDCOVER_GQL_URL = "https://api.hardcover.app/v1/graphql";

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const idValue = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	return null;
};

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("Hardcover returned invalid JSON");
	}
};

export const getHardcoverApiKey = (host: HardcoverHost) =>
	host.getAppConfigValue("providers.hardcoverApiKey").then((response) => {
		if (!response.success) {
			throw new Error(response.error || "Could not load Hardcover API key");
		}
		const apiKey = stringValue(response.data);
		if (!apiKey) {
			throw new Error("BOOKS_HARDCOVER_API_KEY is not configured");
		}
		return apiKey;
	});

export const hardcoverGql = (
	host: HardcoverHost,
	body: JsonValue,
	apiKey: string,
	failureMessage: string,
) =>
	host
		.httpCall("POST", HARDCOVER_GQL_URL, {
			body: JSON.stringify(body),
			headers: { Authorization: apiKey, "Content-Type": "application/json" },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || failureMessage);
			}
			return parseJsonResponse(response.data.body);
		});

export const firstGraphqlErrorMessage = (payload: UnknownRecord | null) => {
	const errors = payload?.["errors"];
	if (!Array.isArray(errors) || errors.length === 0) {
		return null;
	}
	const firstError = asRecord(errors[0]);
	const message = firstError?.["message"];
	return typeof message === "string" ? message : "unknown GraphQL error";
};

export const escapeGraphqlString = (value: string) => value.replace(/"/g, '\\"');
