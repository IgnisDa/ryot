import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

export type StubHttpResponse = {
	body?: unknown;
	status?: number;
	headers?: Record<string, string>;
};

export type StubHttpRequest = {
	url: URL;
	path: string;
	method: string;
};

export type StubHttpHandler = (request: StubHttpRequest) => StubHttpResponse;

/**
 * Provides a fake `HttpClient` that answers import-source requests from canned
 * responses, so adapter tests exercise real fetch/decode/normalization paths
 * without touching the network. The handler receives the parsed request and
 * returns a body (JSON-encoded), status, and headers.
 */
export const stubHttpClientLayer = (handler: StubHttpHandler): Layer.Layer<HttpClient.HttpClient> =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) => {
			const response = handler({ url, path: url.pathname, method: request.method });
			const body = response.body === undefined ? "" : JSON.stringify(response.body);
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(body, {
						status: response.status ?? 200,
						headers: { "content-type": "application/json", ...response.headers },
					}),
				),
			);
		}),
	);
