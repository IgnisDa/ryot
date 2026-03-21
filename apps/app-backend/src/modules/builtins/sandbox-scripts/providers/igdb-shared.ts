import type { SandboxHost } from "@ryot/sandbox-sdk";

import { asRecord, numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type IgdbHost = SandboxHost<
	readonly ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"]
>;

const BASE_URL = "https://api.igdb.com/v4";
const AUTH_URL = "https://id.twitch.tv/oauth2/token";
const TOKEN_CACHE_KEY = "access_token";

type CachedToken = { accessToken: string; clientId: string };

const asCachedToken = (value: unknown): CachedToken | null => {
	const record = asRecord(value);
	const accessToken = record?.["accessToken"];
	const clientId = record?.["clientId"];
	if (typeof accessToken === "string" && typeof clientId === "string") {
		return { accessToken, clientId };
	}
	return null;
};

export const getCredentials = (host: IgdbHost) =>
	Promise.all([
		host.getAppConfigValue("videoGames.twitchClientId"),
		host.getAppConfigValue("videoGames.twitchClientSecret"),
	]).then(([clientIdResp, clientSecretResp]) => {
		if (!clientIdResp.success) {
			throw new Error(clientIdResp.error || "Failed to retrieve Twitch Client ID");
		}
		if (!clientSecretResp.success) {
			throw new Error(clientSecretResp.error || "Failed to retrieve Twitch Client Secret");
		}
		const clientId = stringValue(clientIdResp.data);
		const clientSecret = stringValue(clientSecretResp.data);
		if (!clientId) {
			throw new Error(
				"Twitch Client ID is not configured. Set VIDEO_GAMES_TWITCH_CLIENT_ID in your environment.",
			);
		}
		if (!clientSecret) {
			throw new Error(
				"Twitch Client Secret is not configured. Set VIDEO_GAMES_TWITCH_CLIENT_SECRET in your environment.",
			);
		}
		return { clientId, clientSecret };
	});

export const getAccessToken = (host: IgdbHost): Promise<CachedToken> =>
	host.getCachedValue(TOKEN_CACHE_KEY).then((cached) => {
		const cachedToken = cached.success ? asCachedToken(cached.data) : null;
		if (cachedToken) {
			return cachedToken;
		}
		return getCredentials(host).then(({ clientId, clientSecret }) => {
			const authUrl = `${AUTH_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
			return host
				.httpCall("POST", authUrl, {
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				})
				.then((response) => {
					if (!response.success) {
						throw new Error(response.error || "Twitch OAuth token request failed");
					}
					const payload = asRecord(parseJsonResponse(response.data.body, "IGDB"));
					const accessTokenValue = stringValue(payload?.["access_token"]);
					if (!accessTokenValue) {
						throw new Error("Twitch OAuth returned no access token");
					}
					const rawTokenTypeValue = payload?.["token_type"];
					const rawTokenType = typeof rawTokenTypeValue === "string" ? rawTokenTypeValue : "bearer";
					const tokenType = rawTokenType.charAt(0).toUpperCase() + rawTokenType.slice(1);
					const accessToken = `${tokenType} ${accessTokenValue}`;
					const expiresInValue = numberValue(payload?.["expires_in"]);
					const expiresIn = expiresInValue !== null && expiresInValue > 0 ? expiresInValue : 3600;
					const expiryWithBuffer = Math.max(60, expiresIn - 300);
					return host
						.setCachedValue(TOKEN_CACHE_KEY, { accessToken, clientId }, expiryWithBuffer)
						.then((cacheResult) => {
							if (!cacheResult.success) {
								console.warn(`IGDB token cache write failed: ${cacheResult.error}`);
							}
							return { accessToken, clientId };
						});
				});
		});
	});

export const makeIgdbRequest = (host: IgdbHost, path: string, body: string) =>
	getAccessToken(host).then(({ accessToken, clientId }) =>
		host
			.httpCall("POST", `${BASE_URL}/${path}`, {
				body,
				headers: {
					Accept: "application/json",
					"Client-ID": clientId,
					"Content-Type": "text/plain",
					Authorization: accessToken,
				},
			})
			.then((response) => {
				if (!response.success) {
					throw new Error(response.error || `IGDB ${path} request failed`);
				}
				return {
					data: parseJsonResponse(response.data.body, "IGDB"),
					headers: response.data.headers,
				};
			}),
	);

export const buildIgdbImageUrl = (base: string, imageId: string) => `${base}/${imageId}.jpg`;

export const readTotalItems = (
	headers: Readonly<Record<string, string>>,
	resultCount: number,
	offset: number,
) => {
	const raw = headers["x-count"];
	const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : resultCount + offset;
};

export const buildPagination = (
	offset: number,
	resultCount: number,
	totalItems: number,
	currentPage: number,
) => ({ totalItems, nextPage: offset + resultCount < totalItems ? currentPage + 1 : null });

export const toSlug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-");
