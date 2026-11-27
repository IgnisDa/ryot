import {
	BROWSER_SESSION_HEADER,
	BROWSER_SESSION_PATH,
	type BrowserSessionExchange,
	BrowserSessionProfile,
} from "@ryot-app/contract/oauth";
import { Effect, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";

import { type OAuthFetch, OAuthTransportError } from "./oauth-endpoint";
import { generateOAuthRandomValue } from "./pkce";

export const browserSessionChangeKey = "ryot:browser-session-change";

const signalBrowserSessionChange = Effect.sync(() =>
	localStorage.setItem(browserSessionChangeKey, generateOAuthRandomValue()),
).pipe(Effect.ignoreCause);

const readJson = (response: Response) =>
	Effect.tryPromise({
		try: (): Promise<unknown> => response.json(),
		catch: (cause) => new OAuthTransportError({ cause }),
	});
const assertOk = (response: Response) =>
	response.ok
		? Effect.void
		: Effect.fail(
				new OAuthTransportError({ cause: `Browser session returned ${response.status}` }),
			);

export const makeBrowserSessionTransport = (fetcher: OAuthFetch) => {
	const request = (origin: ServerOrigin, init: RequestInit) =>
		Effect.tryPromise({
			catch: (cause) => new OAuthTransportError({ cause }),
			try: () => {
				if (origin !== window.location.origin) {
					throw new Error("Browser sessions require the current origin");
				}
				return fetcher(BROWSER_SESSION_PATH, {
					...init,
					cache: "no-store",
					redirect: "error",
					credentials: "same-origin",
				});
			},
		});

	return {
		exchange: (origin: ServerOrigin, input: BrowserSessionExchange) =>
			request(origin, {
				method: "POST",
				body: JSON.stringify(input),
				headers: { "content-type": "application/json" },
			}).pipe(Effect.flatMap(assertOk), Effect.andThen(signalBrowserSessionChange)),
		read: (origin: ServerOrigin) =>
			request(origin, { method: "GET" }).pipe(
				Effect.flatMap((response) =>
					response.status === 401
						? Effect.succeed(null)
						: assertOk(response).pipe(
								Effect.andThen(readJson(response)),
								Effect.flatMap(Schema.decodeUnknownEffect(BrowserSessionProfile)),
							),
				),
			),
		logout: (origin: ServerOrigin, session: string) =>
			request(origin, { method: "DELETE", headers: { [BROWSER_SESSION_HEADER]: session } }).pipe(
				Effect.flatMap((response) =>
					response.status === 401
						? Effect.succeed(null)
						: assertOk(response).pipe(
								Effect.andThen(readJson(response)),
								Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))),
								Effect.map(({ url }) => url),
								Effect.tap(() => signalBrowserSessionChange),
							),
				),
			),
	};
};
