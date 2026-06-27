import type { SandboxHost } from "@ryot/sandbox-sdk";

import { asRecord, parseJsonResponse } from "../script-helpers/records";

export type OpenLibraryHost = SandboxHost<readonly ["httpCall"]>;

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

export const loadOpenLibraryJson = (host: OpenLibraryHost, url: string, errorPrefix: string) =>
	host.httpCall("GET", url).then((response) => {
		if (!response.success) {
			throw new Error(response.error || `${errorPrefix} request failed`);
		}
		return parseJsonResponse(response.data.body, "OpenLibrary");
	});
