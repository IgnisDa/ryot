import { describe, expect, it } from "bun:test";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { httpCall } from "./http-call";

describe("httpCall", () => {
	it("returns response details for a valid request", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			expect(input).toBe("https://example.com/test");
			expect(init?.body).toBe('{"hello":"world"}');
			expect(init?.method).toBe("POST");
			expect(init?.headers).toEqual({ "x-test": "1" });

			return new Response("ok", {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "text/plain" },
			});
		}) as unknown as typeof fetch;

		try {
			expect(
				httpCall({}, " post ", "https://example.com/test", {
					body: '{"hello":"world"}',
					headers: { "x-test": "1" },
				}),
			).resolves.toEqual(
				apiSuccess({
					body: "ok",
					status: 200,
					statusText: "OK",
					headers: { "content-type": "text/plain" },
				}),
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns validation failure for a blank method", async () => {
		expect(httpCall({}, "   ", "https://example.com")).resolves.toEqual(
			apiFailure("httpCall expects a non-empty method string"),
		);
	});

	it("returns validation failure for invalid options", async () => {
		expect(
			httpCall({}, "GET", "https://example.com", {
				headers: { authorization: 1 },
			}),
		).resolves.toEqual(apiFailure("httpCall headers must be string values"));
	});

	it("returns failure details for an unsuccessful HTTP response", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("bad request", {
				status: 400,
				statusText: "Bad Request",
			})) as unknown as typeof fetch;

		try {
			expect(httpCall({}, "GET", "https://example.com")).resolves.toEqual({
				...apiFailure("HTTP 400 Bad Request"),
				data: { status: 400 },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
