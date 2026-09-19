import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";

import { MediaSandboxError } from "../failures";
import { asRecord, decodeJsonResponse, numberValue, stringValue } from "../records";

export type SpotifyHost = SandboxHost<
	readonly ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"]
>;

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const TOKEN_CACHE_KEY = "spotify_access_token";

export const SPOTIFY_SEARCH_PAGE_SIZE = 10;

const getHttpFailureDetails = (error: unknown): { status: number; body: string } | null => {
	const data = asRecord(asRecord(error)?.["data"]);
	const status = numberValue(data?.["status"]);
	const body = data?.["body"];
	if (status === null || typeof body !== "string") {
		return null;
	}
	return { body, status: Math.trunc(status) };
};

export const getSpotifyErrorStatus = (error: unknown): number | null => {
	const details = getHttpFailureDetails(error);
	if (details) {
		return details.status;
	}
	const status = numberValue(asRecord(error)?.["status"]);
	if (status !== null) {
		return Math.trunc(status);
	}
	let message: string | null = null;
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
							"Spotify client ID is not configured. Set RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID in your environment.",
					}),
				);
			}
			if (!clientSecret) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"Spotify client secret is not configured. Set RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET in your environment.",
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
