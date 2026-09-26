import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./shared";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const httpMissing = () =>
	Effect.fail({
		message: "HTTP 404",
		data: { status: 404, body: JSON.stringify({ status: "failure" }) },
	});

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		setCachedValue: () => Effect.succeed(null),
		getCachedValue: () => Effect.succeed("Bearer test-token"),
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "test-api-key"]))),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("movie-group.tvdb sandbox script", () => {
	it("rejects search", () =>
		expect(
			Effect.runPromise(
				runSandboxTestScript(
					search,
					{ page: 1, query: "x", pageSize: 20 },
					makeHost((_method, _url) => httpSuccess({})),
					execution,
				),
			),
		).rejects.toThrow("TVDB does not support movie group search"));

	it("sorts members by order, drops a numeric movieId while counting it, and trims fields", () => {
		const host = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({
					status: "success",
					data: {
						name: "My List",
						url: "  cool-list  ",
						overview: "An overview",
						image: "  https://img/x.jpg  ",
						entities: [
							{ order: 2, movieId: "  10  ", name: "  Bravo  " },
							{ order: 1, movieId: "20", name: "Alpha" },
							{ order: 3, movieId: 999, name: "Numeric" },
							{ order: 4, movieId: "30" },
						],
					},
				});
			}
			return httpMissing();
		});

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "42" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "My List",
						properties: {
							parts: 4,
							description: "An overview",
							sourceUrl: "https://thetvdb.com/lists/cool-list",
							images: [{ type: "remote", purpose: "cover", url: "https://img/x.jpg" }],
						},
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "movie-group-to-movie",
								entities: [
									{
										name: "Alpha",
										externalId: "20",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 1 },
									},
									{
										name: "Bravo",
										externalId: "10",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 2 },
									},
									{
										externalId: "30",
										name: "Loading...",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 4 },
									},
								],
							},
						],
					});
				}),
			),
		);
	});

	it("falls back to Unnamed List title and null sourceUrl, and overrides from translation", () => {
		const missingHost = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({ status: "success", data: { entities: [] } });
			}
			return httpMissing();
		});

		const translatedHost = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({
					status: "success",
					data: { name: "Original", overview: "Original overview" },
				});
			}
			return httpSuccess({
				status: "success",
				data: { name: "Traducido", overview: "Descripción" },
			});
		});

		return Effect.runPromise(
			Effect.all(
				[
					runSandboxTestScript(details, { externalId: "7" }, missingHost, execution),
					runSandboxTestScript(details, { externalId: "8" }, translatedHost, execution),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(([missing, translated]) => {
					expect(missing.name).toBe("Unnamed List");
					expect(missing.properties).toEqual({
						parts: 0,
						images: [],
						sourceUrl: null,
						description: null,
					});
					expect(translated.name).toBe("Traducido");
					expect(translated.properties).toEqual({
						parts: 0,
						images: [],
						sourceUrl: null,
						description: "Descripción",
					});
				}),
			),
		);
	});

	it("translate prefers the primary translation record over the first entry", () => {
		const host = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/translations/spa")) {
				return httpSuccess({
					status: "success",
					data: [
						{ name: "First", overview: "First overview" },
						{ name: "Primary", isPrimary: true, overview: "Primary overview" },
					],
				});
			}
			return httpMissing();
		});

		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ language: "es", externalId: "9", entitySchemaSlug: "movie-group" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "Primary",
						properties: { description: "Primary overview" },
					});
				}),
			),
		);
	});

	it("translate rejects a non-numeric externalId", () =>
		expect(
			Effect.runPromise(
				runSandboxTestScript(
					translate,
					{ language: "es", externalId: "abc", entitySchemaSlug: "movie-group" },
					makeHost((_method, _url) => httpSuccess({})),
					execution,
				),
			),
		).rejects.toThrow("externalId must be a numeric TVDB list ID"));
});
