import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

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
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).pipe(
		Effect.mapError((error) => new Error(error.message || `MangaUpdates ${label} request failed`)),
		Effect.map((response) => parseJsonResponse(response.body, "MangaUpdates")),
	);

export const mangaUpdatesGetOptional = (host: MangaUpdatesHost, path: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).pipe(
		Effect.map((response) => {
			try {
				const value: unknown = JSON.parse(response.body);
				return value;
			} catch {
				return null;
			}
		}),
		Effect.catchAll(() => Effect.succeed(null)),
	);

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
		.pipe(
			Effect.mapError(
				(error) => new Error(error.message || `MangaUpdates ${label} request failed`),
			),
			Effect.map((response) => parseJsonResponse(response.body, "MangaUpdates")),
		);

export const searchTotalItems = (payload: UnknownRecord | null) => {
	const totalValue = numberValue(payload?.["total_hits"]);
	return totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
};

export const imageUrlValue = (image: unknown) =>
	stringValue(asRecord(asRecord(image)?.["url"])?.["original"]);
