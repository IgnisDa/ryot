import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import {
	asRecord,
	decodeJsonResponse,
	numberValue,
	stringValue,
	type UnknownRecord,
} from "../records";

export type MangaUpdatesHost = Pick<ScriptHost, "httpCall">;

const MANGA_UPDATES_API_BASE_URL = "https://api.mangaupdates.com/v1";

export const mangaUpdatesGet = (host: MangaUpdatesHost, path: string, label: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).pipe(
		Effect.mapError((error) => ({
			...error,
			message: error.message || `MangaUpdates ${label} request failed`,
		})),
		Effect.flatMap((response) => decodeJsonResponse(response.body, "MangaUpdates")),
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
		Effect.orElseSucceed(() => null),
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
			Effect.mapError((error) => ({
				...error,
				message: error.message || `MangaUpdates ${label} request failed`,
			})),
			Effect.flatMap((response) => decodeJsonResponse(response.body, "MangaUpdates")),
		);

export const searchTotalItems = (payload: UnknownRecord | null) => {
	const totalValue = numberValue(payload?.["total_hits"]);
	return totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
};

export const imageUrlValue = (image: unknown) =>
	stringValue(asRecord(asRecord(image)?.["url"])?.["original"]);
