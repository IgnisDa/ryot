import type { SandboxHost } from "@ryot/sandbox-sdk";

export type OpenLibraryHost = SandboxHost<readonly ["httpCall"]>;

export type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const getKeySegment = (value: unknown) => {
	if (typeof value !== "string") {
		return "";
	}
	const segments = value.split("/").filter(Boolean);
	return segments.length > 0 ? (segments[segments.length - 1] ?? "") : "";
};

export const parseDescription = (value: unknown) => {
	if (typeof value === "string") {
		return value;
	}
	const record = asRecord(value);
	if (record && typeof record["value"] === "string") {
		return record["value"];
	}
	return null;
};

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("OpenLibrary returned invalid JSON");
	}
};

export const loadOpenLibraryJson = (host: OpenLibraryHost, url: string, errorPrefix: string) =>
	host.httpCall("GET", url).then((response) => {
		if (!response.success) {
			throw new Error(response.error || `${errorPrefix} request failed`);
		}
		return parseJsonResponse(response.data.body);
	});
