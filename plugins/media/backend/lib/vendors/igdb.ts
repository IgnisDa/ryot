import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "../failures";
import { asRecord, decodeJsonResponse, numberValue, stringValue } from "../records";

export type IgdbHost = SandboxHost<
	readonly ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"]
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
		return { clientId, accessToken };
	}
	return null;
};

export const getCredentials = (host: IgdbHost) =>
	host.getPluginConfig(["twitchClientId", "twitchClientSecret"]).pipe(
		Effect.mapError((error) => ({
			...error,
			message: error.message || "Failed to retrieve Twitch credentials",
		})),
		Effect.flatMap(({ twitchClientId: clientIdValue, twitchClientSecret: clientSecretValue }) => {
			const clientId = stringValue(clientIdValue);
			const clientSecret = stringValue(clientSecretValue);
			if (!clientId) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"Twitch Client ID is not configured. Set RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_ID in your environment.",
					}),
				);
			}
			if (!clientSecret) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"Twitch Client Secret is not configured. Set RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_SECRET in your environment.",
					}),
				);
			}
			return Effect.succeed({ clientId, clientSecret });
		}),
	);

export const getAccessToken = (host: IgdbHost) =>
	host.getCachedValue(TOKEN_CACHE_KEY).pipe(
		Effect.catch(() => Effect.succeed(null)),
		Effect.flatMap((cached) => {
			const cachedToken = asCachedToken(cached);
			if (cachedToken) {
				return Effect.succeed(cachedToken);
			}
			return getCredentials(host).pipe(
				Effect.flatMap(({ clientId, clientSecret }) => {
					const authUrl = `${AUTH_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
					return host
						.httpCall("POST", authUrl, {
							headers: { "Content-Type": "application/x-www-form-urlencoded" },
						})
						.pipe(
							Effect.mapError((error) => ({
								...error,
								message: error.message || "Twitch OAuth token request failed",
							})),
							Effect.flatMap((response) => decodeJsonResponse(response.body, "IGDB")),
							Effect.flatMap((response) => {
								const payload = asRecord(response);
								const accessTokenValue = stringValue(payload?.["access_token"]);
								if (!accessTokenValue) {
									return Effect.fail(
										new MediaSandboxError({ message: "Twitch OAuth returned no access token" }),
									);
								}
								const rawTokenTypeValue = payload?.["token_type"];
								const rawTokenType =
									typeof rawTokenTypeValue === "string" ? rawTokenTypeValue : "bearer";
								const tokenType = rawTokenType.charAt(0).toUpperCase() + rawTokenType.slice(1);
								const accessToken = `${tokenType} ${accessTokenValue}`;
								const expiresInValue = numberValue(payload?.["expires_in"]);
								const expiresIn =
									expiresInValue !== null && expiresInValue > 0 ? expiresInValue : 3600;
								const expiryWithBuffer = Math.max(60, expiresIn - 300);
								const token = { clientId, accessToken };
								return host.setCachedValue(TOKEN_CACHE_KEY, token, expiryWithBuffer).pipe(
									Effect.as(token),
									Effect.catch((error) => {
										console.warn(`IGDB token cache write failed: ${error.message}`);
										return Effect.succeed(token);
									}),
								);
							}),
						);
				}),
			);
		}),
	);

export const makeIgdbRequest = (host: IgdbHost, path: string, body: string) =>
	getAccessToken(host).pipe(
		Effect.flatMap(({ clientId, accessToken }) =>
			host
				.httpCall("POST", `${BASE_URL}/${path}`, {
					body,
					headers: {
						"Client-ID": clientId,
						Accept: "application/json",
						Authorization: accessToken,
						"Content-Type": "text/plain",
					},
				})
				.pipe(
					Effect.mapError((error) => ({
						...error,
						message: error.message || `IGDB ${path} request failed`,
					})),
					Effect.flatMap((response) =>
						decodeJsonResponse(response.body, "IGDB").pipe(
							Effect.map((data) => ({ data, headers: response.headers })),
						),
					),
				),
		),
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
