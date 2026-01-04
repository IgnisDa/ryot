import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk/core";

import {
	asRecord,
	numberValue,
	parseJsonResponse,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";

export type MangaUpdatesHost = SandboxHost<readonly ["httpCall"]>;

const MANGA_UPDATES_API_BASE_URL = "https://api.mangaupdates.com/v1";

export const mangaUpdatesGet = (host: MangaUpdatesHost, path: string, label: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).then((response) => {
		if (!response.success) {
			throw new Error(response.error || `MangaUpdates ${label} request failed`);
		}
		return parseJsonResponse(response.data.body, "MangaUpdates");
	});

export const mangaUpdatesGetOptional = (host: MangaUpdatesHost, path: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).then((response) => {
		if (!response.success) {
			return null;
		}
		try {
			const value: unknown = JSON.parse(response.data.body);
			return value;
		} catch {
			return null;
		}
	});

export const mangaUpdatesPost = (
	host: MangaUpdatesHost,
	path: string,
	body: JsonValue,
	label: string,
) =>
	host
		.httpCall("POST", `${MANGA_UPDATES_API_BASE_URL}${path}`, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || `MangaUpdates ${label} request failed`);
			}
			return parseJsonResponse(response.data.body, "MangaUpdates");
		});

export const searchTotalItems = (payload: UnknownRecord | null) => {
	const totalValue = numberValue(payload?.["total_hits"]);
	return totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
};

export const imageUrlValue = (image: unknown) =>
	stringValue(asRecord(asRecord(image)?.["url"])?.["original"]);
