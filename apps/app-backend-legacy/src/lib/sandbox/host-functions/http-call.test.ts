import { describe, expect, it } from "bun:test";

import { apiFailure, apiSuccess } from "~/lib/sandbox/types";

import { httpCall } from "./http-call";

describe("httpCall", () => {
	it("returns response details for a valid request", () => {
		const originalFetch = globalThis.fetch;
		// oxlint-disable-next-line no-unsafe-type-assertion
		globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
			expect(input).toBe("https://example.com/test");
			expect(init?.body).toBe('{"hello":"world"}');
			expect(init?.method).toBe("POST");
			expect(init?.headers).toEqual({
				"User-Agent": "Ryot ( https://github.com/ignisda/ryot )",
				"x-test": "1",
			});

			return Promise.resolve(
				new Response("ok", {
					status: 200,
					statusText: "OK",
					headers: { "content-type": "text/plain" },
				}),
			);
		}) as unknown as typeof fetch;

		try {
			return expect(
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

	it("returns validation failure for a blank method", () => {
		return expect(httpCall({}, "   ", "https://example.com")).resolves.toEqual(
			apiFailure("httpCall expects a non-empty method string"),
		);
	});

	it("returns validation failure for invalid options", () => {
		return expect(
			httpCall({}, "GET", "https://example.com", {
				headers: { authorization: 1 },
			}),
		).resolves.toEqual(apiFailure("httpCall headers must be string values"));
	});

	it("returns failure details for an unsuccessful HTTP response", () => {
		const originalFetch = globalThis.fetch;
		// oxlint-disable-next-line no-unsafe-type-assertion
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response("bad request", {
					status: 400,
					statusText: "Bad Request",
				}),
			)) as unknown as typeof fetch;

		try {
			return expect(httpCall({}, "GET", "https://example.com")).resolves.toEqual({
				...apiFailure("HTTP 400 Bad Request"),
				data: { status: 400 },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
