import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { describe, expect, it } from "vitest";

import { details, manifest, related } from "./shared";

type TmdbHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.tmdb sandbox script", () => {
	it("emits separate movie and show company groups", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.pathname.endsWith("/discover/movie")) {
				return httpSuccess({ results: [{ id: 2, title: "Film" }] });
			}
			if (requestUrl.pathname.endsWith("/discover/tv")) {
				return httpSuccess({ results: [{ id: 3, name: "Show" }] });
			}
			return httpSuccess({ name: "Studio", origin_country: "US", logo_path: "/logo.png" });
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result).toMatchObject({
					properties: {
						images: [
							{
								type: "remote",
								purpose: "logo",
								url: "https://image.tmdb.org/t/p/original/logo.png",
							},
						],
					},
				});
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-movie",
						entities: [
							{
								name: "Film",
								externalId: "2",
								providerSlug: "movie.tmdb",
								relationshipProperties: { roles: ["Production Company"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-show",
						entities: [
							{
								name: "Show",
								externalId: "3",
								providerSlug: "show.tmdb",
								relationshipProperties: { roles: ["Production Company"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("fetches only the first discover page and continues when more pages exist", () => {
		const requests: Array<{ page: string | null; path: string; company: string | null }> = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.pathname.endsWith("/company/1")) {
				return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
			}
			requests.push({
				path: requestUrl.pathname,
				page: requestUrl.searchParams.get("page"),
				company: requestUrl.searchParams.get("with_companies"),
			});
			return requestUrl.pathname.endsWith("/discover/movie")
				? httpSuccess({ total_pages: 900, results: [{ id: 2, title: "Film" }] })
				: httpSuccess({ total_pages: 1, results: [{ id: 3, name: "Show" }] });
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(requests).toEqual([
					{ page: "1", company: "1", path: "/3/discover/movie" },
					{ page: "1", company: "1", path: "/3/discover/tv" },
				]);
				expect(result.relatedEntityGroups).toEqual([
					expect.objectContaining({
						relationshipSchemaSlug: "company-to-movie",
						continuation: { page: 2, totalPages: 500 },
						entities: [expect.objectContaining({ externalId: "2" })],
					}),
					expect.objectContaining({
						relationshipSchemaSlug: "company-to-show",
						entities: [expect.objectContaining({ externalId: "3" })],
					}),
				]);
				expect(result.relatedEntityGroups?.[1]).not.toHaveProperty("continuation");
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});

const input = (relationshipSchemaSlug: string, continuation: JsonValue) => ({
	continuation,
	externalId: "1",
	relationshipSchemaSlug,
	direction: "outgoing" as const,
});

describe("company.tmdb related script", () => {
	it("fetches up to 40 pages with bounded concurrency and returns the next continuation", () => {
		const pages: number[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			const page = Number(requestUrl.searchParams.get("page"));
			pages.push(page);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return Effect.sleep("1 millis").pipe(
				Effect.map(() => {
					inFlight -= 1;
					return {
						status: 200,
						headers: {},
						body: JSON.stringify({ results: [{ id: page, name: `Show ${page}` }] }),
					};
				}),
			);
		});

		return runSandboxTestScript(
			related,
			input("company-to-show", { page: 2, totalPages: 100 }),
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(sortBy(pages)).toEqual(Array.from({ length: 40 }, (_, index) => index + 2));
				expect(maxInFlight).toBeLessThanOrEqual(5);
				expect(result.continuation).toEqual({ page: 42, totalPages: 100 });
				expect(result.entities).toHaveLength(40);
				expect(result.entities[0]).toEqual({
					name: "Show 2",
					externalId: "2",
					providerSlug: "show.tmdb",
					relationshipProperties: { roles: ["Production Company"] },
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("ends at the last page and caps TMDB discover at page 500", () => {
		const pages: number[] = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			pages.push(Number(requestUrl.searchParams.get("page")));
			expect(requestUrl.pathname).toBe("/3/discover/movie");
			return httpSuccess({ results: [] });
		});

		return runSandboxTestScript(
			related,
			input("company-to-movie", { page: 490, totalPages: 900 }),
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(Math.max(...pages)).toBe(500);
				expect(pages).toHaveLength(11);
				expect(result.continuation).toBeNull();
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("rejects an unknown relationship or a malformed continuation", () => {
		const host = makeHost(() => httpSuccess({ results: [] }));
		const failure = (slug: string, continuation: JsonValue) =>
			runSandboxTestScript(related, input(slug, continuation), host, execution).pipe(
				Effect.flip,
				Effect.map((error) => error.message),
			);

		return Effect.gen(function* () {
			expect(yield* failure("company-to-game", { page: 2, totalPages: 3 })).toContain(
				"Unsupported TMDB company relationship",
			);
			expect(yield* failure("company-to-movie", { page: 1 })).toContain(
				"Invalid TMDB company continuation",
			);
		}).pipe(Effect.runPromise);
	});
});
