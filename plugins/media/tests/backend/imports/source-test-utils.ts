import { Effect } from "@ryot-app/sandbox-sdk/effect";

import type { HttpHost } from "../../../backend/imports/source-api";

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
			const response = respond({ url, method, options, path: url.pathname });
			return Effect.succeed({
				status: 200,
				headers: response.headers ?? {},
				body: JSON.stringify(response.body ?? {}),
			});
		},
	}) as HttpHost;
