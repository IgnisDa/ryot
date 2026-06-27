import { Effect } from "@ryot/sandbox-sdk/effect";

import type { HttpHost } from "./source-api";

export type StubResponse = { body?: unknown; headers?: Record<string, string> };

export const stubHttpHost = (
	respond: (request: {
		method: string;
		path: string;
		url: URL;
		options?: { allowInsecureConnections?: boolean | undefined } | undefined;
	}) => StubResponse,
) =>
	({
		httpCall: (method: string, value: string, options) => {
			const url = new URL(value);
			const response = respond({ method, path: url.pathname, url, options });
			return Effect.succeed({
				status: 200,
				headers: response.headers ?? {},
				body: JSON.stringify(response.body ?? {}),
			});
		},
	}) as HttpHost;
