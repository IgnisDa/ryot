import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../failures";
import { decodeJsonResponse, numberValue, stringValue } from "../records";

export type SpotifyHost = Pick<
	ScriptHost,
	"httpCall" | "getCachedValue" | "setCachedValue" | "getPluginConfig"
>;

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const TOKEN_CACHE_KEY = "spotify_access_token";

export const SPOTIFY_SEARCH_PAGE_SIZE = 10;

export const spotifyPage = (
	value: unknown,
	offset: number,
	expectedTotal: null | number,
): Effect.Effect<
	{ total: number; nextOffset: null | number; items: Record<string, unknown>[] },
	MediaSandboxError
> => {
	const page = asRecord(value);
	const values = page?.["items"];
	const total = page?.["total"];
	const returnedOffset = page?.["offset"];
	const next = page?.["next"];
	if (
		!Array.isArray(values) ||
		values.length > 50 ||
		typeof total !== "number" ||
		!Number.isSafeInteger(total) ||
		total < 0 ||
		(returnedOffset !== undefined && returnedOffset !== offset) ||
		(expectedTotal !== null && total !== expectedTotal) ||
		offset + values.length > total ||
		(values.length === 0 && offset < total) ||
		(next === null && offset + values.length < total) ||
		(typeof next === "string" && offset + values.length >= total) ||
		(next !== undefined && next !== null && typeof next !== "string")
	) {
		return Effect.fail(
			new MediaSandboxError({ message: `Invalid Spotify inventory page at ${offset}` }),
		);
	}
	if (typeof next === "string") {
		let validNext = false;
		try {
			const url = new URL(next);
			validNext =
				url.origin === new URL(SPOTIFY_API_URL).origin &&
				url.searchParams.get("offset") === String(offset + values.length);
		} catch {
			validNext = false;
		}
		if (!validNext) {
			return Effect.fail(
				new MediaSandboxError({ message: `Inconsistent Spotify next page at ${offset}` }),
			);
		}
	}
	const items: Record<string, unknown>[] = [];
	for (const itemValue of values) {
		const item = asRecord(itemValue);
		const id = stringValue(item?.["id"]);
		if (!item || !id || !/^[a-zA-Z0-9]{1,64}$/.test(id)) {
			return Effect.fail(
				new MediaSandboxError({ message: "Spotify inventory item is missing a valid ID" }),
			);
		}
		items.push(item);
	}
	return Effect.succeed({
		items,
		total,
		nextOffset: offset + items.length < total ? offset + items.length : null,
	});
};

export const spotifyOffsetCursor = (value: unknown) => {
	const record = asRecord(value);
	const offset = record?.["offset"];
	const total = record?.["total"];
	return typeof offset === "number" &&
		Number.isSafeInteger(offset) &&
		offset >= 0 &&
		typeof total === "number" &&
		Number.isSafeInteger(total) &&
		total >= offset
		? Effect.succeed({ total, offset })
		: Effect.fail(new MediaSandboxError({ message: "Invalid Spotify inventory continuation" }));
};

export const spotifyInventoryLimit = (error: unknown) => getSpotifyErrorStatus(error) === 403;

const getHttpFailureDetails = (error: unknown): null | { body: string; status: number } => {
	const data = asRecord(asRecord(error)?.["data"]);
	const status = numberValue(data?.["status"]);
	const body = data?.["body"];
	if (status === null || typeof body !== "string") {
		return null;
	}
	return { body, status: Math.trunc(status) };
};

export const getSpotifyErrorStatus = (error: unknown): null | number => {
	const details = getHttpFailureDetails(error);
	if (details) {
		return details.status;
	}
	const status = numberValue(asRecord(error)?.["status"]);
	if (status !== null) {
		return Math.trunc(status);
	}
	let message: null | string = null;
	if (error instanceof Error) {
		message = error.message;
	} else {
		const recordMessage = asRecord(error)?.["message"];
		if (typeof recordMessage === "string") {
			message = recordMessage;
		}
	}
	if (message) {
		const match = /status (\d+)/.exec(message);
		if (match) {
			const parsed = Number(match[1]);
			return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
		}
	}
	return null;
};

