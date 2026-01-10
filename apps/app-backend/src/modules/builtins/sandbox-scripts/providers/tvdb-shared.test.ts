import type { CoreSandboxHostMethodMap } from "@ryot/sandbox-sdk";
import { describe, expect, it, vi } from "vitest";

import {
	bcp47ToTvdb,
	getTvdbAccessToken,
	searchTvdb,
	tvdbGet,
	tvdbGetOptional,
	type TvdbHost,
} from "./tvdb-shared";

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: {
			status: 200,
			headers: {},
			body: typeof body === "string" ? body : JSON.stringify(body),
		},
	});

type TvdbTestHost = Omit<TvdbHost, "getAppConfigValue"> &
	Pick<CoreSandboxHostMethodMap, "getAppConfigValue">;

function makeHost(overrides: Partial<TvdbTestHost>): TvdbHost;
function makeHost(overrides: Partial<TvdbTestHost>): unknown {
	return {
		httpCall: () => Promise.reject(new Error("unexpected httpCall")),
		setCachedValue: () => Promise.resolve({ success: true as const, data: null }),
		getCachedValue: () => Promise.resolve({ success: true as const, data: "Bearer cached" }),
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "test-api-key" }),
		...overrides,
	};
}

describe("tvdb-shared", () => {
	it("reuses a cached token and sends it as the authorization header", () => {
		const requests: Array<{
			url: string;
			method: string;
			headers: Record<string, string> | undefined;
		}> = [];
		const host = makeHost({
			httpCall: (method, url, options) => {
				requests.push({ url, method, headers: options?.headers });
				return httpSuccess({ status: "success", data: { id: 1 } });
			},
		});

		return tvdbGet(host, "/series/1").then((payload) => {
			expect(requests).toEqual([
				{
					method: "GET",
					url: "https://api4.thetvdb.com/v4/series/1",
					headers: { Authorization: "Bearer cached" },
				},
			]);
			expect(payload["data"]).toEqual({ id: 1 });
			return undefined;
		});
	});

	it("logs in, caches the fresh token, and appends query parameters on a cache miss", () => {
		const calls: string[] = [];
		const cacheWrites: Array<readonly [string, unknown, number]> = [];
		const host = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			setCachedValue: (key, value, ttl) => {
				cacheWrites.push([key, value, ttl]);
				return Promise.resolve({ success: true as const, data: null });
			},
			httpCall: (method, url, options) => {
				calls.push(`${method} ${url}`);
				if (url.endsWith("/login")) {
					expect(options?.body).toBe(JSON.stringify({ apikey: "test-api-key" }));
					expect(options?.headers).toEqual({ "Content-Type": "application/json" });
					return httpSuccess({ status: "success", data: { token: "fresh" } });
				}
				expect(options?.headers).toEqual({ Authorization: "Bearer fresh" });
				return httpSuccess({ status: "success", data: [] });
			},
		});

		return tvdbGet(host, "/search", {
			query: "dune",
			type: "movie",
			offset: "0",
			limit: "20",
		}).then(() => {
			expect(calls).toEqual([
				"POST https://api4.thetvdb.com/v4/login",
				"GET https://api4.thetvdb.com/v4/search?query=dune&type=movie&offset=0&limit=20",
			]);
			expect(cacheWrites).toEqual([["tvdb_access_token", "Bearer fresh", 23 * 60 * 60]]);
			return undefined;
		});
	});

	it("fails when the login response carries no token", () => {
		const host = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			httpCall: () => httpSuccess({ status: "success", data: {} }),
		});

		return expect(getTvdbAccessToken(host)).rejects.toThrow("TVDB login returned no token");
	});

	it("fails when the API key is not configured", () => {
		const host = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			getAppConfigValue: () => Promise.resolve({ success: true as const, data: null }),
		});

		return expect(getTvdbAccessToken(host)).rejects.toThrow(
			"TVDB API key is not configured. Set MOVIES_AND_SHOWS_TVDB_API_KEY in your environment.",
		);
	});

	it("propagates app config and login transport failures", () => {
		const configFailureHost = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			getAppConfigValue: () =>
				Promise.resolve({ success: false as const, error: "config store down" }),
		});
		const loginFailureHost = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			httpCall: () => Promise.resolve({ success: false as const, error: "connection refused" }),
		});

		return expect(getTvdbAccessToken(configFailureHost))
			.rejects.toThrow("config store down")
			.then(() =>
				expect(getTvdbAccessToken(loginFailureHost)).rejects.toThrow("connection refused"),
			);
	});

	it("returns a fresh token even when the cache write fails", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const host = makeHost({
			getCachedValue: () => Promise.resolve({ success: true as const, data: null }),
			setCachedValue: () => Promise.resolve({ success: false as const, error: "redis down" }),
			httpCall: () => httpSuccess({ status: "success", data: { token: "fresh" } }),
		});

		return getTvdbAccessToken(host)
			.then((token) => {
				expect(token).toBe("Bearer fresh");
				expect(warn).toHaveBeenCalledWith("TVDB token cache write failed: redis down");
				return undefined;
			})
			.finally(() => warn.mockRestore());
	});

	it("surfaces TVDB API error payloads with and without a message", () => {
		const withMessage = makeHost({
			httpCall: () => httpSuccess({ status: "failure", message: "Not Found" }),
		});
		const withoutMessage = makeHost({ httpCall: () => httpSuccess({ status: "failure" }) });

		return expect(tvdbGet(withMessage, "/series/1"))
			.rejects.toThrow("TVDB API error: Not Found")
			.then(() =>
				expect(tvdbGet(withoutMessage, "/series/1")).rejects.toThrow("TVDB API error: failure"),
			);
	});

	it("treats 400 and 404 as missing only for optional requests", () => {
		const missingHost = makeHost({
			httpCall: () =>
				Promise.resolve({ success: false as const, error: "HTTP 404", data: { status: 404 } }),
		});
		const badRequestHost = makeHost({
			httpCall: () =>
				Promise.resolve({ success: false as const, error: "HTTP 400", data: { status: 400 } }),
		});
		const failingHost = makeHost({
			httpCall: () =>
				Promise.resolve({ success: false as const, error: "HTTP 500", data: { status: 500 } }),
		});

		return tvdbGetOptional(missingHost, "/movies/9/translations/eng")
			.then((payload) => {
				expect(payload).toBeNull();
				return tvdbGetOptional(badRequestHost, "/movies/9/translations/eng");
			})
			.then((payload) => {
				expect(payload).toBeNull();
				return expect(tvdbGet(missingHost, "/movies/9")).rejects.toThrow("HTTP 404");
			})
			.then(() =>
				expect(tvdbGetOptional(failingHost, "/movies/9/translations/eng")).rejects.toThrow(
					"HTTP 500",
				),
			);
	});

	it("falls back to a path-based message when the host failure has no text", () => {
		const host = makeHost({
			httpCall: () => Promise.resolve({ success: false as const, error: "" }),
		});

		return expect(tvdbGet(host, "/series/1")).rejects.toThrow("TVDB request failed: /series/1");
	});

	it("rejects invalid JSON and non-object payloads", () => {
		const invalidHost = makeHost({ httpCall: () => httpSuccess("not json {") });
		const nonObjectHost = makeHost({ httpCall: () => httpSuccess([1, 2]) });

		return expect(tvdbGet(invalidHost, "/series/1"))
			.rejects.toThrow("TVDB returned invalid JSON")
			.then(() =>
				expect(tvdbGet(nonObjectHost, "/series/1")).rejects.toThrow(
					"TVDB returned an invalid response object",
				),
			);
	});

	it("maps bcp-47 languages to TVDB codes with passthrough for unknown bases", () => {
		expect(bcp47ToTvdb("en-US")).toBe("eng");
		expect(bcp47ToTvdb("PT-br")).toBe("por");
		expect(bcp47ToTvdb("xx")).toBe("xx");
	});

	it("passes paging as offset and limit search parameters", () => {
		const urls: string[] = [];
		const host = makeHost({
			httpCall: (_method, url) => {
				urls.push(url);
				return httpSuccess({ status: "success", data: [], links: { total_items: 0 } });
			},
		});

		return searchTvdb(
			host,
			{ query: "dune", page: 3, pageSize: 10 },
			{
				type: "movie",
				nameKeys: ["name"],
			},
		).then((result) => {
			expect(urls).toEqual([
				"https://api4.thetvdb.com/v4/search?query=dune&type=movie&offset=20&limit=10",
			]);
			expect(result.details).toEqual({ totalItems: 0, nextPage: null });
			return undefined;
		});
	});
});
