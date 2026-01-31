import type { SandboxHost } from "@ryot/sandbox-sdk";

import { asRecord, numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type SpotifyHost = SandboxHost<
	readonly ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"]
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
	Promise.all([
		host.getAppConfigValue("music.spotifyClientId"),
		host.getAppConfigValue("music.spotifyClientSecret"),
	]).then(([clientIdResp, clientSecretResp]) => {
		if (!clientIdResp.success) {
			throw new Error(clientIdResp.error || "Failed to retrieve Spotify client ID");
		}
		if (!clientSecretResp.success) {
			throw new Error(clientSecretResp.error || "Failed to retrieve Spotify client secret");
		}
		const clientId = stringValue(clientIdResp.data);
		const clientSecret = stringValue(clientSecretResp.data);
		if (!clientId) {
			throw new Error(
				"Spotify client ID is not configured. Set MUSIC_SPOTIFY_CLIENT_ID in your environment.",
			);
		}
		if (!clientSecret) {
			throw new Error(
				"Spotify client secret is not configured. Set MUSIC_SPOTIFY_CLIENT_SECRET in your environment.",
			);
		}
		return { clientId, clientSecret };
	});

export const getAccessToken = (host: SpotifyHost): Promise<string> =>
	host.getCachedValue(TOKEN_CACHE_KEY).then((cached) => {
		const cachedToken = cached.success ? stringValue(cached.data) : null;
		if (cachedToken) {
			return cachedToken;
		}
		return getCredentials(host).then(({ clientId, clientSecret }) => {
			const credentials = btoa(`${clientId}:${clientSecret}`);
			return host
				.httpCall("POST", SPOTIFY_TOKEN_URL, {
					body: "grant_type=client_credentials",
					headers: {
						Authorization: `Basic ${credentials}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
				})
				.then((response) => {
					if (!response.success) {
						throw new Error(response.error || "Spotify token request failed");
					}
					const payload = asRecord(parseJsonResponse(response.data.body, "Spotify"));
					const accessToken = stringValue(payload?.["access_token"]);
					if (!accessToken) {
						throw new Error("Spotify token response did not include an access token");
					}
					const expiresInValue = numberValue(payload?.["expires_in"]);
					const expiresIn = expiresInValue !== null && expiresInValue > 0 ? expiresInValue : 3600;
					const expiryWithBuffer = Math.max(60, expiresIn - 300);
					return host
						.setCachedValue(TOKEN_CACHE_KEY, accessToken, expiryWithBuffer)
						.then((cacheResult) => {
							if (!cacheResult.success) {
								console.warn(`Spotify token cache write failed: ${cacheResult.error}`);
							}
							return accessToken;
						});
				});
		});
	});

export const spotifyGet = (
	host: SpotifyHost,
	path: string,
	params?: Readonly<Record<string, string>>,
): Promise<unknown> =>
	getAccessToken(host).then((accessToken) => {
		const search = params ? `?${new URLSearchParams(params).toString()}` : "";
		return host
			.httpCall("GET", `${SPOTIFY_API_URL}${path}${search}`, {
				headers: { Authorization: `Bearer ${accessToken}` },
			})
			.then((response) => {
				if (!response.success) {
					throw new Error(response.error || `Spotify request failed: ${path}`);
				}
				return parseJsonResponse(response.data.body, "Spotify");
			});
	});
