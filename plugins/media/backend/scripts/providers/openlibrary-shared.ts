import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { asRecord, parseJsonResponse } from "../../shared/records";

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
	host.httpCall("GET", url).pipe(
		Effect.mapError((error) => new Error(error.message || `${errorPrefix} request failed`)),
		Effect.map((response) => parseJsonResponse(response.body, "OpenLibrary")),
	);
