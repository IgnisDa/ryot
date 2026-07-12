import { FetchHttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { SANDBOX_LIMITS, utf8ByteLength } from "./limits";
import { applySandboxHttpRequestInit, readSandboxHttpResponseText } from "./service";

const request = HttpClientRequest.get("https://example.com");
const fromWeb = (response: Response) => HttpClientResponse.fromWeb(request, response);

describe("sandbox HTTP response limits", () => {
	it("keeps TLS verification secure by default and disables it only for opted-in calls", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const secureRequestInit: RequestInit = { redirect: "follow" };
				const readRequestInit = FetchHttpClient.RequestInit;
				const secure = yield* applySandboxHttpRequestInit(readRequestInit, undefined).pipe(
					Effect.provideService(FetchHttpClient.RequestInit, secureRequestInit),
				);
				const insecure = yield* applySandboxHttpRequestInit(readRequestInit, true).pipe(
					Effect.provideService(FetchHttpClient.RequestInit, secureRequestInit),
				);

				expect(secure).toBe(secureRequestInit);
				expect(insecure).toEqual({ tls: { rejectUnauthorized: false } });
			}),
		));

	it("accepts ASCII and multi-byte bodies at the streamed byte boundary", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const ascii = "a".repeat(SANDBOX_LIMITS.http.responseBytes);
				const asciiBody = yield* readSandboxHttpResponseText(fromWeb(new Response(ascii)));
				expect(utf8ByteLength(asciiBody)).toBe(SANDBOX_LIMITS.http.responseBytes);

				const multiByte = "🙂".repeat(SANDBOX_LIMITS.http.responseBytes / 4);
				const multiByteBody = yield* readSandboxHttpResponseText(fromWeb(new Response(multiByte)));
				expect(utf8ByteLength(multiByteBody)).toBe(SANDBOX_LIMITS.http.responseBytes);
			}),
		));

	it("fails while streaming as soon as the response exceeds the limit", () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(SANDBOX_LIMITS.http.responseBytes));
				controller.enqueue(new Uint8Array([1]));
			},
			cancel() {
				cancelled = true;
			},
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const exit = yield* Effect.exit(readSandboxHttpResponseText(fromWeb(new Response(body))));

				assert(exit._tag === "Failure");
				expect(String(exit.cause)).toContain(
					`httpCall response body exceeds ${SANDBOX_LIMITS.http.responseBytes} bytes`,
				);
				expect(cancelled).toBe(true);
			}),
		);
	});
});
