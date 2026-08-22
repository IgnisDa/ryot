import { Effect, Stream } from "effect";
import { Cookies, FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

/** Send raw protocol-test requests with Effect while retaining Web Response assertions. */
export const webRequest = (url: string | URL, init?: RequestInit, options?: { stream?: boolean }) =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;
		const response = yield* client
			.execute(HttpClientRequest.fromWeb(new Request(url, init)))
			.pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: init?.redirect }));
		let body: ArrayBuffer | ReadableStream<Uint8Array> | null = null;
		if (response.status !== 204 && response.status !== 304) {
			body = options?.stream
				? yield* Stream.toReadableStreamEffect(response.stream)
				: yield* response.arrayBuffer;
		}
		const headers = new Headers(response.headers);
		headers.delete("set-cookie");
		for (const cookie of Cookies.toSetCookieHeaders(response.cookies)) {
			headers.append("set-cookie", cookie);
		}
		return new Response(body, { headers, status: response.status });
	}).pipe(Effect.provide(FetchHttpClient.layer));