const spotifyHostFailure = (error: SandboxHostError, fallback: string): SandboxHostError => {
	const details = getHttpFailureDetails(error);
	if (details) {
		return { ...error, message: `Spotify API returned status ${details.status}: ${details.body}` };
	}
	return { ...error, message: error.message || fallback };
};

export const getImagesSortedBySize = (images: unknown): string[] => {
	if (!Array.isArray(images) || images.length === 0) {
		return [];
	}
	const sized = images.map((image) => {
		const record = asRecord(image);
		const width = numberValue(record?.["width"]) ?? 0;
		const height = numberValue(record?.["height"]) ?? 0;
		const url = record?.["url"];
		return { size: width * height, url: typeof url === "string" && url ? url : null };
	});
	return sized
		.sort((a, b) => b.size - a.size)
		.flatMap((entry) => (entry.url === null ? [] : [entry.url]));
};

export const getFirstImage = (images: unknown) => getImagesSortedBySize(images)[0] ?? null;

export const getCredentials = (host: SpotifyHost) =>
	host.getPluginConfig({ required: ["spotifyClientId", "spotifyClientSecret"] }).pipe(
		Effect.mapError((error) => ({
			...error,
			message: error.message || "Failed to retrieve Spotify credentials",
		})),
		Effect.flatMap(({ spotifyClientId: clientIdValue, spotifyClientSecret: clientSecretValue }) => {
			const clientId = stringValue(clientIdValue);
			const clientSecret = stringValue(clientSecretValue);
			if (!clientId) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"Spotify client ID is not configured. Set spotifyClientId in the plugin configuration.",
					}),
				);
			}
			if (!clientSecret) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"Spotify client secret is not configured. Set spotifyClientSecret in the plugin configuration.",
					}),
				);
			}
			return Effect.succeed({ clientId, clientSecret });
		}),
	);

export const getAccessToken = (host: SpotifyHost) =>
	host.getCachedValue(TOKEN_CACHE_KEY).pipe(
		Effect.orElseSucceed(() => null),
		Effect.flatMap((cached) => {
			const cachedToken = stringValue(cached);
			if (cachedToken) {
				return Effect.succeed(cachedToken);
			}
			return getCredentials(host).pipe(
				Effect.flatMap(({ clientId, clientSecret }) => {
					const credentials = btoa(`${clientId}:${clientSecret}`);
					return host
						.httpCall("POST", SPOTIFY_TOKEN_URL, {
							body: "grant_type=client_credentials",
							headers: {
								Authorization: `Basic ${credentials}`,
								"Content-Type": "application/x-www-form-urlencoded",
							},
						})
						.pipe(
							Effect.mapError((error) => spotifyHostFailure(error, "Spotify token request failed")),
							Effect.flatMap((response) => decodeJsonResponse(response.body, "Spotify")),
							Effect.flatMap((response) => {
								const payload = asRecord(response);
								const accessToken = stringValue(payload?.["access_token"]);
								if (!accessToken) {
									return Effect.fail(
										new MediaSandboxError({
											message: "Spotify token response did not include an access token",
										}),
									);
								}
								const expiresInValue = numberValue(payload?.["expires_in"]);
								const expiresIn =
									expiresInValue !== null && expiresInValue > 0 ? expiresInValue : 3600;
								const expiryWithBuffer = Math.max(60, expiresIn - 300);
								return host.setCachedValue(TOKEN_CACHE_KEY, accessToken, expiryWithBuffer).pipe(
									Effect.as(accessToken),
									Effect.catch((error) => {
										console.warn(`Spotify token cache write failed: ${error.message}`);
										return Effect.succeed(accessToken);
									}),
								);
							}),
						);
				}),
			);
		}),
	);

export const spotifyGet = (
	host: SpotifyHost,
	path: string,
	params?: Readonly<Record<string, string>>,
) =>
	getAccessToken(host).pipe(
		Effect.flatMap((accessToken) => {
			const search = params ? `?${new URLSearchParams(params).toString()}` : "";
			return host
				.httpCall("GET", `${SPOTIFY_API_URL}${path}${search}`, {
					headers: { Authorization: `Bearer ${accessToken}` },
				})
				.pipe(
					Effect.mapError((error) => spotifyHostFailure(error, `Spotify request failed: ${path}`)),
					Effect.flatMap((response) => decodeJsonResponse(response.body, "Spotify")),
				);
		}),
	);
