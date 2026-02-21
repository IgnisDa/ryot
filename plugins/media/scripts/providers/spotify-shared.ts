import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { asRecord, numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type SpotifyHost = SandboxHost<
	readonly ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"]
>;

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const TOKEN_CACHE_KEY = "spotify_access_token";

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
	host.getPluginConfig(["spotifyClientId", "spotifyClientSecret"]).pipe(
		Effect.mapError(
			(error) => new Error(error.message || "Failed to retrieve Spotify credentials"),
		),
		Effect.map(({ spotifyClientId: clientIdValue, spotifyClientSecret: clientSecretValue }) => {
			const clientId = stringValue(clientIdValue);
			const clientSecret = stringValue(clientSecretValue);
			if (!clientId) {
				throw new Error(
					"Spotify client ID is not configured. Set RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID in your environment.",
				);
			}
			if (!clientSecret) {
				throw new Error(
					"Spotify client secret is not configured. Set RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET in your environment.",
				);
			}
			return { clientId, clientSecret };
		}),
	);

export const getAccessToken = (host: SpotifyHost): Effect.Effect<string, unknown> =>
	host.getCachedValue(TOKEN_CACHE_KEY).pipe(
		Effect.catch(() => Effect.succeed(null)),
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
							Effect.mapError(
								(error) => new Error(error.message || "Spotify token request failed"),
							),
							Effect.flatMap((response) => {
								const payload = asRecord(parseJsonResponse(response.body, "Spotify"));
								const accessToken = stringValue(payload?.["access_token"]);
								if (!accessToken) {
									throw new Error("Spotify token response did not include an access token");
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
): Effect.Effect<unknown, unknown> =>
	getAccessToken(host).pipe(
		Effect.flatMap((accessToken) => {
			const search = params ? `?${new URLSearchParams(params).toString()}` : "";
			return host
				.httpCall("GET", `${SPOTIFY_API_URL}${path}${search}`, {
					headers: { Authorization: `Bearer ${accessToken}` },
				})
				.pipe(
					Effect.mapError((error) => new Error(error.message || `Spotify request failed: ${path}`)),
					Effect.map((response) => parseJsonResponse(response.body, "Spotify")),
				);
		}),
	);
