import {
	getWebOAuthLogoutRedirectUris,
	getWebOAuthRedirectUris,
	isLoopbackOrigin,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_END_SESSION_PATH,
	OAUTH_TOKEN_PATH,
} from "@ryot-app/contract/oauth";
import { Schema } from "effect";

const isObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const redirectParameters = ["redirect_uri", "post_logout_redirect_uri"];
const requestPaths = new Set([OAUTH_TOKEN_PATH, OAUTH_AUTHORIZE_PATH, OAUTH_END_SESSION_PATH]);

// TODO(https://github.com/better-auth/better-auth/issues/11277): Once upstream supports
// origin-scoped HTTP redirects, upgrade the Better Auth packages together and enable the
// override in makeOAuthProviderPlugin only for the configured HTTP frontend origin.
// Remove this module and AuthService's handler wrapper; restore unmodified web callbacks
// in internalOAuthRecords (startup upserts replace existing registrations, no migration).
// Replace translation-specific tests with HTTP flow coverage and update the auth README.
// Keep the plain-HTTP config warning, real baseURL/trustedOrigins, issuer, and audience.
// Upstream's separate issuer normalization in discovery/logout hints still needs verification.
export const makeHttpOAuthRedirects = (frontendOrigin: string) => {
	const origin = new URL(frontendOrigin);
	const enabled = origin.protocol === "http:" && !isLoopbackOrigin(origin.origin);
	const callbacks = [
		...getWebOAuthRedirectUris(origin.origin),
		...getWebOAuthLogoutRedirectUris(origin.origin),
	].map((external) => {
		const internal = new URL(external);
		internal.protocol = "https:";
		return { external, internal: internal.toString() };
	});
	const toProvider = (uri: string) =>
		enabled ? (callbacks.find(({ external }) => external === uri)?.internal ?? uri) : uri;
	const toBrowser = (uri: string) => {
		const callback = callbacks.find(
			({ internal }) =>
				uri === internal || uri.startsWith(`${internal}?`) || uri.startsWith(`${internal}#`),
		);
		return callback ? callback.external + uri.slice(callback.internal.length) : uri;
	};
	const rewriteParameters = (params: URLSearchParams) => {
		let changed = false;
		for (const key of redirectParameters) {
			const values = params.getAll(key);
			if (values.length === 1 && values[0] !== undefined) {
				const rewritten = toProvider(values[0]);
				if (rewritten !== values[0]) {
					params.set(key, rewritten);
					changed = true;
				}
			}
		}
		return changed;
	};
	const wrapHandler = (handler: (request: Request) => Promise<Response>) => {
		if (!enabled) {
			return handler;
		}
		// oxlint-disable-next-line effecttsgo/async-function -- Fetch handlers are Promise-native.
		return async (request: Request): Promise<Response> => {
			const url = new URL(request.url);
			let translated = request;
			if (requestPaths.has(url.pathname)) {
				const queryChanged = rewriteParameters(url.searchParams);
				let body: string | undefined;
				const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
				if (request.method === "POST") {
					if (contentType === "application/x-www-form-urlencoded") {
						const params = new URLSearchParams(await request.clone().text());
						if (rewriteParameters(params)) {
							body = params.toString();
						}
					} else if (contentType === "application/json") {
						let parsed: unknown;
						try {
							parsed = await request.clone().json();
						} catch {
							// Leave malformed JSON for Better Auth's request validation.
						}
						if (isObject(parsed)) {
							const rewritten = { ...parsed };
							let changed = false;
							for (const key of redirectParameters) {
								const value = parsed[key];
								if (typeof value === "string" && toProvider(value) !== value) {
									rewritten[key] = toProvider(value);
									changed = true;
								}
							}
							if (changed) {
								body = JSON.stringify(rewritten);
							}
						}
					}
				}
				if (queryChanged || body !== undefined) {
					translated = new Request(url.toString(), request);
					if (body !== undefined) {
						const headers = new Headers(request.headers);
						headers.delete("content-length");
						translated = new Request(translated, { body, headers, method: request.method });
					}
				}
			}
			const response = await handler(translated);
			const location = response.headers.get("location");
			if (location !== null && toBrowser(location) !== location) {
				const headers = new Headers(response.headers);
				headers.set("location", toBrowser(location));
				return new Response(response.body, {
					headers,
					status: response.status,
					statusText: response.statusText,
				});
			}
			if (response.headers.get("content-type")?.includes("application/json")) {
				let parsed: unknown;
				try {
					parsed = await response.clone().json();
				} catch {
					return response;
				}
				if (isObject(parsed) && parsed["redirect"] === true && typeof parsed["url"] === "string") {
					const uri = toBrowser(parsed["url"]);
					if (uri !== parsed["url"]) {
						const headers = new Headers(response.headers);
						headers.delete("content-length");
						return new Response(JSON.stringify({ ...parsed, url: uri }), {
							headers,
							status: response.status,
							statusText: response.statusText,
						});
					}
				}
			}
			return response;
		};
	};
	return { toProvider, wrapHandler };
};
